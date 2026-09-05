(function () {
  'use strict';
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK?.React || typeof SDK.fetchJSON !== 'function') return;
  const React = SDK.React;
  const h = React.createElement.bind(React);
  const HERMES_DEFAULT_EFFORT = 'medium';
  const CONTROLS = new Set(['none', 'toggle', 'effort', 'toggle_effort', 'fixed', 'auto']);
  const RESERVED = new Set(['auto', 'none']);

  const clone = (v) => v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const providerRows = (o) => (Array.isArray(o?.providers) ? o.providers : []).filter((p) => !String(p?.slug || '').toLowerCase().startsWith('hws-protocol-') && p?.hws_protocol_bridge?.managed_by !== 'hermes-worker-studio');
  const providerBySlug = (o, slug) => providerRows(o).find((p) => p?.slug === slug || (Array.isArray(p?.aliases) && p.aliases.includes(slug)));
  const modelsFor = (o, slug) => Array.isArray(providerBySlug(o, slug)?.models) ? providerBySlug(o, slug).models : [];
  const modelCapability = (o, provider, model) => providerBySlug(o, provider)?.capabilities?.[model] || {};

  function rawEffortValues(lists) {
    const out = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const value = String(typeof item === 'string' ? item : item?.value || '').trim();
        if (value) out.push(value);
      }
    }
    return out;
  }

  function uniqueEfforts(lists) {
    const out = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const value = String(typeof item === 'string' ? item : item?.value || '').trim();
        if (!value || RESERVED.has(value.toLowerCase()) || out.some((x) => x.value === value)) continue;
        out.push({ value, description: typeof item === 'object' ? String(item.description || '') : '' });
      }
    }
    return out;
  }

  function descriptorFromCapability(capability) {
    const cap = capability && typeof capability === 'object' ? capability : {};
    const raw = cap.reasoning;
    const rich = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rawControl = String(rich.control || rich.kind || rich.mode || cap.reasoning_control || cap.reasoningControl || '').trim().toLowerCase();
    const explicitControl = CONTROLS.has(rawControl);
    const efforts = uniqueEfforts([rich.options, rich.efforts, rich.supported_efforts, rich.supportedEfforts, cap.reasoning_efforts, cap.reasoningEfforts, cap.supported_reasoning_efforts, cap.supportedReasoningEfforts]);
    const explicitDisable = rich.can_disable ?? rich.canDisable ?? cap.can_disable_reasoning ?? cap.canDisableReasoning;
    let supported = raw === false || rich.supported === false || cap.supports_reasoning === false ? false
      : raw === true || (raw && typeof raw === 'object') || cap.supports_reasoning === true || efforts.length > 0 || (explicitControl && rawControl !== 'none' && rawControl !== 'auto') ? true : null;
    if (rawControl === 'none') supported = false;
    let canDisable = explicitDisable === false ? false : explicitDisable === true ? true : null;
    if (canDisable === null && (rawControl === 'toggle' || rawControl === 'toggle_effort')) canDisable = true;
    if (canDisable === null && rawControl === 'fixed') canDisable = false;
    let control = explicitControl ? rawControl : '';
    if (!control) {
      if (supported === false) control = 'none';
      else if (efforts.length && canDisable === true) control = 'toggle_effort';
      else if (efforts.length) control = 'effort';
      else if (supported === true && canDisable === false) control = 'fixed';
      else if (supported === true && canDisable === true) control = 'toggle';
      else control = 'auto';
    }
    return {
      supported, control, canDisable, efforts,
      defaultEffort: String(rich.default_effort || rich.defaultEffort || cap.default_reasoning_effort || '').trim() || HERMES_DEFAULT_EFFORT,
      source: String(rich.source || cap.reasoning_source || 'hermes.model.options'),
      explicitControl, explicitDisable: explicitDisable === true || explicitDisable === false, explicitEfforts: efforts.length > 0,
    };
  }

  function configObject(payload) {
    return isObject(payload?.config) ? payload.config : (isObject(payload) ? payload : {});
  }

  function configProvider(configPayload, providerRow) {
    const providers = configObject(configPayload).providers;
    if (!isObject(providers) || !providerRow) return null;
    const wanted = new Set([
      String(providerRow.slug || '').trim().toLowerCase(),
      String(providerRow.name || '').trim().toLowerCase(),
      ...(Array.isArray(providerRow.aliases) ? providerRow.aliases.map((x) => String(x || '').trim().toLowerCase()) : []),
    ].filter(Boolean));
    for (const [key, value] of Object.entries(providers)) {
      if (!isObject(value)) continue;
      const aliases = [key, value.slug, value.name, ...(Array.isArray(value.aliases) ? value.aliases : [])].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
      if (aliases.some((x) => wanted.has(x))) return value;
    }
    return null;
  }

  function explicitReasoningMetadata(meta, source) {
    if (!isObject(meta)) return null;
    const raw = meta.reasoning;
    const rich = isObject(raw) ? raw : {};
    const effortLists = [rich.options, rich.efforts, rich.supported_efforts, rich.supportedEfforts, meta.reasoning_efforts, meta.reasoningEfforts, meta.supported_reasoning_efforts, meta.supportedReasoningEfforts];
    const efforts = uniqueEfforts(effortLists);
    const rawEfforts = rawEffortValues(effortLists).map((x) => x.toLowerCase());
    const rawControl = String(rich.control || rich.kind || rich.mode || meta.reasoning_control || meta.reasoningControl || '').trim().toLowerCase();
    const control = CONTROLS.has(rawControl) ? rawControl : '';
    const disableValue = rich.can_disable ?? rich.canDisable ?? meta.can_disable_reasoning ?? meta.canDisableReasoning;
    let canDisable = disableValue === true ? true : disableValue === false ? false : null;
    if (canDisable === null && rawEfforts.includes('none')) canDisable = true;
    if (canDisable === null && (control === 'toggle' || control === 'toggle_effort')) canDisable = true;
    if (canDisable === null && control === 'fixed') canDisable = false;
    let supported = raw === true || rich.supported === true || meta.supports_reasoning === true ? true
      : raw === false || rich.supported === false || meta.supports_reasoning === false ? false : null;
    if (supported === null && (efforts.length || canDisable !== null || (control && control !== 'none' && control !== 'auto'))) supported = true;
    if (control === 'none') supported = false;
    const defaultEffort = String(rich.default_effort || rich.defaultEffort || meta.default_reasoning_effort || meta.defaultReasoningEffort || '').trim();
    if (supported === null && canDisable === null && !efforts.length && !control && !defaultEffort) return null;
    return { supported, canDisable, efforts, control, defaultEffort, source };
  }

  function capabilitySignals(capability) {
    const cap = isObject(capability) ? capability : {};
    const rich = isObject(cap.reasoning) ? cap.reasoning : {};
    const efforts = uniqueEfforts([rich.options, rich.efforts, rich.supported_efforts, rich.supportedEfforts, cap.reasoning_efforts, cap.reasoningEfforts, cap.supported_reasoning_efforts, cap.supportedReasoningEfforts]);
    const disable = rich.can_disable ?? rich.canDisable ?? cap.can_disable_reasoning ?? cap.canDisableReasoning;
    const control = String(rich.control || rich.kind || rich.mode || cap.reasoning_control || cap.reasoningControl || '').trim().toLowerCase();
    const defaultEffort = String(rich.default_effort || rich.defaultEffort || cap.default_reasoning_effort || '').trim();
    const support = cap.reasoning === false || rich.supported === false || cap.supports_reasoning === false ? false
      : cap.reasoning === true || isObject(cap.reasoning) || rich.supported === true || cap.supports_reasoning === true ? true : null;
    return {
      support,
      hasEfforts: efforts.length > 0,
      hasDisable: disable === true || disable === false,
      hasControl: CONTROLS.has(control),
      hasDefault: !!defaultEffort,
    };
  }

  function mergeExplicitReasoning(capability, metadata) {
    const cap = isObject(capability) ? { ...capability } : {};
    if (!metadata) return { capability: cap, changed: false };
    const before = capabilitySignals(cap);
    if (before.support === false) return { capability: cap, changed: false };
    let changed = false;
    if (before.support === null && metadata.supported !== null) {
      cap.reasoning = metadata.supported;
      changed = true;
    }
    if (!before.hasEfforts && metadata.efforts.length) {
      cap.reasoning_efforts = metadata.efforts.map((x) => ({ ...x }));
      changed = true;
    }
    if (!before.hasDisable && metadata.canDisable !== null) {
      cap.can_disable_reasoning = metadata.canDisable;
      changed = true;
    }
    if (!before.hasControl && metadata.control) {
      cap.reasoning_control = metadata.control;
      changed = true;
    }
    if (!before.hasDefault && metadata.defaultEffort) {
      cap.default_reasoning_effort = metadata.defaultEffort;
      changed = true;
    }
    if (changed && !cap.reasoning_source) cap.reasoning_source = metadata.source;
    return { capability: cap, changed };
  }

  function applyNativeReasoningConstraint(capability, modelEntry) {
    if (!isObject(modelEntry) || String(modelEntry.hws_native_reasoning || '').trim() !== 'minimax_openai') return capability;
    const cap = isObject(capability) ? { ...capability } : {};
    // The explicitly selected native adapter currently emits thinking.type=adaptive.
    // That wire-level fact is stronger than optional capability metadata: until
    // execution can vary per Run, Studio must expose a fixed-on control and
    // must never advertise off/effort states that the request path cannot apply.
    cap.reasoning = {
      supported: true,
      control: 'fixed',
      can_disable: false,
      source: 'hermes.provider_config.model+native.minimax_openai',
    };
    cap.supports_reasoning = true;
    cap.can_disable_reasoning = false;
    cap.reasoning_control = 'fixed';
    cap.reasoning_source = 'hermes.provider_config.model+native.minimax_openai';
    delete cap.reasoning_efforts;
    delete cap.reasoningEfforts;
    delete cap.supported_reasoning_efforts;
    delete cap.supportedReasoningEfforts;
    delete cap.default_reasoning_effort;
    delete cap.defaultReasoningEffort;
    return cap;
  }

  function positiveContextWindow(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  function modelContextMetadata(providerConfig, model) {
    if (!isObject(providerConfig)) return { window: null, source: '', customEndpoint: false };
    const models = isObject(providerConfig.models) ? providerConfig.models : {};
    const modelEntry = isObject(models[model]) ? models[model] : {};
    const exact = [
      modelEntry.context_length,
      modelEntry.context_window,
      modelEntry.context_window_tokens,
      modelEntry.max_context_tokens,
    ].map(positiveContextWindow).find((value) => value !== null);
    const provider = [
      providerConfig.context_length,
      providerConfig.context_window,
      providerConfig.context_window_tokens,
      providerConfig.max_context_tokens,
    ].map(positiveContextWindow).find((value) => value !== null);
    const customEndpoint = Boolean(providerConfig.api || providerConfig.base_url || providerConfig.url);
    return {
      window: exact ?? provider ?? null,
      source: exact !== undefined && exact !== null ? 'hermes.provider_config.model' : provider !== undefined && provider !== null ? 'hermes.provider_config.provider' : '',
      customEndpoint,
    };
  }

  function overlayFromHermesConfig(capability, providerConfig, model) {
    if (!isObject(providerConfig)) return capability;
    const models = isObject(providerConfig.models) ? providerConfig.models : {};
    const modelEntry = isObject(models[model]) ? models[model] : null;
    const exactPayload = isObject(modelEntry?.hws_reasoning) ? modelEntry.hws_reasoning : modelEntry;
    const exact = explicitReasoningMetadata(exactPayload, 'hermes.provider_config.model');
    const defaults = explicitReasoningMetadata(providerConfig.hws_reasoning_defaults, 'hermes.provider_config.defaults');
    let result = mergeExplicitReasoning(capability, exact).capability;
    result = mergeExplicitReasoning(result, defaults).capability;
    return applyNativeReasoningConstraint(result, modelEntry);
  }

  const descriptor = (options, provider, model) => modelCapability(options, provider, model)?.hws_reasoning_control || descriptorFromCapability(modelCapability(options, provider, model));

  function enrichModelOptions(payload, configPayload = null) {
    if (!payload || typeof payload !== 'object') return payload;
    const next = clone(payload);
    for (const provider of providerRows(next)) {
      const configured = configProvider(configPayload, provider);
      const caps = isObject(provider.capabilities) ? provider.capabilities : {};
      provider.capabilities = caps;
      const modelNames = [];
      for (const model of Array.isArray(provider.models) ? provider.models : []) if (!modelNames.includes(model)) modelNames.push(model);
      for (const model of Object.keys(caps)) if (!modelNames.includes(model)) modelNames.push(model);
      for (const model of modelNames) {
        let cap = isObject(caps[model]) ? caps[model] : {};
        cap = overlayFromHermesConfig(cap, configured, model);
        const publicContext = [
          cap.context_length,
          cap.context_window,
          cap.context_window_tokens,
          cap.max_context_tokens,
        ].map(positiveContextWindow).find((value) => value !== null);
        const configuredContext = modelContextMetadata(configured, model);
        // An explicit value in Hermes' official provider config is an operator
        // assertion for this exact route.  It must override a stale catalog
        // fallback that a custom endpoint may expose through model/options;
        // otherwise saving the model-level Context would leave the old value
        // visible in the chat header.
        const contextWindow = configuredContext.window ?? publicContext;
        if (contextWindow !== null && contextWindow !== undefined) {
          cap.hws_context_window = contextWindow;
          cap.hws_context_source = configuredContext.window !== null && configuredContext.window !== undefined ? configuredContext.source : 'hermes.model.options';
        } else {
          delete cap.hws_context_window;
          cap.hws_context_source = configuredContext.source || '';
        }
        cap.hws_context_custom_endpoint = configuredContext.customEndpoint;
        const d = descriptorFromCapability(cap);
        cap.hws_reasoning_control = d;
        const internal = d.efforts.map((x) => ({ ...x }));
        if (d.canDisable === true && d.supported === true) internal.unshift({ value: 'none', description: '关闭思考（Hermes canonical off state）' });
        if (d.control === 'toggle' && !internal.some((x) => x.value === d.defaultEffort)) internal.push({ value: d.defaultEffort, description: 'Hermes 开启态 token；不代表该模型公开了强度档位' });
        if (internal.length) cap.reasoning_efforts = internal;
        caps[model] = cap;
      }
    }
    return next;
  }

  function allowedReasoningValues(d) {
    const allowed = new Set(['auto']);
    if (d.canDisable === true && d.supported === true) allowed.add('none');
    d.efforts.forEach((x) => allowed.add(x.value));
    if (d.control === 'toggle') allowed.add(d.defaultEffort);
    return allowed;
  }

  function validateReasoning(options, provider, model, value) {
    const requested = String(value || 'auto').trim() || 'auto';
    const d = descriptor(options, provider, model);
    if (requested === 'auto') return { value: 'auto', semantic: 'auto', descriptor: d };
    if (!provider || !model) throw new Error('Hermes reasoning override requires an explicit provider/model route');
    if (requested === 'none') {
      if (!(d.supported === true && d.canDisable === true && ['toggle', 'toggle_effort'].includes(d.control))) {
        throw new Error(`Hermes model capability does not explicitly allow disabling reasoning for ${provider}/${model}`);
      }
      return { value: requested, semantic: 'off', descriptor: d };
    }
    if (d.efforts.some((x) => x.value === requested)) return { value: requested, semantic: 'effort', descriptor: d };
    if (d.control === 'toggle' && requested === d.defaultEffort) return { value: requested, semantic: 'on', descriptor: d };
    throw new Error(`Hermes model capability does not explicitly allow reasoning value ${requested} for ${provider}/${model}`);
  }

  function normalizeRoute(options, route) {
    const auth = providerRows(options).filter((p) => p?.authenticated !== false && Array.isArray(p?.models) && p.models.length);
    const fallback = auth.find((p) => p.is_current) || auth[0] || providerRows(options).find((p) => Array.isArray(p?.models) && p.models.length) || {};
    const row = providerBySlug(options, route?.provider) || fallback;
    const provider = row?.slug || '';
    const models = modelsFor(options, provider);
    const model = models.includes(route?.model) ? route.model : (models[0] || '');
    const d = descriptor(options, provider, model);
    const allowed = allowedReasoningValues(d);
    return { provider, model, effort: allowed.has(route?.effort) ? route.effort : 'auto', descriptor: d, providers: auth.length ? auth : providerRows(options).filter((p) => Array.isArray(p?.models) && p.models.length) };
  }

  function evidenceLabel(d) {
    const source = String(d?.source || '').toLowerCase();
    if (source.includes('provider_config')) return 'Hermes 配置声明';
    if (source.includes('model.options')) return 'Hermes 模型目录声明';
    if (source.includes('run')) return 'Hermes 真实 Run';
    return 'Hermes 声明';
  }
  function label(d) {
    if (d.supported === false || d.control === 'none') return `不支持（${evidenceLabel(d)}） · 强度：不适用`;
    if (d.supported !== true) return '未确认（Hermes 未声明） · 强度：未确认';
    const evidence = evidenceLabel(d);
    if (d.control === 'fixed') {
      const fixedMode = String(d.source || '').includes('minimax_openai') ? 'adaptive' : '固定';
      return `支持（${evidence}） · 强度：${fixedMode}固定开启`;
    }
    if (d.efforts.length) return `支持（${evidence}） · 强度：${d.efforts.map((x) => x.value).join(' / ')}${d.canDisable === true ? ' · 可关闭' : ''}`;
    return `支持（${evidence}） · 强度：未公开${d.canDisable === true ? ' · 可关闭' : ''}`;
  }

  function enabledEffort(d) { return d.efforts[0]?.value || d.defaultEffort || HERMES_DEFAULT_EFFORT; }

  function ReasoningSwitch({ enabled, disabled, onChange }) {
    return h('label', { className: 'hws3-reasoning-switch' },
      h('span', { className: 'hws3-reasoning-switch-label' }, '思考'),
      h('input', { className: 'hws3-switch-input', type: 'checkbox', checked: enabled, disabled, 'aria-label': '开启思考', onChange: (e) => onChange(e.target.checked) }),
      h('span', { className: 'hws3-switch-track', 'aria-hidden': 'true' }, h('i', { className: 'hws3-switch-thumb' })),
      h('b', { className: 'hws3-switch-state' }, enabled ? '开启' : '关闭'),
    );
  }

  function EffortSlider({ descriptor: d, effort, enabled, disabled, onChange }) {
    const values = [{ value: 'auto', description: '由 Hermes 自动决定' }, ...d.efforts];
    const index = Math.max(0, Math.min(values.length - 1, values.findIndex((x) => x.value === effort)));
    const current = values[index] || values[0];
    return h('label', { className: 'hws3-reasoning-effort', title: '只显示 Hermes 上游明确给出的 effort vocabulary' },
      h('span', { className: 'hws3-reasoning-effort-head' }, h('span', null, '强度'), h('b', null, current.value === 'auto' ? 'Auto' : current.value)),
      h('span', { className: 'hws3-reasoning-slider-shell' },
        h('input', { className: 'hws3-reasoning-slider', type: 'range', min: 0, max: values.length - 1, step: 1, value: index, disabled: disabled || !enabled, 'aria-label': '思考强度', onChange: (e) => onChange(values[Number(e.target.value)]?.value || 'auto') }),
        h('span', { className: 'hws3-reasoning-slider-ticks', 'aria-hidden': 'true' }, values.map((item, tick) => h('i', { key: item.value, className: tick === index ? 'active' : '' }, h('em', null), h('small', null, item.value === 'auto' ? 'Auto' : item.value)))),
      ),
    );
  }

  function ReasoningControl({ descriptor: d, effort, disabled, onChange }) {
    if (d.control === 'none') return h('span', { className: 'hws3-pill', title: 'Hermes 官方 model inventory 声明不支持 reasoning' }, '思考：不支持 · 强度：不适用');
    if (d.control === 'auto') return h('span', { className: 'hws3-pill', title: d.supported === true ? 'Hermes 当前能力目录声明支持思考，但没有公开可编辑的强度 vocabulary；协议真实 Run 探测不等于思考能力探测' : 'Hermes 未声明 reasoning 支持；Studio 不猜测' }, d.supported === true ? '思考：支持 · 强度：未公开' : '思考：未确认 · 强度：未确认');
    if (d.control === 'fixed') return h('span', { className: 'hws3-pill', title: 'Hermes/provider 声明 reasoning 支持但不可关闭' }, '思考：支持 · 强度：固定开启');
    const enabled = effort !== 'none';
    const toggle = d.canDisable === true ? h(ReasoningSwitch, { enabled, disabled, onChange: (next) => onChange(next ? enabledEffort(d) : 'none') }) : null;
    if (d.control === 'toggle') return h('div', { className: 'hws3-reasoning-capability', 'data-hws-control': d.control }, toggle);
    const current = enabled && d.efforts.some((x) => x.value === effort) ? effort : 'auto';
    const scale = h(EffortSlider, { descriptor: d, effort: current, enabled, disabled, onChange });
    return h('div', { className: 'hws3-reasoning-capability', 'data-hws-control': d.control }, toggle, scale);
  }

  function SmartCompactRouteSelector({ options, route, onChange, disabled }) {
    const cur = normalizeRoute(options, route);
    const models = modelsFor(options, cur.provider);
    return h('div', { className: 'hws3-route-compact hws3-route-capability' },
      h('select', { value: cur.provider, disabled: disabled || !cur.providers.length, title: 'Provider', onChange: (e) => { const provider = e.target.value; onChange({ provider, model: modelsFor(options, provider)[0] || '', effort: 'auto' }); } }, cur.providers.map((p) => h('option', { key: p.slug, value: p.slug }, p.name || p.slug))),
      h('select', { value: cur.model, disabled: disabled || !models.length, title: '模型', onChange: (e) => onChange({ provider: cur.provider, model: e.target.value, effort: 'auto' }) }, models.map((m) => h('option', { key: m, value: m }, m))),
      h(ReasoningControl, { descriptor: cur.descriptor, effort: cur.effort, disabled, onChange: (effort) => onChange({ provider: cur.provider, model: cur.model, effort }) }));
  }

  const nativeCreateElement = React.createElement;
  React.createElement = function (type, props, ...children) {
    return nativeCreateElement.call(React, typeof type === 'function' && type.name === 'CompactRouteSelector' ? SmartCompactRouteSelector : type, props, ...children);
  };

  function reasoningValueFromModelOptions(options, d = null) {
    if (!options || typeof options !== 'object') return '';
    const r = options.reasoning && typeof options.reasoning === 'object' ? options.reasoning : null;
    if (r?.enabled === false) return 'none';
    const nested = String(r?.effort || '').trim();
    if (nested && nested !== 'auto') return nested;
    if (r?.enabled === true) return d?.control === 'toggle' ? d.defaultEffort : '';
    const flat = String(options.reasoning_effort ?? options.reasoningEffort ?? '').trim();
    return !flat || flat === 'auto' ? '' : flat;
  }

  if (!document.querySelector('style[data-hws-model-capabilities]')) {
    const style = document.createElement('style');
    style.dataset.hwsModelCapabilities = '1';
    style.textContent = '.hws3-reasoning-capability{display:inline-flex;align-items:center;gap:.65rem;flex-wrap:wrap}.hws3-reasoning-switch{display:inline-flex;align-items:center;gap:.42rem;min-height:32px;padding:4px 8px;border:1px solid rgba(93,167,153,.28);border-radius:999px;background:rgba(18,48,43,.72);color:var(--hws-text,#e8d5ac);cursor:pointer;user-select:none}.hws3-reasoning-switch-label{font-size:10px}.hws3-switch-input{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;clip-path:inset(50%)!important}.hws3-switch-track{position:relative;width:34px;height:19px;flex:0 0 auto;border-radius:999px;background:rgba(158,181,174,.24);box-shadow:inset 0 0 0 1px rgba(158,181,174,.24);transition:background .24s cubic-bezier(.22,1,.36,1),box-shadow .24s cubic-bezier(.22,1,.36,1)}.hws3-switch-thumb{position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:#d7e7df;box-shadow:0 2px 6px rgba(0,0,0,.28);transition:transform .28s cubic-bezier(.22,1.2,.36,1),background .2s ease}.hws3-switch-input:checked+.hws3-switch-track{background:var(--hws-teal,#3aa897);box-shadow:inset 0 0 0 1px rgba(232,213,172,.2),0 0 0 3px rgba(58,168,151,.08)}.hws3-switch-input:checked+.hws3-switch-track .hws3-switch-thumb{transform:translateX(15px);background:#fff4d4}.hws3-switch-input:focus-visible+.hws3-switch-track{outline:2px solid var(--hws-accent,#e8d5ac);outline-offset:3px}.hws3-switch-input:active+.hws3-switch-track .hws3-switch-thumb{transform:translateX(15px) scale(.88)}.hws3-switch-input:not(:checked):active+.hws3-switch-track .hws3-switch-thumb{transform:scale(.88)}.hws3-switch-input:disabled+.hws3-switch-track,.hws3-reasoning-switch:has(.hws3-switch-input:disabled){opacity:.55;cursor:not-allowed}.hws3-switch-state{min-width:26px;color:var(--hws-muted,#9eb5ae);font-size:9px;font-weight:650}.hws3-reasoning-effort{display:inline-flex;align-items:center;gap:.55rem;min-width:190px;padding:5px 9px;border:1px solid rgba(93,167,153,.22);border-radius:11px;background:rgba(7,21,19,.36);white-space:nowrap}.hws3-reasoning-effort-head{display:grid;gap:1px;min-width:37px;color:var(--hws-muted,#9eb5ae);font-size:9px}.hws3-reasoning-effort-head b{color:var(--hws-accent,#e8d5ac);font-size:10px}.hws3-reasoning-slider-shell{position:relative;display:grid;gap:3px;min-width:125px;flex:1}.hws3-reasoning-slider{width:100%;height:18px;margin:0;appearance:none;background:transparent;accent-color:var(--hws-teal,#3aa897);cursor:pointer}.hws3-reasoning-slider::-webkit-slider-runnable-track{height:5px;border-radius:999px;background:linear-gradient(90deg,rgba(58,168,151,.9),rgba(232,213,172,.82))}.hws3-reasoning-slider::-webkit-slider-thumb{width:17px;height:17px;margin-top:-6px;appearance:none;border:2px solid #f4e8c7;border-radius:50%;background:var(--hws-teal,#3aa897);box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .22s cubic-bezier(.22,1.2,.36,1),box-shadow .2s ease}.hws3-reasoning-slider:active::-webkit-slider-thumb{transform:scale(1.14);box-shadow:0 0 0 5px rgba(58,168,151,.12),0 3px 10px rgba(0,0,0,.36)}.hws3-reasoning-slider::-moz-range-track{height:5px;border-radius:999px;background:linear-gradient(90deg,rgba(58,168,151,.9),rgba(232,213,172,.82))}.hws3-reasoning-slider::-moz-range-thumb{width:13px;height:13px;border:2px solid #f4e8c7;border-radius:50%;background:var(--hws-teal,#3aa897);box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .22s cubic-bezier(.22,1.2,.36,1)}.hws3-reasoning-slider:disabled{opacity:.35;cursor:not-allowed}.hws3-reasoning-slider-ticks{display:flex;justify-content:space-between;gap:3px;padding:0 2px}.hws3-reasoning-slider-ticks i{display:grid;justify-items:center;gap:2px;min-width:0;color:var(--hws-muted,#9eb5ae);font-style:normal;font-size:8px}.hws3-reasoning-slider-ticks i em{width:4px;height:4px;border-radius:50%;background:rgba(158,181,174,.34)}.hws3-reasoning-slider-ticks i.active{color:var(--hws-accent,#e8d5ac)}.hws3-reasoning-slider-ticks i.active em{background:var(--hws-accent,#e8d5ac);box-shadow:0 0 0 3px rgba(232,213,172,.1)}.hws3-reasoning-readonly{opacity:.68}.hws3-moa-reasoning-capability{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin-top:.55rem}.hws3-moa-reasoning-capability>small{width:100%}';
    document.head.appendChild(style);
  }

  window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__ = {
    version: 2, descriptor: descriptorFromCapability, enrichModelOptions, reasoningValueFromModelOptions, reasoningLabel: label, validateReasoning, hermesDefaultEffort: HERMES_DEFAULT_EFFORT, source: 'Hermes public model/options + official provider config + Gateway config.set',
    _internal: { clone, providerRows, providerBySlug, modelsFor, descriptor, modelCapability, allowedReasoningValues, SmartCompactRouteSelector, configObject, configProvider, explicitReasoningMetadata, applyNativeReasoningConstraint, overlayFromHermesConfig, positiveContextWindow, modelContextMetadata },
  };
})();
