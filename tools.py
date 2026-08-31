"""Hermes tools backed by codex-worker-delegation's stable local HTTP API."""
from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def _base_url() -> str:
    return (os.getenv("HERMES_WORKER_STUDIO_WORKER_URL") or "http://127.0.0.1:8788").rstrip("/")


def _token() -> str:
    return (os.getenv("HERMES_WORKER_STUDIO_WORKER_TOKEN") or os.getenv("CWD_WEB_TOKEN") or "").strip()


def _safe_url(path: str) -> str:
    base = _base_url()
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("invalid Worker control-plane URL")
    if os.getenv("HERMES_WORKER_STUDIO_ALLOW_REMOTE") != "1":
        host = parsed.hostname.lower()
        if host not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("remote Worker URL requires HERMES_WORKER_STUDIO_ALLOW_REMOTE=1")
    return base + (path if path.startswith("/") else "/" + path)


def _request(path: str, *, method: str = "GET", body: Any | None = None, timeout: float = 60.0) -> Any:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    headers = {"Accept": "application/json", "User-Agent": "hermes-worker-studio/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if _token():
        headers["Authorization"] = f"Bearer {_token()}"
    req = urllib.request.Request(_safe_url(path), data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read(4 * 1024 * 1024).decode("utf-8"))


def _error_payload(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            raw = exc.read(256 * 1024).decode("utf-8", "replace")
            payload = json.loads(raw)
            return json.dumps({"ok": False, "status": exc.code, "error": payload}, ensure_ascii=False)
        except Exception:
            return json.dumps({"ok": False, "status": exc.code, "error": str(exc.reason)}, ensure_ascii=False)
    if isinstance(exc, (urllib.error.URLError, TimeoutError, socket.timeout)):
        return json.dumps({"ok": False, "error": f"Worker unavailable: {exc}"}, ensure_ascii=False)
    return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)


def worker_delegate(args: dict, **kwargs) -> str:
    task = str(args.get("task") or "").strip()
    if not task:
        return json.dumps({"ok": False, "error": "task is required"})
    default_sandbox = (os.getenv("HERMES_WORKER_STUDIO_DEFAULT_SANDBOX") or "danger-full-access").strip()
    if default_sandbox not in {"read-only", "workspace-write", "danger-full-access"}:
        default_sandbox = "danger-full-access"
    body: dict[str, Any] = {
        "task": task,
        "role": args.get("role") or "worker",
        "profile": args.get("profile") or "standard",
        "sandbox": args.get("sandbox") or default_sandbox,
    }
    cwd = str(args.get("cwd") or "").strip()
    if cwd:
        body["cwd"] = cwd
    wait = args.get("wait_for_completion") is True
    try:
        if wait:
            body["waitForCompletion"] = True
            result = _request("/api/worker/run", method="POST", body=body, timeout=7200)
        else:
            result = _request("/api/worker/start", method="POST", body=body, timeout=60)
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
    except Exception as exc:
        return _error_payload(exc)


def worker_status(args: dict, **kwargs) -> str:
    task_id = str(args.get("task_id") or "").strip()
    if not task_id:
        return json.dumps({"ok": False, "error": "task_id is required"})
    try:
        result = _request(f"/api/worker/status/{urllib.parse.quote(task_id, safe='')}")
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
    except Exception as exc:
        return _error_payload(exc)


def worker_catalog(args: dict, **kwargs) -> str:
    del args
    try:
        result = _request("/api/catalog")
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
    except Exception as exc:
        return _error_payload(exc)
