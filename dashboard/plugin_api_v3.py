"""Hermes Worker Studio 3 product bridge.

Extends the sealed 2.x bridge without replacing its execution ownership:
all sessions, models, config, Runs, approvals, and subagents remain Hermes-owned.
This shim adds a multimodal-preserving Runs submission route while reusing the
2.x poll/event/control implementation verbatim.
"""
from __future__ import annotations

import importlib.util
import pathlib
import threading
from typing import Any

from fastapi import HTTPException, Request

_here = pathlib.Path(__file__).resolve()
_spec = importlib.util.spec_from_file_location("hermes_worker_studio_v2_api", _here.with_name("plugin_api.py"))
if _spec is None or _spec.loader is None:  # pragma: no cover - loader invariant
    raise RuntimeError("could not load Worker Studio compatibility bridge")
_legacy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_legacy)

router = _legacy.router


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


def _start_native_run_v3(body: dict[str, Any]) -> dict[str, Any]:
    session_id = str(body.get("session_id") or "").strip() or None
    if not session_id:
        raise HTTPException(400, "session_id is required")

    raw_input: Any = body.get("input")
    if not _has_input(raw_input):
        raw_input = body.get("message")
    if not _has_input(raw_input):
        raise HTTPException(400, "message/input is required")

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
    }
