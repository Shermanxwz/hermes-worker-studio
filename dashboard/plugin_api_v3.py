"""Hermes Worker Studio 3 product bridge.

Extends the sealed 2.x bridge without replacing its execution ownership:
all sessions, models, config, Runs, approvals, and subagents remain Hermes-owned.
This shim adds a multimodal-preserving Runs submission route, projects the
canonical Hermes todo state from public Session API rows when the pinned public
Runs stream has not emitted a todo snapshot yet, and feature-detects Hermes'
public per-session context telemetry when an upstream build exposes it.

Context is deliberately fail-closed: Worker Studio never derives current
context occupancy from cumulative billing/input-token counters. If Hermes does
not expose an official context snapshot, the UI receives ``available: false``.
"""
from __future__ import annotations

import asyncio
import copy
import importlib.util
import hashlib
import json
import logging
import os
import pathlib
import sys
import threading
import time
import urllib.parse
from typing import Any

from fastapi import HTTPException, Request

_here = pathlib.Path(__file__).resolve()
_spec = importlib.util.spec_from_file_location("hermes_worker_studio_v2_api", _here.with_name("plugin_api.py"))
if _spec is None or _spec.loader is None:  # pragma: no cover - loader invariant
    raise RuntimeError("could not load Worker Studio compatibility bridge")
_legacy = importlib.util.module_from_spec(_spec)
sys.modules.setdefault(_spec.name, _legacy)
_spec.loader.exec_module(_legacy)

router = _legacy.router
_base_run_snapshot = _legacy._run_snapshot
_TODO_POLL_INTERVAL = 0.5
_TODO_MESSAGE_LIMIT = 100
_CONTEXT_POLL_INTERVAL = 0.65
# The supported installer rewrites this exact source-tree marker in the staged
# release artifact to the git commit being installed. A running target can then
# prove that its loaded Product 3 bridge is the same candidate whose CI and
# browser evidence are being sealed.
BUILD_CANDIDATE_SHA = "source-tree"

_PROJECTION_ROOT = pathlib.Path(os.getenv(
    "HERMES_WORKER_STUDIO_STATE_DIR",
    str(pathlib.Path.home() / ".hermes" / "worker-studio" / "projections"),
))
_PROJECTION_LOCK = threading.RLock()

# Hermes 0.20.6 exposes one transport on a generic named provider, while a
# single OpenAI-compatible endpoint can legitimately contain both Chat
# Completions and Responses models.  The compatibility layer below keeps the
# source provider untouched and, only after an explicit real Run probe (or a
# user choice), materialises provider-scoped aliases through Hermes' own
# /api/config contract.  Nothing here guesses from model names.
_PROTOCOL_ROOT = pathlib.Path(os.getenv(
    "HERMES_WORKER_STUDIO_PROTOCOL_ROOT",
    str(_PROJECTION_ROOT.parent),
))
_PROTOCOL_FILE = pathlib.Path(os.getenv(
    "HERMES_WORKER_STUDIO_PROTOCOL_FILE",
    str(_PROTOCOL_ROOT / "protocols.json"),
))
_PROTOCOL_LOCK = threading.RLock()
_OFFICIAL_CONFIG_LOCK = threading.RLock()
_CONFIG_ROUTE_UNAVAILABLE = frozenset({404, 405})
_PROTOCOL_MODES = {
    "chat_completions",
    "codex_responses",
    "anthropic_messages",
    "bedrock_converse",
}
_PROBE_MODES = ("chat_completions", "codex_responses")


def _projection_file(session_id: str) -> pathlib.Path:
    digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    return _PROJECTION_ROOT / f"{digest}.json"


def _read_projection(session_id: str) -> dict[str, Any]:
    path = _projection_file(session_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _write_projection(session_id: str, payload: dict[str, Any]) -> None:
    _PROJECTION_ROOT.mkdir(parents=True, exist_ok=True)
    path = _projection_file(session_id)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _sanitize_projection(payload: Any, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(400, "projection must be an object")
    turns = payload.get("turns")
    if not isinstance(turns, list) or len(turns) > 100:
        raise HTTPException(400, "projection turns must be a list of at most 100 items")
    safe_turns = []
    for turn in turns:
        if not isinstance(turn, dict):
            continue
        safe_turns.append({
            key: turn[key] for key in ("id", "session_id", "status", "started_at", "turn_started_at", "ended_at", "elapsed_ms", "elapsed_source", "duration_s", "last_seq", "gateway_last_seq", "gateway_replay_epoch", "events", "output", "error", "assistant_message_id", "user_message_id", "message_ids", "source_route", "protocol")
            if key in turn
        })
    marker = payload.get("moa") if "moa" in payload else (previous or {}).get("moa")
    return {"turns": safe_turns, "moa": marker if isinstance(marker, dict) else None}


def _has_input(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def _official_run_body_v3(body: dict[str, Any], session_id: str | None, raw_input: Any) -> dict[str, Any]:
    outgoing: dict[str, Any] = {"input": raw_input}
    if session_id:
        outgoing["session_id"] = session_id
    for key in (
        "instructions",
        "conversation_history",
        "previous_response_id",
        "model",
        "provider",
        "model_options",
    ):
        if key in body and body[key] not in (None, "", {}):
            outgoing[key] = body[key]
    return outgoing


def _parse_jsonish(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _todo_snapshot_from_message(message: Any) -> dict[str, Any] | None:
    """Extract one canonical todo-tool result from a public Session API row."""
    if not isinstance(message, dict) or str(message.get("role") or "") != "tool":
        return None
    name = str(message.get("tool_name") or message.get("name") or "")
    if name != "todo":
        return None
    payload = _parse_jsonish(
        message.get("content")
        if message.get("content") not in (None, "")
        else message.get("text")
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("todos"), list):
        return None
    try:
        revision = max(0, int(payload.get("revision") or 0))
    except (TypeError, ValueError):
        revision = 0
    return {
        "todos": payload["todos"],
        "revision": revision,
        "source": "hermes_session_api",
    }


def _latest_session_todo_snapshot(session_id: str | None) -> dict[str, Any] | None:
    """Read current Hermes todo truth through the documented Session API only."""
    if not session_id:
        return None
    path = (
        f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/messages"
        f"?limit={_TODO_MESSAGE_LIMIT}&order=latest"
    )
    payload = _legacy._hermes_proxy(path)
    messages = None
    if isinstance(payload, dict):
        # The Dashboard's native route returns ``messages`` while the same
        # official Session API exposed by Hermes' API Server uses the standard
        # list envelope's ``data`` field. Both are Hermes-owned surfaces; do
        # not synthesize todo state when neither shape is present.
        messages = payload.get("messages")
        if not isinstance(messages, list):
            messages = payload.get("data")
    if not isinstance(messages, list):
        return None
    best: dict[str, Any] | None = None
    for message in messages:
        snapshot = _todo_snapshot_from_message(message)
        if snapshot is None:
            continue
        if best is None or int(snapshot["revision"]) >= int(best["revision"]):
            best = snapshot
    return best


def _seed_todo_baseline(run_id: str, snapshot: dict[str, Any] | None) -> None:
    with _legacy._RUNS_LOCK:
        run = _legacy._RUNS.get(run_id)
        if run is None:
            return
        run["todo_revision"] = int(snapshot.get("revision") or 0) if snapshot else -1
        run["todo_polled_at"] = 0.0


def _project_session_todo_if_changed(run_id: str) -> bool:
    """Append a real Hermes todo snapshot when Runs does not expose it itself.

    This is intentionally a projection, not a planner: the data comes from the
    persisted result of Hermes' own ``todo`` tool through ``/api/sessions``.
    The event is named ``todo.snapshot`` rather than pretending the upstream
    ``/v1/runs`` transport emitted ``todo.updated``.
    """
    now = time.monotonic()
    with _legacy._RUNS_LOCK:
        run = _legacy._RUNS.get(run_id)
        if run is None:
            return False
        last_poll = float(run.get("todo_polled_at") or 0.0)
        if now - last_poll < _TODO_POLL_INTERVAL:
            return False
        run["todo_polled_at"] = now
        session_id = str(run.get("session_id") or "")
        previous_revision = int(run.get("todo_revision", -1))
        # If official Runs starts emitting its canonical todo.updated event,
        # prefer that transport and stop adding Session-API projection events.
        # Our own todo.snapshot must NOT trigger this guard because later
        # revisions still need to project.
        if any(
            str(event.get("event") or "").lower() == "todo.updated"
            for event in run.get("events", [])
        ):
            return False

    try:
        snapshot = _latest_session_todo_snapshot(session_id)
    except HTTPException:
        return False
    if snapshot is None:
        return False
    revision = int(snapshot.get("revision") or 0)
    if revision <= previous_revision:
        return False

    with _legacy._RUNS_LOCK:
        run = _legacy._RUNS.get(run_id)
        if run is None:
            return False
        # Re-check after the upstream request in case another poll won the race.
        if revision <= int(run.get("todo_revision", -1)):
            return False
        run["todo_revision"] = revision
    _legacy._append_run_event(
        run_id,
        "todo.snapshot",
        {
            "revision": revision,
            "todos": snapshot["todos"],
            "source": "hermes_session_api",
        },
    )
    return True


def _finite_nonnegative(value: Any) -> float | int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if number < 0 or number != number or number in {float("inf"), float("-inf")}:
        return None
    return int(number) if number.is_integer() else number


def _first_number(payload: dict[str, Any], *names: str) -> float | int | None:
    for name in names:
        if name not in payload:
            continue
        number = _finite_nonnegative(payload.get(name))
        if number is not None:
            return number
    return None


def _normalize_context_snapshot(payload: Any) -> dict[str, Any] | None:
    """Normalize only explicit Hermes context telemetry fields.

    Accepts both a direct context object and the official session envelope
    ``{"object": "hermes.session.context", "context": {...}}``. It never
    falls back to ``input_tokens``, ``prompt_tokens`` or ``total_tokens``:
    those are cumulative accounting buckets, not current context occupancy.
    """
    if not isinstance(payload, dict):
        return None
    outer = payload
    if isinstance(payload.get("context"), dict):
        payload = payload["context"]
    used = _first_number(
        payload,
        "context_tokens",
        "context_used",
        "used_tokens",
        "last_prompt_tokens",
    )
    maximum = _first_number(
        payload,
        "context_length",
        "context_max",
        "context_window",
        "context_window_tokens",
        "max_tokens",
    )
    threshold = _first_number(
        payload,
        "threshold_tokens",
        "compression_threshold",
        "compression_threshold_tokens",
        "compact_at_tokens",
    )
    remaining = _first_number(
        payload,
        "tokens_until_compression",
        "remaining_tokens",
        "context_remaining",
    )
    compression_count = _first_number(payload, "compression_count", "compaction_count")
    percent = _first_number(payload, "context_percent", "usage_percent", "percent", "fill_percent")
    threshold_percent = _first_number(payload, "compression_threshold_percent", "threshold_percent")
    progress_percent = _first_number(payload, "compression_progress_percent", "compact_progress_percent")
    if percent is None and used is not None and maximum:
        percent = round((float(used) / float(maximum)) * 100, 2)
    if threshold_percent is None and threshold is not None and maximum:
        threshold_percent = round((float(threshold) / float(maximum)) * 100, 2)
    if progress_percent is None and used is not None and threshold:
        progress_percent = round((float(used) / float(threshold)) * 100, 2)
    if remaining is None and used is not None and threshold is not None:
        remaining = max(0, float(threshold) - float(used))
    if maximum is None and used is None and threshold is None and compression_count is None:
        return None
    raw_state = payload.get("compaction_state")
    if raw_state is None:
        raw_state = payload.get("compression_state")
    compaction_state = str(raw_state or "").strip().lower()
    source = str(
        payload.get("context_source")
        or payload.get("source")
        or outer.get("source")
        or "hermes_session_context_api"
    ).strip()
    return {
        "available": True,
        "context_used": used,
        "context_max": maximum,
        "context_percent": percent,
        "remaining_tokens": remaining,
        "threshold_tokens": threshold,
        "compression_threshold_percent": threshold_percent,
        "compression_progress_percent": progress_percent,
        "compression_count": compression_count,
        "compression_enabled": payload.get("compression_enabled", payload.get("auto_compact")),
        "compacted": payload.get("compacted") is True,
        "compaction_state": compaction_state,
        "updated_at": payload.get("updated_at"),
        "source": source or "hermes_session_context_api",
        "measurement": payload.get("measurement") or payload.get("context_source"),
    }


def _session_context_snapshot(session_id: str | None) -> dict[str, Any] | None:
    """Read the official public session-context route when Hermes exposes it."""
    if not session_id:
        return None
    path = f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/context"
    try:
        payload = _legacy._hermes_proxy(path)
    except HTTPException as exc:
        # Pinned Hermes 0.20.6 does not yet expose this public HTTP contract.
        # Treat absence as a capability miss, never as permission to estimate.
        if int(exc.status_code or 0) in {404, 405, 501}:
            return None
        raise
    return _normalize_context_snapshot(payload)


def _context_fingerprint(snapshot: dict[str, Any] | None) -> str:
    if not snapshot:
        return ""
    return json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _seed_context_baseline(run_id: str, snapshot: dict[str, Any] | None) -> None:
    with _legacy._RUNS_LOCK:
        run = _legacy._RUNS.get(run_id)
        if run is None:
            return
        run["context_fingerprint"] = _context_fingerprint(snapshot)
        run["context_polled_at"] = 0.0


def _project_session_context_if_changed(run_id: str) -> bool:
    """Project an official Hermes session-context snapshot into the Studio run.

    The event is named ``context.snapshot`` to make transport provenance
    explicit. Native ``context.compaction`` or future native Runs context events
    continue to flow untouched through the Runs SSE bridge.
    """
    now = time.monotonic()
    with _legacy._RUNS_LOCK:
        run = _legacy._RUNS.get(run_id)
        if run is None:
            return False
        last_poll = float(run.get("context_polled_at") or 0.0)
        if now - last_poll < _CONTEXT_POLL_INTERVAL:
            return False
        run["context_polled_at"] = now
        session_id = str(run.get("session_id") or "")
        previous = str(run.get("context_fingerprint") or "")
    try:
        snapshot = _session_context_snapshot(session_id)
    except HTTPException:
        return False
    if snapshot is None:
        return False
    fingerprint = _context_fingerprint(snapshot)
    if not fingerprint or fingerprint == previous:
        return False
    with _legacy._RUNS_LOCK:
        run = _legacy._RUNS.get(run_id)
        if run is None:
            return False
        if fingerprint == str(run.get("context_fingerprint") or ""):
            return False
        run["context_fingerprint"] = fingerprint
    _legacy._append_run_event(run_id, "context.snapshot", snapshot)
    return True


def _run_snapshot_v3(run_id: str, after: int = 0) -> dict[str, Any]:
    snapshot = _base_run_snapshot(run_id, after)
    changed = _project_session_todo_if_changed(run_id)
    changed = _project_session_context_if_changed(run_id) or changed
    if changed:
        snapshot = _base_run_snapshot(run_id, after)
    return snapshot


def _start_native_run_v3(body: dict[str, Any]) -> dict[str, Any]:
    session_id = str(body.get("session_id") or "").strip() or None
    if not session_id:
        raise HTTPException(400, "session_id is required")

    raw_input: Any = body.get("input")
    if not _has_input(raw_input):
        raw_input = body.get("message")
    if not _has_input(raw_input):
        raise HTTPException(400, "message/input is required")

    # Capture pre-run canonical state so old plan/context snapshots are not
    # re-announced as if the new turn created them.
    try:
        todo_baseline = _latest_session_todo_snapshot(session_id)
    except HTTPException:
        todo_baseline = None
    try:
        context_baseline = _session_context_snapshot(session_id)
    except HTTPException:
        context_baseline = None

    support = _legacy._require_runs()
    outgoing = _official_run_body_v3(body, session_id, raw_input)
    source_route: dict[str, Any] | None = None
    requested_provider = str(body.get("provider") or "").strip()
    requested_model = str(body.get("model") or "").strip()
    if requested_provider.lower() == "moa":
        _ensure_moa_execution_config()
    elif requested_provider and requested_model:
        # The Studio WebSocket normally resolves this before prompt.submit.
        # Keep the public /v1/runs bridge correct as well: seal probes,
        # unattended callers, and older clients must not silently send a
        # mixed custom endpoint through Hermes' provider-global default.
        source_route = _resolve_route_for_run(requested_provider, requested_model)
        execution_provider = str(source_route.get("execution_provider") or requested_provider).strip()
        outgoing["provider"] = execution_provider
    upstream = _legacy._hermes_proxy(
        "/v1/runs",
        method="POST",
        body=outgoing,
    )
    if not isinstance(upstream, dict):
        raise HTTPException(502, "Hermes /v1/runs returned a non-object")
    run_id = str(upstream.get("run_id") or upstream.get("id") or "").strip()
    if not run_id:
        raise HTTPException(502, "Hermes /v1/runs did not return run_id")
    status = str(upstream.get("status") or "running").lower()
    initial = _legacy._new_run_record(run_id, session_id, status)
    _seed_todo_baseline(run_id, todo_baseline)
    _seed_context_baseline(run_id, context_baseline)
    initial["capabilities"] = support
    initial["input_mode"] = "multimodal" if not isinstance(raw_input, str) else "text"
    if source_route is not None:
        initial["source_route"] = source_route
    if context_baseline:
        initial["context"] = context_baseline
    if support["events"]:
        threading.Thread(
            target=_legacy._consume_official_run_events,
            args=(run_id,),
            name=f"hermes-worker-studio-v3-run-{run_id[-8:]}",
            daemon=True,
        ).start()
    return initial


# The legacy route functions resolve this module global at call time. Replacing
# only the snapshot projector keeps all public status/control endpoints intact
# while adding Product 3 canonical todo and official-context projections.
_legacy._run_snapshot = _run_snapshot_v3


def _config_object(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict) and isinstance(payload.get("config"), dict):
        return payload["config"]
    return payload if isinstance(payload, dict) else {}


_LOG = logging.getLogger(__name__)


def _read_hermes_config_store() -> dict[str, Any]:
    """Read the same official config store used by Hermes' Dashboard route.

    The pinned Hermes build separates its Dashboard process (which owns
    ``/api/config``) from the Gateway/API Server process (which owns Runs).
    The plugin is loaded inside the Dashboard process, so this is the
    authoritative in-process fallback when the API Server proxy has no config
    route.  Keep the import lazy: the bridge's standalone tests and older
    Hermes loaders can still import the module before the full CLI is ready.
    """
    try:
        from hermes_cli.config import load_config

        config = load_config()
    except Exception as exc:  # pragma: no cover - depends on the host Hermes install
        _LOG.exception("Hermes official config store read failed")
        raise HTTPException(502, "Hermes official config store is unavailable") from exc
    if not isinstance(config, dict):
        raise HTTPException(502, "Hermes official config store returned an invalid object")
    return config


def _write_hermes_config_store_providers(providers: dict[str, dict[str, Any]]) -> None:
    """Persist only the provider map through Hermes' official config writer.

    ``web_server.update_config`` deep-merges a partial body into the raw YAML
    before calling ``save_config``.  Mirror that contract here instead of
    writing a second config file or exporting a second provider registry.
    """
    try:
        from hermes_cli.config import is_managed, read_raw_config, save_config

        if is_managed():
            raise HTTPException(409, "Hermes configuration is managed and cannot be modified")
        current = read_raw_config()
        if not isinstance(current, dict):
            raise HTTPException(502, "Hermes official config store returned an invalid object")
        current["providers"] = copy.deepcopy(providers)
        save_config(current)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - depends on the host Hermes install
        _LOG.exception("Hermes official config store write failed")
        raise HTTPException(502, "Hermes official config store could not be updated") from exc


def _read_official_config() -> dict[str, Any]:
    try:
        payload = _legacy._hermes_proxy("/api/config")
    except HTTPException as exc:
        # The API Server intentionally does not expose the Dashboard's config
        # contract in Hermes 0.20.6.  Only a missing method/route is eligible
        # for the in-process official-store fallback; auth, transport, and
        # server errors must remain visible and fail closed.
        if int(exc.status_code or 0) not in _CONFIG_ROUTE_UNAVAILABLE:
            raise
        _LOG.debug("Hermes API Server has no /api/config route; using official Dashboard config store")
        return _read_hermes_config_store()
    config = _config_object(payload)
    if not isinstance(config, dict):
        raise HTTPException(502, "Hermes /api/config returned an invalid object")
    return config


def _read_official_model_options() -> dict[str, Any]:
    payload = _legacy._hermes_proxy("/api/model/options")
    if not isinstance(payload, dict):
        raise HTTPException(502, "Hermes /api/model/options returned an invalid object")
    return payload


def _canonical_protocol_mode(value: Any) -> str:
    raw = str(value or "").strip().lower().replace("-", "_")
    aliases = {
        "chat": "chat_completions",
        "openai_chat": "chat_completions",
        "chat_completions": "chat_completions",
        "responses": "codex_responses",
        "openai_responses": "codex_responses",
        "codex_responses": "codex_responses",
        "anthropic": "anthropic_messages",
        "messages": "anthropic_messages",
        "anthropic_messages": "anthropic_messages",
        "bedrock": "bedrock_converse",
        "bedrock_converse": "bedrock_converse",
    }
    return aliases.get(raw, raw if raw in _PROTOCOL_MODES else "")


def _protocol_mode_label(mode: str) -> str:
    return {
        "chat_completions": "Chat Completions",
        "codex_responses": "Responses",
        "anthropic_messages": "Anthropic Messages",
        "bedrock_converse": "Bedrock Converse",
    }.get(mode, "")


def _provider_entries(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    values = config.get("providers")
    if not isinstance(values, dict):
        return {}
    return {str(key): value for key, value in values.items() if isinstance(value, dict)}


def _provider_entry(config: dict[str, Any], provider: str) -> tuple[str | None, dict[str, Any] | None]:
    wanted = str(provider or "").strip().lower()
    if not wanted:
        return None, None
    for key, entry in _provider_entries(config).items():
        aliases = {
            key.strip().lower(),
            str(entry.get("name") or "").strip().lower(),
            str(entry.get("slug") or "").strip().lower(),
        }
        if wanted in aliases:
            return key, entry
    return None, None


def _entry_base_url(entry: dict[str, Any] | None) -> str:
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("api") or entry.get("url") or entry.get("base_url") or "").strip().rstrip("/")


def _entry_global_protocol(entry: dict[str, Any] | None) -> str:
    if not isinstance(entry, dict):
        return ""
    return _canonical_protocol_mode(entry.get("transport") or entry.get("api_mode"))


def _entry_model_protocol(entry: dict[str, Any] | None, model: str) -> str:
    if not isinstance(entry, dict):
        return ""
    models = entry.get("models")
    if not isinstance(models, dict):
        return ""
    item = models.get(model)
    return _canonical_protocol_mode(item.get("transport") or item.get("api_mode")) if isinstance(item, dict) else ""


def _option_provider(options: dict[str, Any], provider: str) -> dict[str, Any] | None:
    wanted = str(provider or "").strip()
    rows = options.get("providers") if isinstance(options, dict) else None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("slug") or "").strip() == wanted:
            return row
        if wanted in {str(alias).strip() for alias in (row.get("aliases") or [])}:
            return row
    return None


def _option_model_protocol(options: dict[str, Any], provider: str, model: str) -> str:
    row = _option_provider(options, provider)
    if not row:
        return ""
    capabilities = row.get("capabilities")
    item = capabilities.get(model) if isinstance(capabilities, dict) else None
    if isinstance(item, dict):
        mode = _canonical_protocol_mode(
            item.get("api_mode") or item.get("transport") or item.get("protocol") or item.get("apiMode")
        )
        if mode:
            return mode
    return _canonical_protocol_mode(
        row.get("api_mode") or row.get("transport") or row.get("protocol")
    )


def _is_managed_protocol_entry(provider: str, entry: dict[str, Any] | None) -> bool:
    if str(provider or "").strip().lower().startswith("hws-protocol-"):
        return True
    marker = entry.get("hws_protocol_bridge") if isinstance(entry, dict) else None
    return isinstance(marker, dict) and bool(marker.get("source_provider"))


def _managed_protocol_source(provider: str, entry: dict[str, Any] | None) -> str:
    marker = entry.get("hws_protocol_bridge") if isinstance(entry, dict) else None
    if isinstance(marker, dict) and marker.get("source_provider"):
        return str(marker["source_provider"])
    return provider


def _protocol_key(provider: str, model: str) -> str:
    return f"{str(provider).strip()}\n{str(model).strip()}"


def _read_protocol_state() -> dict[str, Any]:
    try:
        payload = json.loads(_PROTOCOL_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"routes": {}}
    routes = payload.get("routes") if isinstance(payload, dict) else None
    return {"routes": routes if isinstance(routes, dict) else {}}


def _write_protocol_state(payload: dict[str, Any]) -> None:
    _PROTOCOL_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = _PROTOCOL_FILE.with_name(f".{_PROTOCOL_FILE.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, _PROTOCOL_FILE)
    try:
        os.chmod(_PROTOCOL_FILE, 0o600)
    except OSError:
        pass


def _route_state(provider: str, model: str) -> dict[str, Any] | None:
    with _PROTOCOL_LOCK:
        value = _read_protocol_state()["routes"].get(_protocol_key(provider, model))
    return value if isinstance(value, dict) else None


def _save_route_state(provider: str, model: str, record: dict[str, Any]) -> dict[str, Any]:
    clean = {
        key: record[key]
        for key in (
            "source_provider",
            "source_model",
            "mode",
            "status",
            "execution_provider",
            "probed_at",
            "results",
            "error",
        )
        if key in record
    }
    with _PROTOCOL_LOCK:
        payload = _read_protocol_state()
        payload["routes"][_protocol_key(provider, model)] = clean
        _write_protocol_state(payload)
    return clean


def _protocol_alias_name(provider: str, model: str, mode: str, base_url: str) -> str:
    suffix = {
        "chat_completions": "chat",
        "codex_responses": "responses",
        "anthropic_messages": "messages",
        "bedrock_converse": "bedrock",
    }.get(mode, mode.replace("_", "-"))
    digest = hashlib.sha256(
        f"{provider}\0{model}\0{base_url}".encode("utf-8")
    ).hexdigest()[:14]
    return f"hws-protocol-{digest}-{suffix}"


def _ensure_protocol_aliases(
    config: dict[str, Any],
    provider: str,
    model: str,
    modes: tuple[str, ...] = _PROBE_MODES,
) -> tuple[dict[str, Any], dict[str, str]]:
    stored_key, source = _provider_entry(config, provider)
    if source is None or not _entry_base_url(source):
        raise HTTPException(409, f"Provider “{provider}” 不是可兼容的自定义 HTTP endpoint，无法建立按模型协议路由。")
    source_name = str(source.get("name") or stored_key or provider)
    providers = _provider_entries(config)
    changed = False
    aliases: dict[str, str] = {}
    for mode in modes:
        if mode not in _PROTOCOL_MODES:
            continue
        alias = _protocol_alias_name(stored_key or provider, model, mode, _entry_base_url(source))
        aliases[mode] = alias
        existing = providers.get(alias)
        marker = existing.get("hws_protocol_bridge") if isinstance(existing, dict) else None
        if not isinstance(existing, dict) or not isinstance(marker, dict) or marker.get("source_provider") != (stored_key or provider) or marker.get("source_model") != model or marker.get("mode") != mode:
            entry = copy.deepcopy(source)
            entry["name"] = f"{source_name} · HWS { _protocol_mode_label(mode) } · {model}"
            entry["transport"] = mode
            entry.pop("api_mode", None)
            entry["default_model"] = model
            source_models = source.get("models")
            if isinstance(source_models, dict) and model in source_models:
                entry["models"] = {model: copy.deepcopy(source_models[model])}
            else:
                entry["models"] = {model: {}}
            entry["hws_protocol_bridge"] = {
                "source_provider": stored_key or provider,
                "source_model": model,
                "mode": mode,
                "managed_by": "hermes-worker-studio",
            }
            providers[alias] = entry
            changed = True
    if changed:
        config["providers"] = providers
        # This is an official Hermes config write. The aliases are a narrow
        # compatibility fallback for a pinned core that cannot express
        # per-model transport inside one generic provider.
        # Send only the changed provider map. Hermes' official config endpoint
        # deep-merges this payload, and keeping unrelated sections out of the
        # request prevents an expanded credential or another private setting
        # from being echoed back through an unrelated protocol selection.
        try:
            _legacy._hermes_proxy("/api/config", method="PUT", body={"config": {"providers": providers}})
        except HTTPException as exc:
            if int(exc.status_code or 0) not in _CONFIG_ROUTE_UNAVAILABLE:
                raise
            # The fallback is still Hermes-owned: use the same config module
            # and raw-config deep-merge semantics as web_server.update_config.
            with _OFFICIAL_CONFIG_LOCK:
                _write_hermes_config_store_providers(providers)
    return config, aliases


def _is_custom_endpoint(config: dict[str, Any], provider: str) -> bool:
    _key, entry = _provider_entry(config, provider)
    return entry is not None and bool(_entry_base_url(entry)) and not _is_managed_protocol_entry(provider, entry)


def _protocol_route_snapshot(
    config: dict[str, Any],
    options: dict[str, Any],
    provider: str,
    model: str,
    *,
    ensure_alias: bool = False,
) -> dict[str, Any]:
    source_provider = str(provider or "").strip()
    source_model = str(model or "").strip()
    if not source_provider or not source_model:
        raise HTTPException(400, "provider and model are required")
    _stored_key, entry = _provider_entry(config, source_provider)
    declared = _option_model_protocol(options, source_provider, source_model)
    global_mode = _entry_global_protocol(entry)
    model_mode = _entry_model_protocol(entry, source_model)
    if declared:
        if _is_custom_endpoint(config, source_provider) and ensure_alias:
            config, aliases = _ensure_protocol_aliases(config, source_provider, source_model, (declared,))
            return {
                "provider": source_provider,
                "model": source_model,
                "mode": declared,
                "status": "declared",
                "requires_probe": False,
                "execution_provider": aliases.get(declared, source_provider),
                "source": "hermes_official_model_inventory+compatibility_alias",
            }
        return {
            "provider": source_provider,
            "model": source_model,
            "mode": declared,
            "status": "declared",
            "requires_probe": False,
            "execution_provider": source_provider,
            "source": "hermes_official_model_inventory",
        }
    # A generic provider-wide transport is already an official Hermes choice.
    # A model-specific transport on a generic provider needs the alias bridge
    # because Hermes 0.20.6 does not route that field per model.
    if global_mode and not model_mode:
        return {
            "provider": source_provider,
            "model": source_model,
            "mode": global_mode,
            "status": "declared",
            "requires_probe": False,
            "execution_provider": source_provider,
            "source": "hermes_official_provider_config",
        }
    state = _route_state(source_provider, source_model)
    if isinstance(state, dict):
        status = str(state.get("status") or "").strip().lower()
        mode = _canonical_protocol_mode(state.get("mode"))
        if status in {"resolved", "manual"} and mode:
            execution_provider = str(state.get("execution_provider") or "").strip()
            alias_key, alias_entry = _provider_entry(config, execution_provider)
            alias_marker = alias_entry.get("hws_protocol_bridge") if isinstance(alias_entry, dict) else None
            alias_is_current = (
                bool(alias_key)
                and isinstance(alias_marker, dict)
                and str(alias_marker.get("source_provider") or "") == str(_stored_key or source_provider)
                and str(alias_marker.get("source_model") or "") == source_model
                and str(alias_marker.get("mode") or "") == mode
            )
            if ensure_alias and not alias_is_current:
                config, aliases = _ensure_protocol_aliases(config, source_provider, source_model, (mode,))
                execution_provider = aliases.get(mode, "")
            return {
                "provider": source_provider,
                "model": source_model,
                "mode": mode,
                "status": status,
                "requires_probe": False,
                "execution_provider": execution_provider or source_provider,
                "source": "hermes-worker-studio-real-run-probe" if status == "resolved" else "hermes-worker-studio-manual-choice",
                "probed_at": state.get("probed_at"),
            }
        if status == "ambiguous":
            return {
                "provider": source_provider,
                "model": source_model,
                "mode": "",
                "status": "ambiguous",
                "requires_probe": True,
                "requires_choice": True,
                "execution_provider": "",
                "source": "hermes-worker-studio-real-run-probe",
                "probed_at": state.get("probed_at"),
                "results": state.get("results") or {},
                "error": state.get("error") or "两种官方协议都返回成功，无法无依据地选择。",
            }
    if model_mode and _is_custom_endpoint(config, source_provider):
        # Explicit per-model metadata is still honored, but via an isolated
        # managed provider alias so another model on the same endpoint cannot
        # inherit the wrong wire protocol.
        if ensure_alias:
            config, aliases = _ensure_protocol_aliases(config, source_provider, source_model, (model_mode,))
            return {
                "provider": source_provider,
                "model": source_model,
                "mode": model_mode,
                "status": "declared",
                "requires_probe": False,
                "execution_provider": aliases.get(model_mode, source_provider),
                "source": "hermes_official_provider_model_config+compatibility_alias",
            }
        return {
            "provider": source_provider,
            "model": source_model,
            "mode": model_mode,
            "status": "declared",
            "requires_probe": False,
            "execution_provider": source_provider,
            "source": "hermes_official_provider_model_config",
        }
    if _is_custom_endpoint(config, source_provider):
        return {
            "provider": source_provider,
            "model": source_model,
            "mode": "",
            "status": "unresolved",
            "requires_probe": True,
            "execution_provider": "",
            "source": "hermes-worker-studio-awaiting-real-run-probe",
            "error": "Hermes 没有声明该自定义 endpoint 的每模型协议；请执行官方真实 Run 探测。",
        }
    return {
        "provider": source_provider,
        "model": source_model,
        "mode": "",
        "status": "native",
        "requires_probe": False,
        "execution_provider": source_provider,
        "source": "hermes_official_provider_runtime",
    }


def _protocol_routes_payload() -> dict[str, Any]:
    config = _read_official_config()
    options = _read_official_model_options()
    rows: list[dict[str, Any]] = []
    for row in options.get("providers", []) if isinstance(options.get("providers"), list) else []:
        if not isinstance(row, dict):
            continue
        provider = str(row.get("slug") or "").strip()
        _key, entry = _provider_entry(config, provider)
        if not provider or _is_managed_protocol_entry(provider, entry):
            continue
        for model in row.get("models") if isinstance(row.get("models"), list) else []:
            model_name = str(model or "").strip()
            if not model_name:
                continue
            try:
                rows.append(_protocol_route_snapshot(config, options, provider, model_name))
            except HTTPException as exc:
                rows.append({"provider": provider, "model": model_name, "status": "unavailable", "mode": "", "requires_probe": False, "error": str(exc.detail)})
    return {"routes": rows, "source": "hermes_official_model_options+hermes_worker_studio_state"}


def _probe_protocols_sync(provider: str, model: str) -> dict[str, Any]:
    config = _read_official_config()
    options = _read_official_model_options()
    if not _is_custom_endpoint(config, provider):
        route = _protocol_route_snapshot(config, options, provider, model)
        return {"route": route, "results": {}, "source": route.get("source")}
    config, aliases = _ensure_protocol_aliases(config, provider, model)
    results: dict[str, Any] = {}
    for mode in _PROBE_MODES:
        alias = aliases.get(mode)
        if not alias:
            results[mode] = {"ok": False, "status": "not_configured", "error": "managed alias unavailable"}
            continue
        try:
            started = _legacy._start_native_run(
                {
                    "input": "Reply with exactly: HERMES_WORKER_STUDIO_PROTOCOL_OK",
                    "provider": alias,
                    "model": model,
                },
                session_required=False,
            )
            final = _legacy._wait_ephemeral_run(
                started["id"],
                float(os.getenv("HERMES_WORKER_STUDIO_PROTOCOL_PROBE_TIMEOUT", "90")),
            )
            status = str(final.get("status") or "").strip().lower()
            results[mode] = {
                "ok": status == "completed",
                "status": status,
                "run_id": started.get("id"),
                "error": final.get("error"),
            }
        except HTTPException as exc:
            results[mode] = {"ok": False, "status": "error", "error": str(exc.detail)}
        except Exception as exc:  # pragma: no cover - defensive boundary
            results[mode] = {"ok": False, "status": "error", "error": f"{type(exc).__name__}: {exc}"}
    good = [mode for mode, result in results.items() if result.get("ok") is True]
    if len(good) == 1:
        mode = good[0]
        status = "resolved"
        error = ""
        execution_provider = aliases[mode]
    elif len(good) > 1:
        mode = ""
        status = "ambiguous"
        error = "Chat Completions 与 Responses 均真实 Run 成功；请选择该模型的官方协议。"
        execution_provider = ""
    else:
        mode = ""
        status = "unresolved"
        error = "两种官方协议真实 Run 均未完成；请检查 endpoint 的实际支持情况。"
        execution_provider = ""
    record = _save_route_state(provider, model, {
        "source_provider": provider,
        "source_model": model,
        "mode": mode,
        "status": status,
        "execution_provider": execution_provider,
        "probed_at": time.time(),
        "results": results,
        "error": error,
    })
    route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
    route["results"] = results
    route["error"] = error or route.get("error")
    return {
        "ok": status == "resolved",
        "status": status,
        "route": route,
        "results": results,
        "source": "hermes-worker-studio-real-run-probe",
        "state": record,
    }


def _manual_protocol_route_sync(provider: str, model: str, mode: str) -> dict[str, Any]:
    mode = _canonical_protocol_mode(mode)
    if mode not in _PROTOCOL_MODES:
        raise HTTPException(400, "mode must be chat_completions, codex_responses, anthropic_messages, bedrock_converse, or auto")
    config = _read_official_config()
    options = _read_official_model_options()
    if not _is_custom_endpoint(config, provider):
        declared = _protocol_route_snapshot(config, options, provider, model)
        if declared.get("mode") != mode:
            raise HTTPException(409, f"Hermes 官方 provider 不接受手动覆盖协议：当前声明为 {declared.get('mode') or 'Auto'}。")
        return declared
    config, aliases = _ensure_protocol_aliases(config, provider, model, (mode,))
    _save_route_state(provider, model, {
        "source_provider": provider,
        "source_model": model,
        "mode": mode,
        "status": "manual",
        "execution_provider": aliases[mode],
        "probed_at": time.time(),
        "error": "用户通过 Studio 选择；未把选择伪装成 Hermes capability。",
    })
    return _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)


def _resolve_route_for_run(provider: str, model: str) -> dict[str, Any]:
    config = _read_official_config()
    options = _read_official_model_options()
    route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
    if route.get("requires_probe"):
        raise HTTPException(
            409,
            f"模型 “{provider} / {model}” 的协议尚未确定。请先到“模型”页面执行官方真实 Run 探测；不会按模型名猜测 v1 或 v1/responses。",
        )
    return route


def _reverse_moa_provider(provider: Any, config: dict[str, Any]) -> str:
    raw = str(provider or "").strip()
    _key, entry = _provider_entry(config, raw)
    if _is_managed_protocol_entry(raw, entry):
        return _managed_protocol_source(raw, entry)
    return raw


def _reverse_moa_config(payload: Any, config: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(payload) if isinstance(payload, dict) else {}
    presets = result.get("presets")
    if not isinstance(presets, dict):
        presets = {}
    for preset in presets.values():
        if not isinstance(preset, dict):
            continue
        slots = []
        refs = preset.get("reference_models")
        if isinstance(refs, list):
            slots.extend(refs)
        agg = preset.get("aggregator")
        if isinstance(agg, dict):
            slots.append(agg)
        for slot in slots:
            if isinstance(slot, dict) and slot.get("provider"):
                slot["provider"] = _reverse_moa_provider(slot["provider"], config)
    return result


def _translate_moa_config_for_official(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(400, "MOA config must be an object")
    result = copy.deepcopy(payload)
    config = _read_official_config()
    options = _read_official_model_options()
    presets = result.get("presets")
    if not isinstance(presets, dict):
        raise HTTPException(422, "MOA presets must be an object")
    for preset in presets.values():
        if not isinstance(preset, dict):
            continue
        refs = preset.get("reference_models") if isinstance(preset.get("reference_models"), list) else []
        slots = [slot for slot in refs if isinstance(slot, dict)]
        if isinstance(preset.get("aggregator"), dict):
            slots.append(preset["aggregator"])
        for slot in slots:
            provider = str(slot.get("provider") or "").strip()
            model = str(slot.get("model") or "").strip()
            if not provider or not model:
                continue
            route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
            if route.get("requires_probe"):
                raise HTTPException(409, f"MOA 的模型 “{provider} / {model}” 协议尚未确定，请先在模型页完成官方真实 Run 探测。")
            slot["provider"] = route.get("execution_provider") or provider
    return result


def _ensure_moa_execution_config() -> dict[str, Any]:
    """Make the official MoA slots executable before a real Gateway Run.

    The Studio-facing MoA read route deliberately hides managed protocol
    aliases. Native Hermes, however, reads the persisted official MoA config
    when it executes the virtual ``moa`` provider. Resolve the source slots
    against the same official protocol route and write only when a source slot
    must become its isolated alias. This keeps the native runtime authoritative
    without asking the browser to maintain a second MoA configuration.
    """
    raw = _legacy._hermes_proxy("/api/model/moa")
    translated = _translate_moa_config_for_official(raw)
    if translated != raw:
        saved = _legacy._hermes_proxy(
            "/api/model/moa",
            method="PUT",
            body=translated,
        )
        return saved if isinstance(saved, dict) else translated
    return raw if isinstance(raw, dict) else translated


@router.get("/hermes/protocols")
def get_protocol_routes() -> dict[str, Any]:
    """Expose a safe per-model protocol projection from official Hermes data."""
    return _protocol_routes_payload()


@router.get("/hermes/protocol-route")
def get_protocol_route(provider: str = "", model: str = "") -> dict[str, Any]:
    """Resolve one model to an official provider or an explicit bridge alias."""
    config = _read_official_config()
    options = _read_official_model_options()
    # This endpoint is called immediately before an actual Studio Run. If a
    # model-specific declaration/probe needs the compatibility alias required
    # by Hermes 0.20.6's provider-global runtime, materialise it through the
    # official config contract now so the returned execution_provider is real.
    return _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)


@router.post("/hermes/protocols/probe")
async def probe_protocol_route(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "protocol probe body must be an object")
    provider = str(body.get("provider") or "").strip()
    model = str(body.get("model") or "").strip()
    if not provider or not model:
        raise HTTPException(400, "provider and model are required")
    # This endpoint is intentionally an explicit action: it makes up to two
    # billable official Hermes Runs and never runs merely while rendering the
    # Models page.
    return await asyncio.to_thread(_probe_protocols_sync, provider, model)


@router.post("/hermes/protocols/select")
async def select_protocol_route(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "protocol selection body must be an object")
    provider = str(body.get("provider") or "").strip()
    model = str(body.get("model") or "").strip()
    raw_mode = str(body.get("mode") or "").strip().lower()
    if not provider or not model:
        raise HTTPException(400, "provider and model are required")
    if raw_mode in {"", "auto"}:
        with _PROTOCOL_LOCK:
            state = _read_protocol_state()
            state["routes"].pop(_protocol_key(provider, model), None)
            _write_protocol_state(state)
        config = await asyncio.to_thread(_read_official_config)
        options = await asyncio.to_thread(_read_official_model_options)
        return _protocol_route_snapshot(config, options, provider, model, ensure_alias=False)
    return await asyncio.to_thread(_manual_protocol_route_sync, provider, model, raw_mode)


@router.post("/hermes/moa-runtime")
async def ensure_moa_runtime_config(request: Request) -> dict[str, Any]:
    """Resolve per-model custom endpoint aliases for the next native MoA Run."""
    body = await request.json()
    if body is not None and not isinstance(body, dict):
        raise HTTPException(400, "MOA runtime body must be an object")
    resolved = await asyncio.to_thread(_ensure_moa_execution_config)
    return _reverse_moa_config(resolved, _read_official_config())


@router.get("/hermes/moa-config")
def get_moa_config_v3() -> dict[str, Any]:
    """Read official MoA config while hiding Studio's managed aliases."""
    payload = _legacy._hermes_proxy("/api/model/moa")
    return _reverse_moa_config(payload, _read_official_config())


@router.put("/hermes/moa-config")
async def put_moa_config_v3(request: Request) -> dict[str, Any]:
    body = await request.json()
    translated = await asyncio.to_thread(_translate_moa_config_for_official, body)
    saved = await asyncio.to_thread(
        _legacy._hermes_proxy,
        "/api/model/moa",
        method="PUT",
        body=translated,
    )
    return _reverse_moa_config(saved, _read_official_config())


@router.post("/hermes/runs-v3")
async def start_hermes_run_v3(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be an object")
    _legacy._prune_runs()
    return await _legacy.asyncio.to_thread(_start_native_run_v3, body)


@router.get("/hermes/sessions/{session_id}/context")
def get_hermes_session_context(session_id: str) -> dict[str, Any]:
    """Feature-detect and proxy Hermes' official per-session context telemetry."""
    try:
        snapshot = _session_context_snapshot(session_id)
    except HTTPException as exc:
        if int(exc.status_code or 0) in {404, 405, 501}:
            snapshot = None
        else:
            raise
    return snapshot or {
        "available": False,
        "source": "unavailable",
        "reason": "Hermes public session context telemetry is not exposed by this build",
    }


@router.get("/product-capabilities")
def product_capabilities() -> dict[str, Any]:
    return {
        "version": 3,
        "candidate_sha": BUILD_CANDIDATE_SHA,
        "execution": "Hermes official /v1/runs",
        "multimodal_runs": True,
        "session_crud": True,
        "custom_endpoint_crud": True,
        "dashboard_return_slot": True,
        "official_plan": {
            "source": "Hermes canonical todo",
            "runs_event": "todo.updated when upstream exposes it",
            "fallback": "public /api/sessions todo tool result -> todo.snapshot",
            "upstream_issue": "NousResearch/hermes-agent#99686",
        },
        "context_telemetry": {
            "source": "Hermes public /api/sessions/{session_id}/context when available",
            "run_projection": "context.snapshot",
            "compaction": "native context.compaction / official compaction_state only",
            "fallback": "none; cumulative billing tokens are never presented as current context",
        },
        "model_protocols": {
            "source": "Hermes /api/model/options and /api/config",
            "per_model": True,
            "probe": "explicit real Hermes /v1/runs for Chat Completions and Responses",
            "compatibility": "managed provider aliases through official /api/config because pinned generic providers are provider-global",
            "unresolved": "fail closed; no model-name or URL guessing",
        },
        "moa_runtime_resolution": {
            "source": "Hermes official /api/model/moa",
            "execution": "Hermes native virtual moa provider after official per-model route resolution",
            "compatibility": "managed aliases are written only through official Hermes config contracts",
            "unresolved": "fail closed before the native MOA Run",
        },
    }


@router.get("/hermes/sessions/{session_id}/projection")
def get_session_projection(session_id: str) -> dict[str, Any]:
    """Read the Studio archive projection derived from official Gateway events."""
    if not session_id.strip():
        raise HTTPException(400, "session_id is required")
    with _PROJECTION_LOCK:
        return _read_projection(session_id)


@router.put("/hermes/sessions/{session_id}/projection")
async def put_session_projection(session_id: str, request: Request) -> dict[str, Any]:
    """Atomically persist bounded, observable run metadata; no hidden reasoning."""
    if not session_id.strip():
        raise HTTPException(400, "session_id is required")
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, "projection must be an object")
    with _PROJECTION_LOCK:
        previous = _read_projection(session_id)
        safe = _sanitize_projection(payload, previous)
        _write_projection(session_id, safe)
    return safe


@router.get("/hermes/moa-sessions")
def list_moa_sessions() -> dict[str, Any]:
    """Overlay explicit Studio markers on authoritative Hermes session rows."""
    upstream = _legacy._hermes_proxy("/api/sessions?limit=100&offset=0&order=recent&archived=include")
    rows = upstream.get("sessions", []) if isinstance(upstream, dict) else []
    result = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        session_id = str(row.get("id") or row.get("session_id") or "").strip()
        with _PROJECTION_LOCK:
            marker = _read_projection(session_id).get("moa") if session_id else None
        model_config = row.get("model_config") if isinstance(row.get("model_config"), dict) else {}
        if marker or str(row.get("provider") or row.get("model_provider") or model_config.get("provider") or "").lower() == "moa":
            result.append({**row, "studio_moa": marker or {"source": "hermes"}})
    return {"sessions": result, "total": len(result), "source": "hermes_session_api+studio_projection"}
