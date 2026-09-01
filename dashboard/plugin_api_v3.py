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

import importlib.util
import json
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
    messages = payload.get("messages") if isinstance(payload, dict) else None
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
    upstream = _legacy._hermes_proxy(
        "/v1/runs",
        method="POST",
        body=_official_run_body_v3(body, session_id, raw_input),
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
    }
