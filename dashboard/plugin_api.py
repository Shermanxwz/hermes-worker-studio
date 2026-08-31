"""Hermes Worker Studio dashboard backend.

Loaded by the official Hermes dashboard plugin loader.  This is deliberately a
thin adapter over two documented local HTTP contracts:

* Hermes API Server (default http://127.0.0.1:8642)
* codex-worker-delegation control plane (default http://127.0.0.1:8788)

The dashboard browser never receives either upstream bearer token.  Session
listing/search/archive/configuration continue to use the dashboard's own
official REST API directly; this module only handles surfaces that require a
server-side credential or streaming bridge.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any, Iterable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter()

_JSON_LIMIT = 4 * 1024 * 1024
_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_HTTP_TIMEOUT", "30"))
_STREAM_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_STREAM_TIMEOUT", "7200"))
_RUN_TTL = float(os.getenv("HERMES_WORKER_STUDIO_RUN_TTL", "21600"))
_RUN_EVENT_LIMIT = 10000
_RUN_EVENT_DATA_LIMIT = 1024 * 1024


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


def _worker() -> Upstream:
    return Upstream(
        base_url=_env("HERMES_WORKER_STUDIO_WORKER_URL", "http://127.0.0.1:8788").rstrip("/"),
        bearer=_env("HERMES_WORKER_STUDIO_WORKER_TOKEN", _env("CWD_WEB_TOKEN")),
        name="codex-worker-delegation",
    )


def _validate_upstream(upstream: Upstream) -> None:
    """Fail closed to literal loopback hosts unless remote mode is explicit."""
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
    if not path.startswith("/"):
        path = "/" + path
    return upstream.base_url + path


def _headers(upstream: Upstream, *, json_body: bool = False) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "hermes-worker-studio/1.0"}
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
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _decode_error(exc, upstream) from exc
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError) as exc:
        raise HTTPException(503, f"{upstream.name} unavailable: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(502, f"{upstream.name} returned invalid JSON") from exc


def _stream_request(upstream: Upstream, path: str, body: Any) -> Iterable[bytes]:
    """Yield the upstream SSE stream without inventing or renaming events."""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = _headers(upstream, json_body=True)
    headers["Accept"] = "text/event-stream"
    request = urllib.request.Request(_url(upstream, path), data=data, method="POST", headers=headers)
    response = None
    try:
        response = urllib.request.urlopen(request, timeout=_STREAM_TIMEOUT)
        # SSE is line-oriented. readline() forwards lifecycle/tool events as
        # soon as Hermes emits them instead of waiting for a large buffer.
        while True:
            chunk = response.readline()
            if not chunk:
                break
            yield chunk
    except urllib.error.HTTPError as exc:
        message = _decode_error(exc, upstream).detail
        yield f"event: studio.error\ndata: {json.dumps({'error': message}, ensure_ascii=False)}\n\n".encode("utf-8")
    except Exception as exc:
        payload = {"error": f"{upstream.name} stream failed: {type(exc).__name__}: {exc}"}
        yield f"event: studio.error\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
    finally:
        if response is not None:
            response.close()


def _worker_proxy(path: str, method: str = "GET", body: Any | None = None) -> Any:
    return _request_json(_worker(), path, method=method, body=body)


def _hermes_proxy(path: str, method: str = "GET", body: Any | None = None) -> Any:
    return _request_json(_hermes(), path, method=method, body=body)


# ---------------------------------------------------------------------------
# Pollable run bridge
# ---------------------------------------------------------------------------
# Dashboard plugins are officially expected to use SDK.fetchJSON(), which
# carries the dashboard's authentication correctly in both loopback-token and
# gated-cookie modes.  fetchJSON is intentionally JSON-only, while Hermes' run
# surface is SSE.  To avoid teaching the plugin bundle private dashboard auth
# details, the backend consumes the official Hermes SSE and exposes a tiny
# cursor-based JSON poll surface.  Event names/data are preserved verbatim.

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
        if name == "run.completed":
            run["status"] = "completed"
            run["ended_at"] = time.time()
        elif name in {"run.failed", "run.error", "studio.error"}:
            run["status"] = "failed"
            run["ended_at"] = time.time()


def _consume_run_stream(run_id: str, session_id: str, body: dict[str, Any]) -> None:
    event_name = "message"
    data_lines: list[str] = []
    path = f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/chat/stream"
    try:
        for raw_line in _stream_request(_hermes(), path, body):
            line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                if data_lines:
                    _append_run_event(run_id, event_name, _safe_event_data("\n".join(data_lines)))
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
            _append_run_event(run_id, event_name, _safe_event_data("\n".join(data_lines)))
        with _RUNS_LOCK:
            run = _RUNS.get(run_id)
            if run and run.get("status") == "running":
                # A clean EOF without run.completed is still not a fabricated
                # success. Mark it explicitly so the UI can surface the gap.
                run["status"] = "incomplete"
                run["ended_at"] = time.time()
    except Exception as exc:
        _append_run_event(
            run_id,
            "studio.error",
            {"error": f"run bridge failed: {type(exc).__name__}: {exc}"},
        )


def _run_snapshot(run_id: str, after: int = 0) -> dict[str, Any]:
    _prune_runs()
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            raise HTTPException(404, "run not found or expired")
        events = [dict(item) for item in run["events"] if int(item.get("seq") or 0) > after]
        now = time.time()
        ended = run.get("ended_at")
        return {
            "id": run_id,
            "session_id": run["session_id"],
            "status": run["status"],
            "started_at": run["started_at"],
            "ended_at": ended,
            "elapsed_ms": int(((ended or now) - run["started_at"]) * 1000),
            "last_seq": run.get("last_seq", 0),
            "truncated": bool(run.get("truncated")),
            "events": events,
        }


@router.post("/hermes/runs")
async def start_hermes_run(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be an object")
    session_id = str(body.pop("session_id", "") or "").strip()
    message = str(body.get("message") or "").strip()
    if not session_id or not message:
        raise HTTPException(400, "session_id and message are required")
    _prune_runs()
    run_id = "studio_" + uuid.uuid4().hex
    now = time.time()
    with _RUNS_LOCK:
        _RUNS[run_id] = {
            "session_id": session_id,
            "status": "running",
            "started_at": now,
            "ended_at": None,
            "last_seq": 0,
            "events": [],
            "truncated": False,
        }
    thread = threading.Thread(
        target=_consume_run_stream,
        args=(run_id, session_id, dict(body)),
        name=f"hermes-worker-studio-{run_id[-8:]}",
        daemon=True,
    )
    thread.start()
    return {"id": run_id, "session_id": session_id, "status": "running", "started_at": now}


@router.get("/hermes/runs/{run_id}")
def get_hermes_run(run_id: str, after: int = 0) -> dict[str, Any]:
    return _run_snapshot(run_id, max(0, after))


@router.get("/health")
def health() -> dict[str, Any]:
    result: dict[str, Any] = {"ok": True, "hermes": None, "worker": None}
    try:
        result["hermes"] = _hermes_proxy("/health")
    except HTTPException as exc:
        result["ok"] = False
        result["hermes"] = {"ok": False, "status": exc.status_code, "error": exc.detail}
    try:
        result["worker"] = _worker_proxy("/api/health")
    except HTTPException as exc:
        result["worker"] = {"ok": False, "status": exc.status_code, "error": exc.detail}
    return result


@router.get("/hermes/capabilities")
def hermes_capabilities() -> Any:
    return _hermes_proxy("/v1/capabilities")


@router.get("/hermes/model-options")
def hermes_model_options(refresh: int = 0) -> Any:
    suffix = "?refresh=1" if refresh else ""
    return _hermes_proxy(f"/api/model/options{suffix}")


@router.post("/hermes/sessions")
async def create_hermes_session(request: Request) -> Any:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "session body must be an object")
    return await asyncio.to_thread(_hermes_proxy, "/api/sessions", method="POST", body=body)


@router.post("/hermes/sessions/{session_id}/model")
async def lock_hermes_session_model(session_id: str, request: Request) -> Any:
    body = await request.json()
    return await asyncio.to_thread(
        _hermes_proxy,
        f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/model",
        method="POST",
        body=body,
    )


@router.post("/hermes/sessions/{session_id}/chat/stream")
async def stream_hermes_session_chat(session_id: str, request: Request) -> StreamingResponse:
    """Raw SSE passthrough kept for non-dashboard clients and diagnostics."""
    body = await request.json()
    if not isinstance(body, dict) or not str(body.get("message") or "").strip():
        raise HTTPException(400, "message is required")
    upstream = _hermes()
    path = f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/chat/stream"
    return StreamingResponse(
        _stream_request(upstream, path, body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.get("/worker/health")
def worker_health() -> Any:
    return _worker_proxy("/api/health")


@router.get("/worker/state")
def worker_state() -> Any:
    return _worker_proxy("/api/state")


@router.get("/worker/catalog")
def worker_catalog() -> Any:
    return _worker_proxy("/api/catalog")


@router.put("/worker/provider")
async def worker_provider(request: Request) -> Any:
    body = await request.json()
    return await asyncio.to_thread(_worker_proxy, "/api/provider", method="PUT", body=body)


@router.post("/worker/provider/probe")
async def worker_provider_probe(request: Request) -> Any:
    body = await request.json()
    return await asyncio.to_thread(_worker_proxy, "/api/provider/probe", method="POST", body=body)


@router.post("/worker/provider/connectivity")
async def worker_provider_connectivity(request: Request) -> Any:
    body = await request.json()
    return await asyncio.to_thread(_worker_proxy, "/api/provider/connectivity", method="POST", body=body)


@router.put("/worker/mode")
async def worker_mode(request: Request) -> Any:
    body = await request.json()
    return await asyncio.to_thread(_worker_proxy, "/api/mode", method="PUT", body=body)


@router.put("/worker/routing")
async def worker_routing(request: Request) -> Any:
    body = await request.json()
    return await asyncio.to_thread(_worker_proxy, "/api/routing", method="PUT", body=body)


@router.post("/worker/codex/install")
def worker_install_codex() -> Any:
    return _worker_proxy("/api/codex/install", method="POST", body={})


@router.post("/worker/verify/coexistence")
def worker_verify_coexistence() -> Any:
    return _worker_proxy("/api/verify/coexistence", method="POST", body={})


@router.post("/worker/start")
async def worker_start(request: Request) -> Any:
    body = await request.json()
    return await asyncio.to_thread(_worker_proxy, "/api/worker/start", method="POST", body=body)


@router.get("/worker/status/{task_id}")
def worker_status(task_id: str) -> Any:
    return _worker_proxy(f"/api/worker/status/{urllib.parse.quote(task_id, safe='')}")
