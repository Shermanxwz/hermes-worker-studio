"""Hermes Worker Studio 3 product bridge.

Extends the sealed 2.x bridge without replacing its execution ownership:
all sessions, models, config, Runs, approvals, and subagents remain Hermes-owned.
This shim adds a multimodal-preserving Runs submission route and projects the
canonical Hermes todo state from public Session API rows when the pinned public
Runs stream has not emitted a todo snapshot yet.
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
        # If official Runs starts emitting canonical todo events (upstream
        # NousResearch/hermes-agent#99686), prefer them and stop synthesizing
        # the Session-API projection for this run.
        if any("todo" in str(event.get("event") or "").lower() for event in run.get("events", [])):
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


def _run_snapshot_v3(run_id: str, after: int = 0) -> dict[str, Any]:
    snapshot = _base_run_snapshot(run_id, after)
    if _project_session_todo_if_changed(run_id):
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

    # Capture the pre-run canonical revision so an old plan is not re-announced
    # as if the new turn created it.
    try:
        todo_baseline = _latest_session_todo_snapshot(session_id)
    except HTTPException:
        todo_baseline = None

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
    initial["capabilities"] = support
    initial["input_mode"] = "multimodal" if not isinstance(raw_input, str) else "text"
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
# while adding the Product 3 canonical-todo projection.
_legacy._run_snapshot = _run_snapshot_v3


@router.post("/hermes/runs-v3")
async def start_hermes_run_v3(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be an object")
    _legacy._prune_runs()
    return await _legacy.asyncio.to_thread(_start_native_run_v3, body)


@router.get("/product-capabilities")
def product_capabilities() -> dict[str, Any]:
    return {
        "version": 3,
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
    }
