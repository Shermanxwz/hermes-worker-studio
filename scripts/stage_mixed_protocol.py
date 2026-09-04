#!/usr/bin/env python3
"""Fail-closed release transform for mixed Chat/Responses custom endpoints.

Hermes 0.20.6 owns model inventory and execution, but a generic named custom
provider still has one provider-wide transport. Worker Studio therefore keeps
the source Provider/Model visible and materialises a narrow Hermes provider
alias only after a real per-model probe. This transform closes the final UX gap:
the first real use resolves the protocol automatically instead of asking the
operator to visit Models and click a probe button.

The transform is intentionally applied only to the staged install candidate.
Every rewrite is exact-count checked so source drift fails installation rather
than silently producing a half-patched product. No model-name heuristic is used.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def _replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source match, found {count}")
    return source.replace(old, new, 1)


def _sub_once(source: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, lambda _match: replacement, source, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source match, found {count}")
    return updated


def patch_backend(source: str) -> str:
    resolver = '''_AUTO_PROTOCOL_PROBE_LOCKS: dict[str, threading.Lock] = {}
_AUTO_PROTOCOL_PROBE_LOCKS_GUARD = threading.Lock()
_AUTO_PROTOCOL_RETRY_SECONDS = max(
    0.0,
    float(os.getenv("HERMES_WORKER_STUDIO_PROTOCOL_AUTO_RETRY_SECONDS", "300")),
)


def _auto_protocol_probe_lock(provider: str, model: str) -> threading.Lock:
    key = _protocol_key(provider, model)
    with _AUTO_PROTOCOL_PROBE_LOCKS_GUARD:
        lock = _AUTO_PROTOCOL_PROBE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _AUTO_PROTOCOL_PROBE_LOCKS[key] = lock
        return lock


def _protocol_probe_failure_detail(state: dict[str, Any] | None) -> str:
    if not isinstance(state, dict):
        return ""
    results = state.get("results") if isinstance(state.get("results"), dict) else {}
    parts = []
    for mode in _PROBE_MODES:
        result = results.get(mode) if isinstance(results.get(mode), dict) else {}
        status = str(result.get("status") or "failed")
        error = str(result.get("error") or "").strip()
        label = _protocol_mode_label(mode) or mode
        parts.append(f"{label}: {status}{f' · {error}' if error else ''}")
    return "；".join(parts)


def _recent_failed_protocol_state(provider: str, model: str) -> dict[str, Any] | None:
    state = _route_state(provider, model)
    if not isinstance(state, dict) or str(state.get("status") or "") != "unresolved":
        return None
    try:
        age = time.time() - float(state.get("probed_at") or 0.0)
    except (TypeError, ValueError):
        return None
    return state if 0 <= age < _AUTO_PROTOCOL_RETRY_SECONDS else None


def _resolve_route_for_run(provider: str, model: str) -> dict[str, Any]:
    """Resolve a real execution route, probing once on first unresolved use.

    The probe executes the same official Hermes /v1/runs transport used by the
    explicit Models-page diagnostic. Results are cached in the existing
    per-model protocol state. Concurrent first-use callers share one probe;
    ambiguous or failed probes remain fail-closed and never fall back to a
    model-name or GPT heuristic.
    """
    config = _read_official_config()
    options = _read_official_model_options()
    route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
    if not route.get("requires_probe"):
        return route
    if str(route.get("status") or "") == "ambiguous":
        raise HTTPException(
            409,
            f"模型 “{provider} / {model}” 的 Chat Completions 与 Responses 均真实 Run 成功；请在模型页明确选择协议。",
        )
    recent_failure = _recent_failed_protocol_state(provider, model)
    if recent_failure is not None:
        detail = _protocol_probe_failure_detail(recent_failure)
        raise HTTPException(
            409,
            f"模型 “{provider} / {model}” 最近一次自动协议探测未通过。{detail or str(recent_failure.get('error') or '')} 可在模型页手动重新探测。",
        )

    with _auto_protocol_probe_lock(provider, model):
        # Another concurrent request may have completed the probe while this
        # caller was waiting. Re-read authoritative Hermes config/inventory and
        # the shared protocol state before spending another pair of Runs.
        config = _read_official_config()
        options = _read_official_model_options()
        route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
        if not route.get("requires_probe"):
            return route
        if str(route.get("status") or "") == "ambiguous":
            raise HTTPException(
                409,
                f"模型 “{provider} / {model}” 的 Chat Completions 与 Responses 均真实 Run 成功；请在模型页明确选择协议。",
            )
        recent_failure = _recent_failed_protocol_state(provider, model)
        if recent_failure is not None:
            detail = _protocol_probe_failure_detail(recent_failure)
            raise HTTPException(
                409,
                f"模型 “{provider} / {model}” 最近一次自动协议探测未通过。{detail or str(recent_failure.get('error') or '')} 可在模型页手动重新探测。",
            )
        result = _probe_protocols_sync(provider, model)

    resolved = result.get("route") if isinstance(result, dict) else None
    status = str(result.get("status") or (resolved or {}).get("status") or "") if isinstance(result, dict) else ""
    if status == "resolved" and isinstance(resolved, dict) and resolved.get("execution_provider"):
        return resolved
    if status == "ambiguous":
        raise HTTPException(
            409,
            f"模型 “{provider} / {model}” 的 Chat Completions 与 Responses 均真实 Run 成功；请在模型页明确选择协议。",
        )
    state = _route_state(provider, model)
    detail = _protocol_probe_failure_detail(state)
    error = str((result or {}).get("error") or (state or {}).get("error") or "").strip() if isinstance(result, dict) else ""
    raise HTTPException(
        409,
        f"模型 “{provider} / {model}” 自动协议探测失败：{detail or error or 'Chat Completions 与 Responses 均未完成真实 Run'}。不会按模型名猜测协议。",
    )
'''
    source = _sub_once(
        source,
        r"def _resolve_route_for_run\(provider: str, model: str\) -> dict\[str, Any\]:\n.*?\n\n\ndef _reverse_moa_provider",
        resolver + "\n\ndef _reverse_moa_provider",
        "backend lazy protocol resolver",
    )

    resolve_route = '''@router.post("/hermes/protocols/resolve")
async def resolve_protocol_route(request: Request) -> dict[str, Any]:
    """Resolve one execution route, lazily probing an unresolved custom model."""
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "protocol resolve body must be an object")
    provider = str(body.get("provider") or "").strip()
    model = str(body.get("model") or "").strip()
    if not provider or not model:
        raise HTTPException(400, "provider and model are required")
    return await asyncio.to_thread(_resolve_route_for_run, provider, model)


'''
    source = _replace_once(
        source,
        '@router.post("/hermes/protocols/probe")\n',
        resolve_route + '@router.post("/hermes/protocols/probe")\n',
        "backend explicit lazy-resolve route",
    )

    moa_old = '''            route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
            if route.get("requires_probe"):
                raise HTTPException(409, f"MOA 的模型 “{provider} / {model}” 协议尚未确定，请先在模型页完成官方真实 Run 探测。")
            slot["provider"] = route.get("execution_provider") or provider
'''
    moa_new = '''            route = _resolve_route_for_run(provider, model)
            slot["provider"] = route.get("execution_provider") or provider
'''
    source = _replace_once(source, moa_old, moa_new, "MOA lazy protocol resolution")

    source = _replace_once(
        source,
        '"probe": "explicit real Hermes /v1/runs for Chat Completions and Responses",',
        '"probe": "first-use or explicit real Hermes /v1/runs for Chat Completions and Responses",',
        "product capability protocol probe wording",
    )
    return source


def patch_frontend(source: str) -> str:
    helper = '''
  async function resolveProtocolExecutionRoute(options, route) {
    const normalized = normalizeRoute(options, route);
    if (!normalized.provider || !normalized.model || normalized.provider === 'moa') return normalized;
    let resolved;
    try {
      resolved = await plugin('/hermes/protocols/resolve', jinit('POST', { provider: normalized.provider, model: normalized.model }));
    } catch (error) {
      // Older installed bridges did not expose lazy resolution. Keep that
      // compatibility path fail-closed; current sealed installs never require
      // the operator to pre-click a probe for a first-use mixed model.
      if (!/Unhandled fetchJSON call|404|Not Found/i.test(errorText(error))) throw error;
      const query = new URLSearchParams({ provider: normalized.provider, model: normalized.model });
      resolved = await plugin(`/hermes/protocol-route?${query.toString()}`);
      if (resolved?.requires_probe) {
        throw new Error(`模型 “${normalized.provider} / ${normalized.model}” 尚未确定 Chat/Responses，当前安装桥不支持首次使用自动探测；请更新 Worker Studio。`);
      }
    }
    if (resolved?.status === 'ambiguous' || resolved?.requires_choice) {
      throw new Error(`模型 “${normalized.provider} / ${normalized.model}” 同时通过 Chat Completions 与 Responses，请在“模型”页面明确选择协议。`);
    }
    if (resolved?.requires_probe) {
      throw new Error(`模型 “${normalized.provider} / ${normalized.model}” 的真实协议仍未解析；不会按模型名猜测。`);
    }
    return { ...normalized, provider: resolved?.execution_provider || normalized.provider, source_provider: normalized.provider, protocol: resolved };
  }
'''
    tone_pattern = r"(  function protocolStatusTone\(route\) \{\n.*?\n  \}\n)"
    match = re.search(tone_pattern, source, flags=re.S)
    if not match:
        raise SystemExit("frontend protocol helper insertion: source anchor not found")
    source = source[: match.end()] + helper + source[match.end() :]

    source = _sub_once(
        source,
        r"    const resolveExecutionRoute = useCallback\(async \(route\) => \{\n.*?\n    \}, \[modelOptions\]\);",
        "    const resolveExecutionRoute = useCallback(async (route) => resolveProtocolExecutionRoute(modelOptions, route), [modelOptions]);",
        "frontend chat lazy route resolver",
    )

    provider_helper_anchor = '''  function providerConfigEntry(config, provider) {
    const entries = config?.providers;
    if (!entries || typeof entries !== 'object') return null;
    return entries[provider] || null;
  }
'''
    source_facing_helper = '''  function sourceFacingProtocolRoute(config, provider, model) {
    const marker = providerConfigEntry(config, provider)?.hws_protocol_bridge;
    if (marker && typeof marker === 'object' && marker.source_provider) {
      return { provider: String(marker.source_provider), model: String(marker.source_model || model || '') };
    }
    return { provider: String(provider || ''), model: String(model || '') };
  }
'''
    source = _replace_once(
        source,
        provider_helper_anchor,
        provider_helper_anchor + source_facing_helper,
        "frontend managed-alias display reversal",
    )

    worker_init_old = '''    const delegation = config?.delegation || {};
    const review = config?.auxiliary?.review || {};
    const [workerInherit, setWorkerInherit] = useState(!delegation.provider && !delegation.model);
    const [workerRoute, setWorkerRoute] = useState(() => normalizeRoute(modelOptions, { provider: delegation.provider || fallback.provider, model: delegation.model || fallback.model, effort: delegation.reasoning_effort || 'auto' }));
    const [reviewInherit, setReviewInherit] = useState(!review.model && (!review.provider || review.provider === 'auto'));
    const [reviewRoute, setReviewRoute] = useState(() => normalizeRoute(modelOptions, { provider: review.provider && review.provider !== 'auto' ? review.provider : fallback.provider, model: review.model || fallback.model, effort: 'auto' }));
'''
    worker_init_new = '''    const delegation = config?.delegation || {};
    const review = config?.auxiliary?.review || {};
    const workerStoredRoute = sourceFacingProtocolRoute(config, delegation.provider || fallback.provider, delegation.model || fallback.model);
    const reviewStoredRoute = sourceFacingProtocolRoute(config, review.provider && review.provider !== 'auto' ? review.provider : fallback.provider, review.model || fallback.model);
    const [workerInherit, setWorkerInherit] = useState(!delegation.provider && !delegation.model);
    const [workerRoute, setWorkerRoute] = useState(() => normalizeRoute(modelOptions, { provider: workerStoredRoute.provider, model: workerStoredRoute.model, effort: delegation.reasoning_effort || 'auto' }));
    const [reviewInherit, setReviewInherit] = useState(!review.model && (!review.provider || review.provider === 'auto'));
    const [reviewRoute, setReviewRoute] = useState(() => normalizeRoute(modelOptions, { provider: reviewStoredRoute.provider, model: reviewStoredRoute.model, effort: 'auto' }));
'''
    source = _replace_once(source, worker_init_old, worker_init_new, "Worker/Verifier source-route display")

    save_routes = '''    async function saveRoutes() {
      setBusy(true); setMessage('');
      try {
        // Resolve first so any managed per-model provider alias is already in
        // Hermes official config before we read and write delegation/review.
        const workerExecution = workerInherit ? null : await resolveProtocolExecutionRoute(modelOptions, workerRoute);
        const reviewExecution = reviewInherit ? null : await resolveProtocolExecutionRoute(modelOptions, reviewRoute);
        const cfg = clone(unwrapConfig(await api('/api/config')));
        const d = { ...(cfg.delegation || {}) };
        if (workerInherit) { delete d.provider; delete d.model; delete d.reasoning_effort; }
        else { d.provider = workerExecution.provider; d.model = workerExecution.model; if (workerRoute.effort !== 'auto') d.reasoning_effort = workerRoute.effort; else delete d.reasoning_effort; }
        cfg.delegation = d;
        cfg.auxiliary = { ...(cfg.auxiliary || {}) };
        cfg.auxiliary.review = reviewInherit ? { ...(cfg.auxiliary.review || {}), provider: 'auto', model: '' } : { ...(cfg.auxiliary.review || {}), provider: reviewExecution.provider, model: reviewExecution.model };
        await api('/api/config', jinit('PUT', { config: cfg })); await refreshConfig(); setMessage('Worker / Verifier 路由已按模型真实协议写入 Hermes 官方配置');
      } catch (err) { setMessage(errorText(err)); } finally { setBusy(false); }
    }
'''
    source = _sub_once(
        source,
        r"    async function saveRoutes\(\) \{\n.*?\n    \}\n    const descriptions =",
        save_routes + "    const descriptions =",
        "Worker/Verifier execution-route save",
    )

    source = _replace_once(
        source,
        '协议只接受 Hermes 官方声明，或你点击“测试”后的真实 Run 结果；没有证据时显示“未探测”，不会把同一 provider 的所有模型误判成 Chat Completions 或 Responses。凭据只保留在 Hermes 服务端。',
        '协议只接受 Hermes 官方声明或真实 Run 结果；首次实际使用会自动探测并缓存，“测试”按钮用于诊断或主动重试。没有证据时不会把同一 provider 的所有模型误判成 Chat Completions 或 Responses。凭据只保留在 Hermes 服务端。',
        "Models-page lazy probe explanation",
    )
    return source


def patch_files(frontend: Path, backend: Path) -> None:
    frontend_source = frontend.read_text(encoding="utf-8")
    backend_source = backend.read_text(encoding="utf-8")
    frontend.write_text(patch_frontend(frontend_source), encoding="utf-8")
    backend.write_text(patch_backend(backend_source), encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: stage_mixed_protocol.py <index-v3.js> <plugin_api_v3.py>", file=sys.stderr)
        return 2
    frontend = Path(argv[1])
    backend = Path(argv[2])
    if not frontend.is_file() or not backend.is_file():
        raise SystemExit("mixed protocol transform inputs must both exist")
    patch_files(frontend, backend)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
