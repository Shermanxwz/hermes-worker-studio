"""Hermes Worker Studio dashboard backend.

Archive-grade bridge built only on public Hermes and codex-worker-delegation
HTTP contracts.  The browser never receives upstream bearer credentials.

Execution policy:
* Prefer Hermes' native /v1/runs lifecycle and control endpoints.
* Fall back to the legacy Session chat/stream contract only when the running
  Hermes capability document explicitly lacks run submission.
* Treat Hermes run status as authoritative; Studio only caches event projection.
* Enforce Worker four-mode delegation boundaries server-side in addition to UI
  and the native Hermes plugin tool.
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
from fastapi.responses import StreamingResponse

router = APIRouter()

_JSON_LIMIT = 4 * 1024 * 1024
_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_HTTP_TIMEOUT", "30"))
_STREAM_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_STREAM_TIMEOUT", "7200"))
_RUN_TTL = float(os.getenv("HERMES_WORKER_STUDIO_RUN_TTL", "21600"))
_RUN_EVENT_LIMIT = 10000
_RUN_EVENT_DATA_LIMIT = 1024 * 1024
_TERMINAL_RUN_STATES = {"completed", "failed", "cancelled", "stopped", "incomplete"}
_DELEGATION_MODES = {"AUTO", "DELEGATE"}
_VALID_WORKER_MODES = {"OFFICIAL", "AUTO", "DELEGATE", "MAIN"}


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


def _headers(upstream: Upstream, *, json_body: bool = False, sse: bool = False) -> dict[str, str]:
    headers = {
        "Accept": "text/event-stream" if sse else "application/json",
        "User-Agent": "hermes-worker-studio/1.1",
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
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _decode_error(exc, upstream) from exc
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError) as exc:
        raise HTTPException(503, f"{upstream.name} unavailable: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(502, f"{upstream.name} returned invalid JSON") from exc


def _stream_request(
    upstream: Upstream,
    path: str,
    body: Any | None = None,
    *,
    method: str = "POST",
) -> Iterable[bytes]:
    """Yield an upstream SSE stream without inventing or renaming events."""
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        _url(upstream, path),
        data=data,
        method=method,
        headers=_headers(upstream, json_body=body is not None, sse=True),
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
        message = _decode_error(exc, upstream).detail
        yield f"event: studio.transport.error\ndata: {json.dumps({'error': message}, ensure_ascii=False)}\n\n".encode("utf-8")
    except Exception as exc:
        payload = {"error": f"{upstream.name} stream failed: {type(exc).__name__}: {exc}"}
        yield f"event: studio.transport.error\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
    finally:
        if response is not None:
            response.close()


def _worker_proxy(path: str, method: str = "GET", body: Any | None = None) -> Any:
    return _request_json(_worker(), path, method=method, body=body)


def _hermes_proxy(path: str, method: str = "GET", body: Any | None = None) -> Any:
    return _request_json(_hermes(), path, method=method, body=body)


def _feature(capabilities: Any, name: str) -> bool:
    if not isinstance(capabilities, dict):
        return False
    features = capabilities.get("features")
    if isinstance(features, dict) and name in features:
        return features.get(name) is True
    return capabilities.get(name) is True


def _run_support() -> dict[str, bool]:
    """Discover the stable Hermes API-server surface; never version-guess."""
    try:
        capabilities = _hermes_proxy("/v1/capabilities")
    except HTTPException as exc:
        if exc.status_code in {404, 405}:
            return {"submission": False, "events": False, "stop": False, "approval": False, "steer": False}
        raise
    return {
        "submission": _feature(capabilities, "run_submission"),
        "events": _feature(capabilities, "run_events_sse"),
        "stop": _feature(capabilities, "run_stop"),
        "approval": _feature(capabilities, "run_approval"),
        # run steer landed as an additive Runs endpoint; older capability
        # documents may omit a dedicated flag, so availability is probed only
        # when the user explicitly calls the endpoint.
        "steer": _feature(capabilities, "run_steer"),
    }


# ---------------------------------------------------------------------------
# Run projection cache
# ---------------------------------------------------------------------------
# Hermes owns execution and terminal truth.  Studio keeps only a bounded event
# projection because Dashboard SDK.fetchJSON is the stable authenticated plugin
# transport while Hermes run events are SSE.

_RUNS: dict[str, dict[str, Any]] = {}
_RUNS_LOCK = threading.RLock()


def _prune_runs(now: float | None = None) -> None:
    now = now or time.time()
    with _RUNS_LOCK:
        stale = [run_id for run_id, run in _RUNS.items() if now - float(run.get("started_at") or now) > _RUN_TTL]
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
        elif name in {"run.failed", "run.error"}:
            run["status"] = "failed"
            run["ended_at"] = time.time()
        elif name in {"run.cancelled", "run.canceled", "run.stopped"}:
            run["status"] = "cancelled"
            run["ended_at"] = time.time()


def _consume_sse(run_id: str, wire: Iterable[bytes], *, legacy_eof_incomplete: bool) -> None:
    event_name = "message"
    data_lines: list[str] = []
    for raw_line in wire:
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
    if legacy_eof_incomplete:
        with _RUNS_LOCK:
            run = _RUNS.get(run_id)
            if run and run.get("status") not in _TERMINAL_RUN_STATES:
                run["status"] = "incomplete"
                run["ended_at"] = time.time()


def _consume_legacy_chat_stream(run_id: str, session_id: str, body: dict[str, Any]) -> None:
    path = f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/chat/stream"
    try:
        _consume_sse(run_id, _stream_request(_hermes(), path, body, method="POST"), legacy_eof_incomplete=True)
    except Exception as exc:
        _append_run_event(run_id, "run.error", {"error": f"legacy run bridge failed: {type(exc).__name__}: {exc}"})


def _refresh_official_run(run_id: str) -> dict[str, Any]:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            raise HTTPException(404, "run not found or expired")
        upstream_run_id = str(run.get("upstream_run_id") or run_id)
    payload = _hermes_proxy(f"/v1/runs/{urllib.parse.quote(upstream_run_id, safe='')}")
    if not isinstance(payload, dict):
        raise HTTPException(502, "Hermes run status is not an object")
    status = str(payload.get("status") or "running").lower()
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if run:
            run["status"] = status
            for field in ("output", "usage", "error", "model", "provider", "pending_steer"):
                if field in payload:
                    run[field] = payload[field]
            if status in _TERMINAL_RUN_STATES and not run.get("ended_at"):
                run["ended_at"] = time.time()
    return payload


def _consume_official_run_events(run_id: str, upstream_run_id: str) -> None:
    path = f"/v1/runs/{urllib.parse.quote(upstream_run_id, safe='')}/events"
    try:
        _consume_sse(run_id, _stream_request(_hermes(), path, None, method="GET"), legacy_eof_incomplete=False)
    finally:
        # Event transport expiry/closure does not decide run truth.  Refresh the
        # authoritative Hermes status once; later UI polls keep refreshing it.
        try:
            _refresh_official_run(run_id)
        except HTTPException as exc:
            _append_run_event(run_id, "studio.transport.error", {"error": str(exc.detail)})


def _run_snapshot(run_id: str, after: int = 0) -> dict[str, Any]:
    _prune_runs()
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            raise HTTPException(404, "run not found or expired")
        transport = run.get("transport")
    sync_error = None
    if transport == "official_runs":
        try:
            _refresh_official_run(run_id)
        except HTTPException as exc:
            sync_error = str(exc.detail)
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            raise HTTPException(404, "run not found or expired")
        events = [dict(item) for item in run["events"] if int(item.get("seq") or 0) > after]
        now = time.time()
        ended = run.get("ended_at")
        snapshot = {
            "id": run_id,
            "upstream_run_id": run.get("upstream_run_id"),
            "transport": run.get("transport"),
            "session_id": run["session_id"],
            "status": run["status"],
            "started_at": run["started_at"],
            "ended_at": ended,
            "elapsed_ms": int(((ended or now) - run["started_at"]) * 1000),
            "last_seq": run.get("last_seq", 0),
            "truncated": bool(run.get("truncated")),
            "events": events,
        }
        for field in ("output", "usage", "error", "model", "provider", "pending_steer"):
            if field in run:
                snapshot[field] = run[field]
        if sync_error:
            snapshot["status_sync_error"] = sync_error
        return snapshot


def _new_run_record(
    run_id: str,
    session_id: str,
    *,
    transport: str,
    upstream_run_id: str | None = None,
    status: str = "running",
) -> dict[str, Any]:
    now = time.time()
    with _RUNS_LOCK:
        _RUNS[run_id] = {
            "session_id": session_id,
            "transport": transport,
            "upstream_run_id": upstream_run_id,
            "status": status,
            "started_at": now,
            "ended_at": None,
            "last_seq": 0,
            "events": [],
            "truncated": False,
        }
    return {"id": run_id, "session_id": session_id, "transport": transport, "status": status, "started_at": now}


def _official_run_body(body: dict[str, Any], session_id: str, message: str) -> dict[str, Any]:
    outgoing: dict[str, Any] = {"input": message, "session_id": session_id}
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


@router.post("/hermes/runs")
async def start_hermes_run(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be an object")
    session_id = str(body.get("session_id") or "").strip()
    message = str(body.get("message") or body.get("input") or "").strip()
    if not session_id or not message:
        raise HTTPException(400, "session_id and message are required")
    _prune_runs()
    support = await asyncio.to_thread(_run_support)
    if support["submission"]:
        upstream = await asyncio.to_thread(
            _hermes_proxy,
            "/v1/runs",
            method="POST",
            body=_official_run_body(body, session_id, message),
        )
        if not isinstance(upstream, dict):
            raise HTTPException(502, "Hermes /v1/runs returned a non-object")
        upstream_run_id = str(upstream.get("run_id") or upstream.get("id") or "").strip()
        if not upstream_run_id:
            raise HTTPException(502, "Hermes /v1/runs did not return run_id")
        status = str(upstream.get("status") or "running").lower()
        initial = _new_run_record(
            upstream_run_id,
            session_id,
            transport="official_runs",
            upstream_run_id=upstream_run_id,
            status=status,
        )
        initial["capabilities"] = support
        if support["events"]:
            thread = threading.Thread(
                target=_consume_official_run_events,
                args=(upstream_run_id, upstream_run_id),
                name=f"hermes-worker-studio-run-{upstream_run_id[-8:]}",
                daemon=True,
            )
            thread.start()
        return initial

    # Compatibility path for older Hermes only.  The fallback is capability
    # gated; a failed current Runs request is never silently re-executed here.
    run_id = "studio_legacy_" + uuid.uuid4().hex
    legacy_body = {"message": message}
    for key in ("instructions", "conversation_history", "previous_response_id"):
        if key in body:
            legacy_body[key] = body[key]
    initial = _new_run_record(run_id, session_id, transport="legacy_chat_stream")
    initial["capabilities"] = support
    thread = threading.Thread(
        target=_consume_legacy_chat_stream,
        args=(run_id, session_id, legacy_body),
        name=f"hermes-worker-studio-legacy-{run_id[-8:]}",
        daemon=True,
    )
    thread.start()
    return initial


@router.get("/hermes/runs/{run_id}")
def get_hermes_run(run_id: str, after: int = 0) -> dict[str, Any]:
    return _run_snapshot(run_id, max(0, after))


def _official_control_target(run_id: str) -> str:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            raise HTTPException(404, "run not found or expired")
        if run.get("transport") != "official_runs":
            raise HTTPException(409, "this run uses legacy chat/stream and has no native Runs control plane")
        return str(run.get("upstream_run_id") or run_id)


@router.post("/hermes/runs/{run_id}/stop")
def stop_hermes_run(run_id: str) -> Any:
    target = _official_control_target(run_id)
    result = _hermes_proxy(f"/v1/runs/{urllib.parse.quote(target, safe='')}/stop", method="POST", body={})
    try:
        _refresh_official_run(run_id)
    except HTTPException:
        pass
    return result


@router.post("/hermes/runs/{run_id}/approval")
async def approve_hermes_run(run_id: str, request: Request) -> Any:
    target = _official_control_target(run_id)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "approval body must be an object")
    choice = str(body.get("choice") or "").lower()
    if choice not in {"once", "session", "always", "deny"}:
        raise HTTPException(400, "choice must be one of once/session/always/deny")
    clean = {"choice": choice}
    if "resolve_all" in body:
        clean["resolve_all"] = body.get("resolve_all") is True
    return await asyncio.to_thread(
        _hermes_proxy,
        f"/v1/runs/{urllib.parse.quote(target, safe='')}/approval",
        method="POST",
        body=clean,
    )


@router.post("/hermes/runs/{run_id}/steer")
async def steer_hermes_run(run_id: str, request: Request) -> Any:
    target = _official_control_target(run_id)
    body = await request.json()
    if not isinstance(body, dict) or not str(body.get("input") or "").strip():
        raise HTTPException(400, "steer input is required")
    return await asyncio.to_thread(
        _hermes_proxy,
        f"/v1/runs/{urllib.parse.quote(target, safe='')}/steer",
        method="POST",
        body={"input": str(body["input"]).strip()},
    )


@router.get("/health")
def health() -> dict[str, Any]:
    result: dict[str, Any] = {"ok": True, "hermes": None, "worker": None, "worker_degraded": False}
    try:
        result["hermes"] = _hermes_proxy("/health")
    except HTTPException as exc:
        result["ok"] = False
        result["hermes"] = {"ok": False, "status": exc.status_code, "error": exc.detail}
    try:
        result["worker"] = _worker_proxy("/api/health")
    except HTTPException as exc:
        # Worker is an optional delegation plane.  Its outage must never mark
        # Hermes OFFICIAL operation itself unhealthy.
        result["worker_degraded"] = True
        result["worker"] = {"ok": False, "status": exc.status_code, "error": exc.detail}
    return result


@router.get("/integration")
def integration_status() -> dict[str, Any]:
    hermes_support = _run_support()
    worker = None
    worker_error = None
    try:
        worker = _worker_proxy("/api/state")
    except HTTPException as exc:
        worker_error = str(exc.detail)
    mode = str(worker.get("mode") or "").upper() if isinstance(worker, dict) else None
    return {
        "hermes": {
            "runs": hermes_support,
            "execution_plane": "official_runs" if hermes_support["submission"] else "legacy_chat_stream",
        },
        "worker": {
            "available": worker is not None,
            "mode": mode,
            "delegation_allowed": mode in _DELEGATION_MODES if mode else False,
            "error": worker_error,
        },
    }


@router.get("/hermes/capabilities")
def hermes_capabilities() -> Any:
    return _hermes_proxy("/v1/capabilities")


@router.get("/hermes/readiness")
def hermes_readiness() -> Any:
    return _hermes_proxy("/health/detailed")


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
    if not isinstance(body, dict):
        raise HTTPException(400, "model body must be an object")
    return await asyncio.to_thread(
        _hermes_proxy,
        f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/model",
        method="POST",
        body=body,
    )


@router.post("/hermes/sessions/{session_id}/chat/stream")
async def stream_hermes_session_chat(session_id: str, request: Request) -> StreamingResponse:
    """Raw legacy SSE passthrough retained only for diagnostics/compatibility."""
    body = await request.json()
    if not isinstance(body, dict) or not str(body.get("message") or "").strip():
        raise HTTPException(400, "message is required")
    path = f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/chat/stream"
    return StreamingResponse(
        _stream_request(_hermes(), path, body, method="POST"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/hermes/unattended/probe")
async def hermes_unattended_probe(request: Request) -> dict[str, Any]:
    """Run a safe real API-server approval probe after config read-back.

    The browser must explicitly opt in.  Hermes itself is asked to execute a
    harmless `bash -c` write to a random file in the system temp directory.
    That command shape normally passes through Hermes' approval gate, so a
    successful marker proves the API-server path did not block waiting for a
    human.  Studio does not alter or bypass Hermes' hardline blocklist.
    """
    body = await request.json()
    if not isinstance(body, dict) or body.get("confirm") != "RUN_SAFE_UNATTENDED_PROBE":
        raise HTTPException(400, "explicit unattended probe confirmation is required")
    support = await asyncio.to_thread(_run_support)
    if not support["submission"]:
        raise HTTPException(409, "Hermes native Runs API is required for the unattended probe")
    marker = pathlib.Path(tempfile.gettempdir()) / f"hws-unattended-{uuid.uuid4().hex}.txt"
    marker_text = "HERMES_WORKER_STUDIO_UNATTENDED_OK"
    command = f"bash -c {shlex.quote('printf %s ' + shlex.quote(marker_text) + ' > ' + shlex.quote(str(marker)))}"
    prompt = (
        "This is a local unattended-mode verification initiated by the authenticated operator. "
        "Use the terminal tool to execute exactly this harmless command once, then reply with "
        f"{marker_text}: {command}"
    )
    upstream = await asyncio.to_thread(_hermes_proxy, "/v1/runs", method="POST", body={"input": prompt})
    run_id = str(upstream.get("run_id") or upstream.get("id") or "") if isinstance(upstream, dict) else ""
    if not run_id:
        raise HTTPException(502, "Hermes unattended probe did not return run_id")
    deadline = time.time() + float(os.getenv("HERMES_WORKER_STUDIO_UNATTENDED_PROBE_TIMEOUT", "90"))
    final: dict[str, Any] = {}
    try:
        while time.time() < deadline:
            final = await asyncio.to_thread(_hermes_proxy, f"/v1/runs/{urllib.parse.quote(run_id, safe='')}")
            status = str(final.get("status") or "").lower() if isinstance(final, dict) else ""
            if status in _TERMINAL_RUN_STATES:
                break
            await asyncio.sleep(0.5)
        else:
            try:
                await asyncio.to_thread(_hermes_proxy, f"/v1/runs/{urllib.parse.quote(run_id, safe='')}/stop", method="POST", body={})
            except HTTPException:
                pass
            raise HTTPException(504, "Hermes unattended probe timed out")
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


# ---------------------------------------------------------------------------
# Worker control plane
# ---------------------------------------------------------------------------


def _normalize_worker_mode(value: Any) -> str:
    mode = str(value or "").strip().upper()
    if mode == "WORKER":
        mode = "DELEGATE"
    if mode not in _VALID_WORKER_MODES:
        raise HTTPException(400, "mode must be OFFICIAL/AUTO/WORKER(DELEGATE)/MAIN")
    return mode


def _worker_mode_state() -> tuple[str, Any]:
    state = _worker_proxy("/api/state")
    if not isinstance(state, dict):
        raise HTTPException(502, "Worker state is not an object")
    return _normalize_worker_mode(state.get("mode") or "OFFICIAL"), state


def _require_worker_delegation_mode() -> tuple[str, Any]:
    mode, state = _worker_mode_state()
    if mode not in _DELEGATION_MODES:
        raise HTTPException(
            409,
            f"project-managed Worker delegation is disabled in {mode}; use AUTO or WORKER/DELEGATE",
        )
    return mode, state


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
    if not isinstance(body, dict):
        raise HTTPException(400, "mode body must be an object")
    mode = _normalize_worker_mode(body.get("mode"))
    return await asyncio.to_thread(_worker_proxy, "/api/mode", method="PUT", body={"mode": mode})


@router.put("/worker/routing")
async def worker_routing(request: Request) -> Any:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "routing body must be an object")
    mode = _normalize_worker_mode(body.get("mode"))
    if mode == "OFFICIAL":
        raise HTTPException(409, "OFFICIAL delegates all routing policy to the native runtime and accepts no project routes")
    clean = dict(body)
    clean["mode"] = mode
    return await asyncio.to_thread(_worker_proxy, "/api/routing", method="PUT", body=clean)


@router.post("/worker/codex/install")
def worker_install_codex() -> Any:
    return _worker_proxy("/api/codex/install", method="POST", body={})


@router.post("/worker/verify/coexistence")
def worker_verify_coexistence() -> Any:
    return _worker_proxy("/api/verify/coexistence", method="POST", body={})


@router.post("/worker/start")
async def worker_start(request: Request) -> Any:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "worker body must be an object")
    await asyncio.to_thread(_require_worker_delegation_mode)
    return await asyncio.to_thread(_worker_proxy, "/api/worker/start", method="POST", body=body)


@router.get("/worker/status/{task_id}")
def worker_status(task_id: str) -> Any:
    return _worker_proxy(f"/api/worker/status/{urllib.parse.quote(task_id, safe='')}")
