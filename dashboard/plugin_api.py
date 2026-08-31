"""Hermes Worker Studio dashboard backend.

This module is loaded by the official Hermes dashboard plugin loader and only
bridges the browser UI to two official/stable local HTTP surfaces:

* Hermes API Server (default http://127.0.0.1:8642)
* codex-worker-delegation control plane (default http://127.0.0.1:8788)

No Hermes private database internals are touched here. The browser never sees
API_SERVER_KEY or the Worker control-plane token.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter()

_JSON_LIMIT = 4 * 1024 * 1024
_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_HTTP_TIMEOUT", "30"))
_STREAM_TIMEOUT = float(os.getenv("HERMES_WORKER_STUDIO_STREAM_TIMEOUT", "7200"))


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
    """Default to loopback-only upstreams; remote targets require explicit opt-in."""
    parsed = urllib.parse.urlparse(upstream.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(500, f"{upstream.name} URL must be http(s)")
    if _env("HERMES_WORKER_STUDIO_ALLOW_REMOTE") == "1":
        return
    host = parsed.hostname.lower()
    if host in {"127.0.0.1", "::1", "localhost"}:
        return
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or 80)}
    except socket.gaierror as exc:
        raise HTTPException(503, f"cannot resolve {upstream.name}") from exc
    if not addresses or not all(addr.startswith("127.") or addr == "::1" for addr in addresses):
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
    """Yield the upstream SSE stream without re-interpreting Hermes events."""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = _headers(upstream, json_body=True)
    headers["Accept"] = "text/event-stream"
    request = urllib.request.Request(_url(upstream, path), data=data, method="POST", headers=headers)
    response = None
    try:
        response = urllib.request.urlopen(request, timeout=_STREAM_TIMEOUT)
        # SSE is line-oriented. ``read(8192)`` may wait for a full buffer and
        # visibly delay tool/run events; ``readline`` forwards each event line
        # as soon as Hermes emits it while preserving the upstream wire format.
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
    body = await request.json()
    if not isinstance(body, dict) or not str(body.get("message") or "").strip():
        raise HTTPException(400, "message is required")
    upstream = _hermes()
    path = f"/api/sessions/{urllib.parse.quote(session_id, safe='')}/chat/stream"
    return StreamingResponse(
        _stream_request(upstream, path, body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
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
