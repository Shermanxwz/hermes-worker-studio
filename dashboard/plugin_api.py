"""Hermes Worker Studio dashboard backend.

This bridge is intentionally narrow:
- Hermes owns sessions, models, providers, approvals, execution and terminal truth.
- Studio consumes documented HTTP contracts only.
- Worker/Verifier execution is provided by the native plugin's
  PluginContext.subagent_lifecycle surface, not by this HTTP module.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import shlex
import socket
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any, Iterable

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

_JSON_LIMIT = 4 * 1024 * 1024
_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_HTTP_TIMEOUT", "30"))
_STREAM_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_STREAM_TIMEOUT", "7200"))
_RUN_TTL = float(os.getenv("HERMES_WORKER_STUDIO_RUN_TTL", "21600"))
_RUN_EVENT_LIMIT = 10000
_RUN_EVENT_DATA_LIMIT = 1024 * 1024
_TERMINAL_RUN_STATES = {"completed", "failed", "cancelled", "stopped", "incomplete"}


@dataclass(frozen=True)
class Upstream:
    base_url: str
    bearer: str
    name: str


def _env(name: str, fallback: str = "") -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else fallback


def _hermes() -> Upstream:
    return Upstream(
        base_url=_env("HERMES_WORKER_STUDIO_API_URL", "http://127.0.0.1:8642").rstrip("/"),
        bearer=_env("HERMES_WORKER_STUDIO_API_KEY", _env("API_SERVER_KEY")),
        name="Hermes API Server",
    )


def _validate_upstream(upstream: Upstream) -> None:
    parsed = urllib.parse.urlparse(upstream.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(500, f"{upstream.name} URL must be http(s)")
    if parsed.username or parsed.password:
        raise HTTPException(500, f"{upstream.name} URL must not embed credentials")
    if _env("HERMES_WORKER_STUDIO_ALLOW_REMOTE") == "1":
        return
    if parsed.hostname.lower() not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(
            403,
            f"remote {upstream.name} is disabled; set HERMES_WORKER_STUDIO_ALLOW_REMOTE=1 explicitly",
        )


def _url(upstream: Upstream, path: str) -> str:
    _validate_upstream(upstream)
    return upstream.base_url + (path if path.startswith("/") else "/" + path)


def _headers(upstream: Upstream, *, json_body: bool = False, sse: bool = False) -> dict[str, str]:
    headers = {
        "Accept": "text/event-stream" if sse else "application/json",
        "User-Agent": "hermes-worker-studio/2.0",
    }
    if upstream.bearer:
        headers["Authorization"] = f"Bearer {upstream.bearer}"
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _decode_error(exc: urllib.error.HTTPError, upstream: Upstream) -> HTTPException:
    try:
        body = exc.read(_JSON_LIMIT).decode("utf-8", "replace")
        payload = json.loads(body)
        detail = payload.get("error") if isinstance(payload, dict) else payload
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("code") or json.dumps(detail, ensure_ascii=False)
        detail = str(detail or body or exc.reason)
    except Exception:
        detail = str(exc.reason)
    return HTTPException(exc.code, f"{upstream.name}: {detail[:2000]}")


def _request_json(
    upstream: Upstream,
    path: str,
    *,
    method: str = "GET",
    body: Any | None = None,
    timeout: float = _TIMEOUT,
) -> Any:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        _url(upstream, path),
        data=data,
        method=method,
        headers=_headers(upstream, json_body=body is not None),
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(_JSON_LIMIT + 1)
            if len(raw) > _JSON_LIMIT:
                raise HTTPException(502, f"{upstream.name} response exceeded {_JSON_LIMIT} bytes")
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as exc:
        raise _decode_error(exc, upstream) from exc
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError) as exc:
        raise HTTPException(503, f"{upstream.name} unavailable: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(502, f"{upstream.name} returned invalid JSON") from exc


def _stream_request(upstream: Upstream, path: str) -> Iterable[bytes]:
    request = urllib.request.Request(
        _url(upstream, path),
        method="GET",
        headers=_headers(upstream, sse=True),
    )
    response = None
    try:
        response = urllib.request.urlopen(request, timeout=_STREAM_TIMEOUT)
        while True:
            chunk = response.readline()
            if not chunk:
                break
            yield chunk
    except urllib.error.HTTPError as exc:
        payload = {"error": _decode_error(exc, upstream).detail}
        yield f"event: studio.transport.error\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
    except Exception as exc:
        payload = {"error": f"{upstream.name} stream failed: {type(exc).__name__}: {exc}"}
        yield f"event: studio.transport.error\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
    finally:
        if response is not None:
            response.close()


def _hermes_proxy(path: str, method: str = "GET", body: Any | None = None, timeout: float = _TIMEOUT) -> Any:
    return _request_json(_hermes(), path, method=method, body=body, timeout=timeout)


def _feature(capabilities: Any, name: str) -> bool:
    if not isinstance(capabilities, dict):
        return False
    features = capabilities.get("features")
    if isinstance(features, dict) and name in features:
        return features.get(name) is True
    return capabilities.get(name) is True


def _run_support() -> dict[str, bool]:
    capabilities = _hermes_proxy("/v1/capabilities")
    return {
        "submission": _feature(capabilities, "run_submission"),
        "events": _feature(capabilities, "run_events_sse"),
        "stop": _feature(capabilities, "run_stop"),
        # Hermes 0.20.6 names this capability ``run_approval_response``;
        # retain the shorter alias for older public snapshots.
        "approval": _feature(capabilities, "run_approval_response") or _feature(capabilities, "run_approval"),
        "steer": _feature(capabilities, "run_steer"),
    }


def _require_runs() -> dict[str, bool]:
    support = _run_support()
    if not support["submission"]:
        raise HTTPException(
            409,
            "Hermes native Runs API is required; Worker Studio 2.x has no legacy execution fallback.",
        )
    return support


_RUNS: dict[str, dict[str, Any]] = {}
_RUNS_LOCK = threading.RLock()


def _prune_runs(now: float | None = None) -> None:
    now = now or time.time()
    with _RUNS_LOCK:
        stale = [
            run_id
            for run_id, run in _RUNS.items()
            if now - float(run.get("started_at") or now) > _RUN_TTL
        ]
        for run_id in stale:
            _RUNS.pop(run_id, None)


def _safe_event_data(raw: str) -> Any:
    if len(raw.encode("utf-8", "replace")) > _RUN_EVENT_DATA_LIMIT:
        raw = raw[:_RUN_EVENT_DATA_LIMIT] + "\n[studio: event payload truncated]"
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {"raw": raw}


def _project_sse_event(event_name: str, data: Any) -> tuple[str, Any]:
    """Project Hermes' generic SSE envelope to its documented event name."""
    effective_name = event_name or "message"
    if effective_name == "message" and isinstance(data, dict):
        embedded_name = data.get("event")
        if isinstance(embedded_name, str) and embedded_name.strip():
            effective_name = embedded_name.strip()
    return effective_name, data


def _append_run_event(run_id: str, name: str, data: Any) -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return
        events: list[dict[str, Any]] = run["events"]
        seq = int(run.get("last_seq") or 0) + 1
        run["last_seq"] = seq
        events.append({"seq": seq, "event": name or "message", "data": data, "at": time.time()})
        if len(events) > _RUN_EVENT_LIMIT:
            del events[: len(events) - _RUN_EVENT_LIMIT]
            run["truncated"] = True
        lowered = (name or "").lower()
        if lowered == "run.completed":
            run["status"] = "completed"
            run["ended_at"] = time.time()
        elif lowered in {"run.failed", "run.error"}:
            run["status"] = "failed"
            run["ended_at"] = time.time()
        elif lowered in {"run.cancelled", "run.canceled", "run.stopped"}:
            run["status"] = "cancelled"
            run["ended_at"] = time.time()


def _consume_sse(run_id: str, wire: Iterable[bytes]) -> None:
    event_name = "message"
    data_lines: list[str] = []
    for raw_line in wire:
        line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
        if not line:
            if data_lines:
                data = _safe_event_data("\n".join(data_lines))
                # Hermes 0.20.6 may use the generic SSE envelope
                # ``event: message`` while carrying the documented lifecycle
                # name in the JSON payload.
                effective_name, data = _project_sse_event(event_name, data)
                _append_run_event(run_id, effective_name, data)
            event_name = "message"
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    if data_lines:
        data = _safe_event_data("\n".join(data_lines))
        effective_name, data = _project_sse_event(event_name, data)
        _append_run_event(run_id, effective_name, data)


def _new_run_record(run_id: str, session_id: str | None, status: str) -> dict[str, Any]:
    now = time.time()
    with _RUNS_LOCK:
        _RUNS[run_id] = {
            "session_id": session_id,
            "status": status,
            "started_at": now,
            "ended_at": None,
            "last_seq": 0,
            "events": [],
            "truncated": False,
        }
    return {"id": run_id, "session_id": session_id, "transport": "official_runs", "status": status, "started_at": now}


def _refresh_official_run(run_id: str) -> dict[str, Any]:
    payload = _hermes_proxy(f"/v1/runs/{urllib.parse.quote(run_id, safe='')}")
    if not isinstance(payload, dict):
        raise HTTPException(502, "Hermes run status is not an object")
    status = str(payload.get("status") or "running").lower()
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            raise HTTPException(404, "run not found or expired")
        run["status"] = status
        for field in ("output", "usage", "error", "model", "provider", "pending_steer"):
            if field in payload:
                run[field] = payload[field]
        if status in _TERMINAL_RUN_STATES and not run.get("ended_at"):
            run["ended_at"] = time.time()
    return payload


def _consume_official_run_events(run_id: str) -> None:
    try:
        _consume_sse(run_id, _stream_request(_hermes(), f"/v1/runs/{urllib.parse.quote(run_id, safe='')}/events"))
    finally:
        try:
            _refresh_official_run(run_id)
        except HTTPException as exc:
            _append_run_event(run_id, "studio.transport.error", {"error": str(exc.detail)})


def _run_snapshot(run_id: str, after: int = 0) -> dict[str, Any]:
    _prune_runs()
    with _RUNS_LOCK:
        if run_id not in _RUNS:
            raise HTTPException(404, "run not found or expired")
    sync_error = None
    try:
        _refresh_official_run(run_id)
    except HTTPException as exc:
        sync_error = str(exc.detail)
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            raise HTTPException(404, "run not found or expired")
        ended = run.get("ended_at")
        now = time.time()
        snapshot = {
            "id": run_id,
            "transport": "official_runs",
            "session_id": run.get("session_id"),
            "status": run["status"],
            "started_at": run["started_at"],
            "ended_at": ended,
            "elapsed_ms": int(((ended or now) - run["started_at"]) * 1000),
            "last_seq": run.get("last_seq", 0),
            "truncated": bool(run.get("truncated")),
            "events": [dict(item) for item in run["events"] if int(item.get("seq") or 0) > after],
        }
        for field in ("output", "usage", "error", "model", "provider", "pending_steer"):
            if field in run:
                snapshot[field] = run[field]
        if sync_error:
            snapshot["status_sync_error"] = sync_error
        return snapshot


def _official_run_body(body: dict[str, Any], session_id: str | None, message: str) -> dict[str, Any]:
    outgoing: dict[str, Any] = {"input": message}
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


def _start_native_run(body: dict[str, Any], *, session_required: bool) -> dict[str, Any]:
    session_id = str(body.get("session_id") or "").strip() or None
    message = str(body.get("message") or body.get("input") or "").strip()
    if session_required and not session_id:
        raise HTTPException(400, "session_id is required")
    if not message:
        raise HTTPException(400, "message/input is required")
    support = _require_runs()
    upstream = _hermes_proxy("/v1/runs", method="POST", body=_official_run_body(body, session_id, message))
    if not isinstance(upstream, dict):
        raise HTTPException(502, "Hermes /v1/runs returned a non-object")
    run_id = str(upstream.get("run_id") or upstream.get("id") or "").strip()
    if not run_id:
        raise HTTPException(502, "Hermes /v1/runs did not return run_id")
    status = str(upstream.get("status") or "running").lower()
    initial = _new_run_record(run_id, session_id, status)
    initial["capabilities"] = support
    if support["events"]:
        threading.Thread(
            target=_consume_official_run_events,
            args=(run_id,),
            name=f"hermes-worker-studio-run-{run_id[-8:]}",
            daemon=True,
        ).start()
    return initial


def _wait_run(run_id: str, timeout_seconds: float) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    final: dict[str, Any] = {}
    while time.time() < deadline:
        final = _hermes_proxy(f"/v1/runs/{urllib.parse.quote(run_id, safe='')}")
        status = str(final.get("status") or "").lower() if isinstance(final, dict) else ""
        if status in _TERMINAL_RUN_STATES:
            return final
        time.sleep(0.25)
    try:
        _hermes_proxy(f"/v1/runs/{urllib.parse.quote(run_id, safe='')}/stop", method="POST", body={})
    except HTTPException:
        pass
    raise HTTPException(504, "Hermes run timed out while Studio was waiting for verification")


@router.get("/health")
def health() -> dict[str, Any]:
    try:
        hermes = _hermes_proxy("/health")
        return {"ok": True, "hermes": hermes, "execution": "Hermes native Runs + subagent lifecycle"}
    except HTTPException as exc:
        return {"ok": False, "hermes": {"ok": False, "status": exc.status_code, "error": exc.detail}}


@router.get("/integration")
def integration_status() -> dict[str, Any]:
    support = _run_support()
    return {
        "hermes": {
            "runs": support,
            "execution_plane": "official_runs" if support["submission"] else "unsupported",
            "worker_plane": "PluginContext.subagent_lifecycle",
            "model_catalog": "/api/model/options",
        }
    }


@router.get("/hermes/capabilities")
def hermes_capabilities() -> Any:
    return _hermes_proxy("/v1/capabilities")


@router.get("/hermes/readiness")
def hermes_readiness() -> Any:
    return _hermes_proxy("/health/detailed")


@router.get("/hermes/model-options")
def hermes_model_options(refresh: int = 0) -> Any:
    return _hermes_proxy("/api/model/options" + ("?refresh=1" if refresh else ""))


@router.post("/hermes/sessions")
async def create_hermes_session(request: Request) -> Any:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "session body must be an object")
    return await asyncio.to_thread(_hermes_proxy, "/api/sessions", method="POST", body=body)


@router.post("/hermes/sessions/{session_id}/model")
async def lock_hermes_session_model(session_id: str, request: Request) -> Any:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "model body must be an object")
    return await asyncio.to_thread(
        _hermes_proxy,
        f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/model",
        method="POST",
        body=body,
    )


@router.post("/hermes/runs")
async def start_hermes_run(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be an object")
    _prune_runs()
    return await asyncio.to_thread(_start_native_run, body, session_required=True)


@router.get("/hermes/runs/{run_id}")
def get_hermes_run(run_id: str, after: int = 0) -> dict[str, Any]:
    return _run_snapshot(run_id, max(0, after))


@router.post("/hermes/runs/{run_id}/stop")
def stop_hermes_run(run_id: str) -> Any:
    _require_runs()
    result = _hermes_proxy(f"/v1/runs/{urllib.parse.quote(run_id, safe='')}/stop", method="POST", body={})
    try:
        _refresh_official_run(run_id)
    except HTTPException:
        pass
    return result


@router.post("/hermes/runs/{run_id}/approval")
async def approve_hermes_run(run_id: str, request: Request) -> Any:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "approval body must be an object")
    choice = str(body.get("choice") or "").lower()
    if choice not in {"once", "session", "always", "deny"}:
        raise HTTPException(400, "choice must be one of once/session/always/deny")
    clean: dict[str, Any] = {"choice": choice}
    if "resolve_all" in body:
        clean["resolve_all"] = body.get("resolve_all") is True
    return await asyncio.to_thread(
        _hermes_proxy,
        f"/v1/runs/{urllib.parse.quote(run_id, safe='')}/approval",
        method="POST",
        body=clean,
    )


@router.post("/hermes/runs/{run_id}/steer")
async def steer_hermes_run(run_id: str, request: Request) -> Any:
    body = await request.json()
    text = str(body.get("input") or "").strip() if isinstance(body, dict) else ""
    if not text:
        raise HTTPException(400, "steer input is required")
    return await asyncio.to_thread(
        _hermes_proxy,
        f"/v1/runs/{urllib.parse.quote(run_id, safe='')}/steer",
        method="POST",
        body={"input": text},
    )


@router.post("/hermes/model-probe")
async def hermes_model_probe(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "probe body must be an object")
    provider = str(body.get("provider") or "").strip()
    model = str(body.get("model") or "").strip()
    if not model:
        raise HTTPException(400, "model is required")
    run_body: dict[str, Any] = {
        "input": "Reply with exactly: HERMES_WORKER_STUDIO_MODEL_OK",
        "model": model,
    }
    if provider:
        run_body["provider"] = provider
    started = await asyncio.to_thread(_start_native_run, run_body, session_required=False)
    final = await asyncio.to_thread(
        _wait_run,
        started["id"],
        float(os.getenv("HERMES_WORKER_STUDIO_MODEL_PROBE_TIMEOUT", "90")),
    )
    status = str(final.get("status") or "").lower()
    return {
        "ok": status == "completed",
        "run_id": started["id"],
        "status": status,
        "provider": final.get("provider") or provider or None,
        "model": final.get("model") or model,
        "output": final.get("output"),
        "error": final.get("error"),
    }


@router.post("/hermes/unattended/probe")
async def hermes_unattended_probe(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict) or body.get("confirm") != "RUN_SAFE_UNATTENDED_PROBE":
        raise HTTPException(400, "explicit unattended probe confirmation is required")
    _require_runs()
    marker = pathlib.Path(tempfile.gettempdir()) / f"hws-unattended-{uuid.uuid4().hex}.txt"
    marker_text = "HERMES_WORKER_STUDIO_UNATTENDED_OK"
    command = f"printf %s {shlex.quote(marker_text)} > {shlex.quote(str(marker))}"
    prompt = (
        "This is an authenticated local unattended-mode verification. "
        "Use the terminal tool to execute exactly this harmless command once, "
        f"then reply with {marker_text}: {command}"
    )
    upstream = await asyncio.to_thread(_hermes_proxy, "/v1/runs", method="POST", body={"input": prompt})
    run_id = str(upstream.get("run_id") or upstream.get("id") or "") if isinstance(upstream, dict) else ""
    if not run_id:
        raise HTTPException(502, "Hermes unattended probe did not return run_id")
    try:
        final = await asyncio.to_thread(
            _wait_run,
            run_id,
            float(os.getenv("HERMES_WORKER_STUDIO_UNATTENDED_PROBE_TIMEOUT", "90")),
        )
        status = str(final.get("status") or "").lower()
        marker_ok = marker.is_file() and marker.read_text(encoding="utf-8", errors="replace") == marker_text
        if status != "completed" or not marker_ok:
            raise HTTPException(
                409,
                {
                    "message": "Hermes unattended probe did not complete the approval-gated marker command",
                    "run_id": run_id,
                    "status": status,
                    "marker_ok": marker_ok,
                    "error": final.get("error") if isinstance(final, dict) else None,
                },
            )
        return {"ok": True, "status": "UNATTENDED_READY", "run_id": run_id, "marker_verified": True}
    finally:
        try:
            marker.unlink(missing_ok=True)
        except OSError:
            pass
