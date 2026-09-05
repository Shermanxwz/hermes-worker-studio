#!/usr/bin/env python3
"""Fail-closed release transform for mixed protocols and native binary reasoning.

Hermes owns model inventory and execution, but a generic named custom provider
still has one provider-wide transport. Worker Studio therefore keeps the source
Provider/Model visible and materialises narrow Hermes provider aliases only
when the pinned core cannot express a per-model/per-request wire detail.

Two release gaps are closed here without model-name guessing:

* first real use resolves Chat Completions vs Responses automatically;
* an explicitly declared ``hws_native_reasoning: minimax_openai`` model gets
  two immutable Chat aliases (adaptive / disabled), selected per Run from the
  canonical reasoning value. The shared adaptive alias is never mutated.

The transform is applied only to the staged install candidate. Every rewrite is
exact-count checked so source drift fails installation instead of silently
shipping a half-patched product.
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


def _run_reasoning_effort(body: dict[str, Any] | None) -> str:
    if not isinstance(body, dict):
        return "auto"
    options = body.get("model_options")
    if not isinstance(options, dict):
        return "auto"
    reasoning = options.get("reasoning")
    rich = reasoning if isinstance(reasoning, dict) else {}
    if rich.get("enabled") is False:
        return "none"
    raw = rich.get("effort")
    if raw in (None, ""):
        raw = options.get("reasoning_effort", options.get("reasoningEffort"))
    value = str(raw or "").strip().lower()
    if value:
        return value
    return "medium" if rich.get("enabled") is True else "auto"


def _native_reasoning_source(
    config: dict[str, Any], provider: str, model: str,
) -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
    stored_key, entry = _provider_entry(config, provider)
    bridge = entry.get("hws_protocol_bridge") if isinstance(entry, dict) else None
    source_provider = str(stored_key or provider).strip()
    source_model = str(model or "").strip()
    if isinstance(bridge, dict) and bridge.get("source_provider"):
        source_provider = str(bridge.get("source_provider") or source_provider).strip()
        source_model = str(bridge.get("source_model") or source_model).strip()
        _source_key, source_entry = _provider_entry(config, source_provider)
        entry = source_entry
    return source_provider, source_model, entry, bridge if isinstance(bridge, dict) else None


def _persist_native_reasoning_provider_map(providers: dict[str, dict[str, Any]]) -> None:
    try:
        _legacy._hermes_proxy("/api/config", method="PUT", body={"config": {"providers": providers}})
    except HTTPException as exc:
        if int(exc.status_code or 0) not in _CONFIG_ROUTE_UNAVAILABLE:
            raise
        _write_hermes_config_store_providers(providers)


def _ensure_minimax_binary_alias(provider: str, model: str, state: str) -> str:
    """Return an immutable adaptive/disabled alias for one explicit M3 wire.

    The adaptive alias remains the normal protocol alias produced by
    ``_ensure_protocol_aliases``. The disabled alias is a distinct provider
    entry copied from it and never mutates the adaptive entry, so concurrent
    on/off Runs cannot race through shared provider state.
    """
    with _OFFICIAL_CONFIG_LOCK:
        config = _read_official_config()
        source_provider, source_model, source, _bridge = _native_reasoning_source(
            config, provider, model
        )
        marker = _entry_model_metadata(source, source_model).get("hws_native_reasoning")
        if marker != "minimax_openai":
            raise HTTPException(409, "native binary reasoning alias requested without an explicit minimax_openai declaration")
        config, aliases = _ensure_protocol_aliases(
            config, source_provider, source_model, ("chat_completions",)
        )
        adaptive_alias = str(aliases.get("chat_completions") or "").strip()
        if not adaptive_alias:
            raise HTTPException(502, "Hermes did not materialise the native adaptive Chat alias")
        if state == "adaptive":
            return adaptive_alias

        providers = _provider_entries(config)
        adaptive = providers.get(adaptive_alias)
        if not isinstance(adaptive, dict):
            raise HTTPException(502, "Hermes native adaptive alias is missing after reconciliation")
        disabled_alias = f"{adaptive_alias}-reasoning-off"
        expected = copy.deepcopy(adaptive)
        expected["name"] = f"{str(adaptive.get('name') or adaptive_alias)} · Thinking Off"
        extra_body = copy.deepcopy(expected.get("extra_body")) if isinstance(expected.get("extra_body"), dict) else {}
        extra_body["reasoning_split"] = True
        extra_body["thinking"] = {"type": "disabled"}
        expected["extra_body"] = extra_body
        marker_payload = copy.deepcopy(expected.get("hws_protocol_bridge")) if isinstance(expected.get("hws_protocol_bridge"), dict) else {}
        marker_payload.update({
            "source_provider": source_provider,
            "source_model": source_model,
            "mode": "chat_completions",
            "managed_by": "hermes-worker-studio",
            "native_reasoning": "minimax_openai",
            "reasoning_state": "disabled",
        })
        expected["hws_protocol_bridge"] = marker_payload
        if providers.get(disabled_alias) != expected:
            providers[disabled_alias] = expected
            config["providers"] = providers
            _persist_native_reasoning_provider_map(providers)
        return disabled_alias


def _apply_native_reasoning_route(
    route: dict[str, Any], provider: str, model: str, reasoning_effort: str = "auto",
) -> dict[str, Any]:
    config = _read_official_config()
    source_provider, source_model, source, bridge = _native_reasoning_source(config, provider, model)
    marker = _entry_model_metadata(source, source_model).get("hws_native_reasoning")
    if marker != "minimax_openai":
        return route
    if str(route.get("mode") or "") != "chat_completions":
        raise HTTPException(409, "minimax_openai native reasoning requires the Chat Completions execution route")

    requested = str(reasoning_effort or "auto").strip().lower() or "auto"
    if requested == "none":
        state = "disabled"
    elif requested in {"auto", "medium"}:
        # ``medium`` is Hermes' canonical enabled token for a binary toggle; it
        # is not presented as a MiniMax strength level.
        state = "adaptive"
    else:
        raise HTTPException(422, f"minimax_openai is a binary thinking control; unsupported reasoning value: {requested}")

    execution_provider = _ensure_minimax_binary_alias(source_provider, source_model, state)
    resolved = dict(route)
    resolved["execution_provider"] = execution_provider
    resolved["native_reasoning"] = state
    resolved["native_reasoning_source"] = "hws_native_reasoning:minimax_openai"
    resolved["source_provider"] = source_provider
    resolved["source_model"] = source_model
    if isinstance(bridge, dict) and bridge.get("reasoning_state"):
        resolved["requested_from_reasoning_alias"] = str(bridge.get("reasoning_state"))
    return resolved


def _resolve_route_for_run(provider: str, model: str, reasoning_effort: str = "auto") -> dict[str, Any]:
    """Resolve a real execution route, probing once on first unresolved use.

    Protocol resolution stays capability-driven. Once a protocol is real, an
    explicit native binary-reasoning marker may select a second immutable alias
    for this Run. Ambiguous/failed protocol probes remain fail-closed and never
    fall back to a model-name or GPT heuristic.
    """
    config = _read_official_config()
    options = _read_official_model_options()
    route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
    if not route.get("requires_probe"):
        return _apply_native_reasoning_route(route, provider, model, reasoning_effort)
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
        config = _read_official_config()
        options = _read_official_model_options()
        route = _protocol_route_snapshot(config, options, provider, model, ensure_alias=True)
        if not route.get("requires_probe"):
            return _apply_native_reasoning_route(route, provider, model, reasoning_effort)
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
        return _apply_native_reasoning_route(resolved, provider, model, reasoning_effort)
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
        "backend lazy protocol/native-reasoning resolver",
    )

    source = _replace_once(
        source,
        "        source_route = _resolve_route_for_run(requested_provider, requested_model)\n",
        "        source_route = _resolve_route_for_run(requested_provider, requested_model, _run_reasoning_effort(body))\n",
        "backend Run reasoning-aware route selection",
    )

    resolve_route = '''@router.post("/hermes/protocols/resolve")
async def resolve_protocol_route(request: Request) -> dict[str, Any]:
    """Resolve one execution route, including explicit binary native reasoning."""
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "protocol resolve body must be an object")
    provider = str(body.get("provider") or "").strip()
    model = str(body.get("model") or "").strip()
    reasoning_effort = str(body.get("reasoning_effort") or "auto").strip() or "auto"
    if not provider or not model:
        raise HTTPException(400, "provider and model are required")
    return await asyncio.to_thread(_resolve_route_for_run, provider, model, reasoning_effort)


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
    moa_new = '''            route = _resolve_route_for_run(provider, model, str(slot.get("reasoning_effort") or "auto"))
            slot["provider"] = route.get("execution_provider") or provider
'''
    source = _replace_once(source, moa_old, moa_new, "MOA lazy protocol/native-reasoning resolution")

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
      resolved = await plugin('/hermes/protocols/resolve', jinit('POST', { provider: normalized.provider, model: normalized.model, reasoning_effort: normalized.effort || 'auto' }));
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
    return { ...normalized, provider: resolved?.execution_provider || normalized.provider, source_provider: resolved?.source_provider || normalized.provider, source_model: resolved?.source_model || normalized.model, native_reasoning: resolved?.native_reasoning || null, protocol: resolved };
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


def patch_gateway(source: str) -> str:
    binary_toggle = '''  function applyNativeReasoningConstraint(capability, modelEntry) {
    if (!isObject(modelEntry) || String(modelEntry.hws_native_reasoning || '').trim() !== 'minimax_openai') return capability;
    const cap = isObject(capability) ? { ...capability } : {};
    // The supported staged runtime has two immutable execution aliases for
    // this explicit native wire: adaptive and disabled. Therefore the product
    // may expose a real binary toggle, but still no fabricated effort ladder.
    cap.reasoning = {
      supported: true,
      control: 'toggle',
      can_disable: true,
      default_effort: HERMES_DEFAULT_EFFORT,
      source: 'hermes.provider_config.model+native.minimax_openai.binary',
    };
    cap.supports_reasoning = true;
    cap.can_disable_reasoning = true;
    cap.reasoning_control = 'toggle';
    cap.default_reasoning_effort = HERMES_DEFAULT_EFFORT;
    cap.reasoning_source = 'hermes.provider_config.model+native.minimax_openai.binary';
    delete cap.reasoning_efforts;
    delete cap.reasoningEfforts;
    delete cap.supported_reasoning_efforts;
    delete cap.supportedReasoningEfforts;
    return cap;
  }

  function overlayFromHermesConfig'''
    return _sub_once(
        source,
        r"  function applyNativeReasoningConstraint\(capability, modelEntry\) \{\n.*?\n  \}\n\n  function overlayFromHermesConfig",
        binary_toggle,
        "staged native binary reasoning capability",
    )


def patch_files(frontend: Path, backend: Path, gateway: Path) -> None:
    frontend_source = frontend.read_text(encoding="utf-8")
    backend_source = backend.read_text(encoding="utf-8")
    gateway_source = gateway.read_text(encoding="utf-8")
    frontend.write_text(patch_frontend(frontend_source), encoding="utf-8")
    backend.write_text(patch_backend(backend_source), encoding="utf-8")
    gateway.write_text(patch_gateway(gateway_source), encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: stage_mixed_protocol.py <index-v3.js> <plugin_api_v3.py> <gateway-native.js>", file=sys.stderr)
        return 2
    frontend = Path(argv[1])
    backend = Path(argv[2])
    gateway = Path(argv[3])
    if not frontend.is_file() or not backend.is_file() or not gateway.is_file():
        raise SystemExit("mixed protocol/native reasoning transform inputs must all exist")
    patch_files(frontend, backend, gateway)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
