"""Hermes native tools backed by codex-worker-delegation's public HTTP API.

The Worker's mode is an execution policy, not merely UI state.  Every native
Hermes delegation re-reads /api/state and fails closed unless the effective
mode is AUTO or DELEGATE (shown as WORKER in the Web UI).  OFFICIAL returns
control to native Hermes/Codex behavior; MAIN forbids new project-managed
workers.  The Worker server independently enforces the same policy.
"""
from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_VALID_MODES = {"OFFICIAL", "AUTO", "DELEGATE", "MAIN"}
_DELEGATION_MODES = {"AUTO", "DELEGATE"}
_MAX_JSON = 4 * 1024 * 1024


def _base_url() -> str:
    return (os.getenv("HERMES_WORKER_STUDIO_WORKER_URL") or "http://127.0.0.1:8788").rstrip("/")


def _token() -> str:
    return (os.getenv("HERMES_WORKER_STUDIO_WORKER_TOKEN") or os.getenv("CWD_WEB_TOKEN") or "").strip()


def _safe_url(path: str) -> str:
    base = _base_url()
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("invalid Worker control-plane URL")
    if parsed.username or parsed.password:
        raise ValueError("Worker control-plane URL must not embed credentials")
    if os.getenv("HERMES_WORKER_STUDIO_ALLOW_REMOTE") != "1":
        host = parsed.hostname.lower()
        if host not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("remote Worker URL requires HERMES_WORKER_STUDIO_ALLOW_REMOTE=1")
    return base + (path if path.startswith("/") else "/" + path)


def _request(path: str, *, method: str = "GET", body: Any | None = None, timeout: float = 60.0) -> Any:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json", "User-Agent": "hermes-worker-studio/1.1"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    token = _token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(_safe_url(path), data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(_MAX_JSON + 1)
        if len(raw) > _MAX_JSON:
            raise ValueError("Worker response exceeded size limit")
        return json.loads(raw.decode("utf-8")) if raw else {}


def _error_payload(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            raw = exc.read(256 * 1024).decode("utf-8", "replace")
            payload = json.loads(raw)
            return json.dumps({"ok": False, "status": exc.code, "error": payload}, ensure_ascii=False)
        except Exception:
            return json.dumps({"ok": False, "status": exc.code, "error": str(exc.reason)}, ensure_ascii=False)
    if isinstance(exc, (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError)):
        return json.dumps({"ok": False, "error": f"Worker unavailable: {exc}"}, ensure_ascii=False)
    return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)


def _mode(value: Any) -> str:
    mode = str(value or "OFFICIAL").strip().upper()
    if mode == "WORKER":
        mode = "DELEGATE"
    if mode not in _VALID_MODES:
        raise ValueError(f"unknown Worker mode {mode!r}; delegation fails closed")
    return mode


def _policy_state() -> tuple[str, dict[str, Any]]:
    state = _request("/api/state")
    if not isinstance(state, dict):
        raise ValueError("Worker state is not an object")
    return _mode(state.get("mode")), state


def _require_delegation_allowed() -> tuple[str, dict[str, Any]]:
    mode, state = _policy_state()
    if mode not in _DELEGATION_MODES:
        raise PermissionError(
            f"project-managed Worker delegation is disabled in {mode}; "
            "OFFICIAL returns control to native Hermes/Codex and MAIN permits Main only"
        )
    return mode, state


def worker_delegate(args: dict, **kwargs) -> str:
    del kwargs
    task = str(args.get("task") or "").strip()
    if not task:
        return json.dumps({"ok": False, "error": "task is required"})
    default_sandbox = (os.getenv("HERMES_WORKER_STUDIO_DEFAULT_SANDBOX") or "danger-full-access").strip()
    if default_sandbox not in {"read-only", "workspace-write", "danger-full-access"}:
        default_sandbox = "danger-full-access"
    role = str(args.get("role") or "worker").strip().lower()
    if role not in {"worker", "verifier"}:
        return json.dumps({"ok": False, "error": "role must be worker or verifier"})
    body: dict[str, Any] = {
        "task": task,
        "role": role,
        "profile": args.get("profile") or "standard",
        "sandbox": args.get("sandbox") or default_sandbox,
    }
    cwd = str(args.get("cwd") or "").strip()
    if cwd:
        body["cwd"] = cwd
    wait = args.get("wait_for_completion") is True
    try:
        mode, _ = _require_delegation_allowed()
        if wait:
            body["waitForCompletion"] = True
            result = _request("/api/worker/run", method="POST", body=body, timeout=7200)
        else:
            result = _request("/api/worker/start", method="POST", body=body, timeout=60)
        return json.dumps({"ok": True, "mode": mode, "result": result}, ensure_ascii=False)
    except Exception as exc:
        return _error_payload(exc)


def worker_status(args: dict, **kwargs) -> str:
    del kwargs
    task_id = str(args.get("task_id") or "").strip()
    if not task_id:
        return json.dumps({"ok": False, "error": "task_id is required"})
    try:
        result = _request(f"/api/worker/status/{urllib.parse.quote(task_id, safe='')}")
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
    except Exception as exc:
        return _error_payload(exc)


def worker_catalog(args: dict, **kwargs) -> str:
    del args, kwargs
    try:
        mode, state = _policy_state()
        catalog = _request("/api/catalog")
        if not isinstance(catalog, dict):
            raise ValueError("Worker catalog is not an object")
        # Preserve the Worker's catalog shape for backwards-compatible callers
        # while attaching a namespaced policy snapshot for Hermes reasoning.
        result = dict(catalog)
        result["studio_policy"] = {
            "mode": mode,
            "ui_mode": "WORKER" if mode == "DELEGATE" else mode,
            "delegation_allowed": mode in _DELEGATION_MODES,
            "state": state,
        }
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
    except Exception as exc:
        return _error_payload(exc)
