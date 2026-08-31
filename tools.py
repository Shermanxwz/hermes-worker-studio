"""Hermes-native Worker Studio tools.

The plugin intentionally owns no execution engine. Child work is launched only
through ``PluginContext.subagent_lifecycle``, the documented public lifecycle
surface provided by Hermes. Model/provider discovery belongs to Hermes
``/api/model/options`` and configuration belongs to Hermes config.
"""
from __future__ import annotations

import dataclasses
import enum
import json
import threading
from typing import Any

_VALID_MODES = {"OFFICIAL", "AUTO", "DELEGATE", "MAIN"}
_DELEGATION_MODES = {"AUTO", "DELEGATE"}
_CTX: Any = None
_HANDLES: dict[str, Any] = {}
_HANDLES_LOCK = threading.RLock()


def bind_context(ctx: Any) -> None:
    """Bind the public PluginContext supplied by Hermes during registration."""
    global _CTX
    _CTX = ctx


def _context() -> Any:
    if _CTX is None:
        raise RuntimeError("Hermes plugin context is not bound")
    return _CTX


def _mode() -> str:
    raw = str(_context().get_config("mode", "AUTO") or "AUTO").strip().upper()
    if raw == "WORKER":
        raw = "DELEGATE"
    if raw not in _VALID_MODES:
        # Configuration is operator-owned. Unknown policy must never silently
        # broaden authority, so fail closed to MAIN semantics.
        return "MAIN"
    return raw


def _plain(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        return _plain(dataclasses.asdict(value))
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(_plain(payload), ensure_ascii=False, default=str)


def _error(exc: Exception) -> str:
    return _dump({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def _remember(handle: Any) -> None:
    subagent_id = str(getattr(handle, "subagent_id", "") or "")
    if not subagent_id:
        return
    with _HANDLES_LOCK:
        _HANDLES[subagent_id] = handle
        # The host lifecycle registry is already bounded. This convenience map
        # is bounded independently so Studio never becomes an unbounded store.
        while len(_HANDLES) > 256:
            _HANDLES.pop(next(iter(_HANDLES)), None)


def _resolve_handle(args: dict[str, Any]) -> Any:
    from agent.subagent_lifecycle import SubagentHandle

    raw = args.get("handle")
    if isinstance(raw, dict):
        return SubagentHandle.from_dict(raw)
    task_id = str(args.get("task_id") or "").strip()
    if task_id:
        with _HANDLES_LOCK:
            handle = _HANDLES.get(task_id)
        if handle is not None:
            return handle
    raise ValueError("handle or a retained task_id is required")


def _wait_seconds(value: Any) -> float | None:
    if value in (None, ""):
        return None
    seconds = float(value)
    if seconds < 0:
        raise ValueError("wait_timeout_seconds must be >= 0")
    return min(seconds, 86_400.0)


def policy_pre_tool_call(tool_name: str = "", args: dict | None = None, **kwargs: Any) -> dict[str, str] | None:
    """Enforce Studio mode at Hermes' documented pre-tool policy boundary."""
    del args, kwargs
    mode = _mode()
    name = str(tool_name or "")
    if mode == "MAIN" and name in {"delegate_task", "worker_delegate"}:
        return {
            "action": "block",
            "message": "Worker Studio MAIN mode forbids new delegated child agents.",
        }
    if mode == "OFFICIAL" and name == "worker_delegate":
        return {
            "action": "block",
            "message": "Worker Studio OFFICIAL mode leaves delegation to Hermes native delegate_task.",
        }
    return None


def worker_delegate(args: dict, **kwargs: Any) -> str:
    del kwargs
    task = str(args.get("task") or "").strip()
    if not task:
        return _dump({"ok": False, "error": "task is required"})
    mode = _mode()
    if mode not in _DELEGATION_MODES:
        return _dump({
            "ok": False,
            "mode": mode,
            "error": (
                "Studio-managed delegation is disabled. OFFICIAL leaves child creation "
                "to Hermes native delegate_task; MAIN forbids new children."
            ),
        })

    product_role = str(args.get("role") or "worker").strip().lower()
    if product_role not in {"worker", "verifier"}:
        return _dump({"ok": False, "error": "role must be worker or verifier"})

    try:
        from agent.subagent_lifecycle import SubagentLaunchRequest

        # Validate every optional wait value before launch. A malformed caller
        # must never create a real child and only then discover its request was
        # invalid.
        wait_timeout = _wait_seconds(args.get("wait_timeout_seconds"))
        context = str(args.get("context") or "").strip() or None
        if product_role == "verifier":
            verifier_brief = (
                "Act as an independent verifier. Inspect the work product and evidence, "
                "look for regressions or unsupported claims, run appropriate checks, and "
                "return findings before any conclusion."
            )
            context = verifier_brief + (f"\n\nContext:\n{context}" if context else "")
        allowed = args.get("allowed_toolsets")
        allowed_toolsets = tuple(str(x) for x in allowed) if isinstance(allowed, list) and allowed else None
        model = str(args.get("model") or "").strip() or None
        correlation_id = str(args.get("correlation_id") or "").strip() or None
        request = SubagentLaunchRequest(
            goal=task,
            context=context,
            role="leaf",
            model=model,
            allowed_toolsets=allowed_toolsets,
            correlation_id=correlation_id,
            metadata={"studio_role": product_role},
        )
        service = _context().subagent_lifecycle
        handle = service.launch(request)
        _remember(handle)
        status = service.status(handle)
        payload: dict[str, Any] = {
            "ok": True,
            "mode": mode,
            "transport": "hermes_subagent_lifecycle_v1",
            "role": product_role,
            "task_id": handle.subagent_id,
            "handle": handle.to_dict(),
            "status": status,
        }
        if args.get("wait_for_completion") is True:
            terminal = service.wait(handle, timeout_seconds=wait_timeout)
            payload["wait"] = terminal
            payload["result"] = service.result(handle)
        return _dump(payload)
    except Exception as exc:
        return _error(exc)


def worker_status(args: dict, **kwargs: Any) -> str:
    del kwargs
    try:
        handle = _resolve_handle(args)
        service = _context().subagent_lifecycle
        timeout = _wait_seconds(args.get("wait_timeout_seconds"))
        waited = service.wait(handle, timeout_seconds=timeout) if timeout is not None else None
        status = service.status(handle)
        result = service.result(handle)
        return _dump({
            "ok": True,
            "transport": "hermes_subagent_lifecycle_v1",
            "task_id": handle.subagent_id,
            "status": status,
            "wait": waited,
            "result": result,
        })
    except Exception as exc:
        return _error(exc)


def worker_catalog(args: dict, **kwargs: Any) -> str:
    del args, kwargs
    try:
        mode = _mode()
        return _dump({
            "ok": True,
            "mode": mode,
            "ui_mode": "WORKER" if mode == "DELEGATE" else mode,
            "delegation_allowed": mode in _DELEGATION_MODES,
            "execution": "PluginContext.subagent_lifecycle",
            "contract_version": 1,
            "model_catalog": "/api/model/options",
            "provider_configuration": "Hermes providers/custom endpoints",
            "worker_configuration": "Hermes delegation.*",
            "review_configuration": "Hermes auxiliary.review.*",
            "notes": (
                "Studio intentionally owns no second model registry, provider client, "
                "sandbox, queue, or child-agent runtime."
            ),
        })
    except Exception as exc:
        return _error(exc)
