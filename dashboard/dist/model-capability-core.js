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

  function label(d) {
    if (d.control === 'none') return '不支持';
    if (d.control === 'fixed') return '始终开启';
    if (d.control === 'toggle') return '开关';
    if (d.control === 'effort') return `强度 · ${d.efforts.map((x) => x.value).join(' / ')}`;
    if (d.control === 'toggle_effort') return `开关 + 强度 · ${d.efforts.map((x) => x.value).join(' / ')}`;
    return d.supported === true ? 'Hermes 返回思考支持 · 档位未公开' : '上游未声明';
  }

  function ReasoningControl({ descriptor: d, effort, disabled, onChange }) {
    if (d.control === 'none') return h('span', { className: 'hws3-pill', title: 'Hermes 官方 model inventory 声明不支持 reasoning' }, '思考 · 不支持');
    if (d.control === 'auto') return h('span', { className: 'hws3-pill', title: d.supported === true ? 'Hermes 当前能力目录返回思考支持；上游没有公开可编辑的强度 vocabulary，Studio 不猜测档位' : 'Hermes 未声明可编辑 reasoning 控件；Studio 不猜测' }, d.supported === true ? '思考 · Hermes 返回支持（档位未公开）' : '思考 · 上游未声明');
    if (d.control === 'fixed') return h('span', { className: 'hws3-pill', title: 'Hermes/provider 声明 reasoning 不可关闭' }, '思考 · 始终开启');
    const enabled = effort !== 'none';
    const toggle = d.canDisable === true ? h('label', { className: 'hws3-reasoning-toggle' }, h('span', null, '思考'), h('input', { type: 'checkbox', checked: enabled, disabled, 'aria-label': '开启思考', onChange: (e) => onChange(e.target.checked ? (d.efforts[0]?.value || d.defaultEffort) : 'none') }), h('b', null, enabled ? '开启' : '关闭')) : null;
    if (d.control === 'toggle') return toggle;
    const values = [{ value: 'auto' }, ...d.efforts];
    const current = enabled && values.some((x) => x.value === effort) ? effort : 'auto';
    const scale = h('label', { className: 'hws3-reasoning-effort', title: '只显示 Hermes 上游明确给出的 effort vocabulary' }, h('span', null, '强度'), h('select', { value: current, disabled: disabled || !enabled, 'aria-label': '思考强度', onChange: (e) => onChange(e.target.value) }, values.map((x) => h('option', { key: x.value, value: x.value }, x.value === 'auto' ? 'Auto' : x.value))));
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
    style.textContent = '.hws3-reasoning-capability{display:inline-flex;align-items:center;gap:.45rem}.hws3-reasoning-toggle,.hws3-reasoning-effort{display:inline-flex;align-items:center;gap:.35rem;white-space:nowrap}.hws3-reasoning-readonly{opacity:.68}.hws3-moa-reasoning-capability{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin-top:.55rem}.hws3-moa-reasoning-capability>small{width:100%}';
    document.head.appendChild(style);
  }

  window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__ = {
    version: 2, descriptor: descriptorFromCapability, enrichModelOptions, reasoningValueFromModelOptions, reasoningLabel: label, validateReasoning, hermesDefaultEffort: HERMES_DEFAULT_EFFORT, source: 'Hermes public model/options + official provider config + Gateway config.set',
    _internal: { clone, providerRows, providerBySlug, modelsFor, descriptor, modelCapability, allowedReasoningValues, SmartCompactRouteSelector, configObject, configProvider, explicitReasoningMetadata, applyNativeReasoningConstraint, overlayFromHermesConfig },
  };
})();
