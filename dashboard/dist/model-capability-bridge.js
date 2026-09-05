(function () {
  'use strict';
  const SDK = window.__HERMES_PLUGIN_SDK__;
  const API = window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__;
  if (!SDK || !API?._internal) return;
  const { clone } = API._internal;
  const PLUGIN = '/api/plugins/hermes-worker-studio';
  const RUNS = `${PLUGIN}/hermes/runs-v3`;
  const RUN_RE = new RegExp(`^${PLUGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/hermes/runs/([^/?]+)`);
  const MOA_PLUGIN = `${PLUGIN}/hermes/moa-config`;
  const MOA_OFFICIAL = '/api/model/moa';
  const moaOverrides = new Map();
  const runRoutes = new Map();
  let modelOptions = null;
  let hermesConfig;
  let moaConfig = null;

  const parseBody = (init) => { try { return init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : null; } catch (_) { return null; } };
  const withBody = (init, body) => ({ ...(init || {}), headers: { ...((init || {}).headers || {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const isModelOptionsPath = (path) => path === '/api/model/options' || String(path || '').startsWith('/api/model/options?');
  const isConfigWrite = (path, method) => path === '/api/config' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  class GatewayRpc {
    constructor() { this.ws = null; this.opening = null; this.pending = new Map(); this.seq = 0; }
    async connect() {
      if (this.ws?.readyState === 1) return;
      if (this.opening) return this.opening;
      this.opening = (async () => {
        const raw = await SDK.buildWsUrl('/api/ws');
        const url = typeof raw === 'string' ? raw : raw?.url;
        if (!url) throw new Error('Hermes Gateway WebSocket URL unavailable');
        await new Promise((resolve, reject) => {
          const ws = new WebSocket(url);
          const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('Hermes Gateway reasoning preflight timed out')); }, 12000);
          ws.onopen = () => { clearTimeout(timer); this.ws = ws; resolve(); };
          ws.onerror = () => { clearTimeout(timer); reject(new Error('Hermes Gateway reasoning preflight connection failed')); };
          ws.onclose = () => { if (this.ws === ws) this.ws = null; for (const p of this.pending.values()) p.reject(new Error('Hermes Gateway connection closed')); this.pending.clear(); };
          ws.onmessage = (event) => { let msg; try { msg = JSON.parse(event.data); } catch (_) { return; } const p = this.pending.get(msg?.id); if (!p) return; this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result ?? {}); };
        });
      })();
      try { await this.opening; } finally { this.opening = null; }
    }
    async request(method, params, timeout = 30000) {
      await this.connect();
      const id = `hws-reasoning-${Date.now()}-${++this.seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Hermes Gateway ${method} timed out`)); }, timeout);
        this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }));
      });
    }
  }
  const gateway = new GatewayRpc();

  async function applyReasoning(storedId, value) {
    if (!storedId || !value || value === 'auto') return null;
    const resumed = await gateway.request('session.resume', { session_id: String(storedId), source: 'hermes_browser', omit_messages: true, close_on_disconnect: false, eager_build: true });
    const runtimeId = String(resumed?.session_id || resumed?.session?.id || resumed?.id || storedId);
    const result = await gateway.request('config.set', { key: 'reasoning', session_id: runtimeId, value });
    return { runtime_id: runtimeId, value: String(result?.value || value) };
  }

  const moaKey = (preset, kind, index) => `${preset}|${kind}|${kind === 'reference' ? index : ''}`;

  const base = SDK.fetchJSON.bind(SDK);

  async function ensureHermesConfig(refresh = false) {
    if (refresh) hermesConfig = undefined;
    if (hermesConfig !== undefined) return hermesConfig;
    try {
      const raw = await base('/api/config');
      hermesConfig = raw && typeof raw === 'object' ? raw : null;
    } catch (_) {
      // Some API-server-only or older Hermes surfaces do not expose the
      // Dashboard config contract. Missing config metadata is a capability
      // miss, never permission to invent a reasoning vocabulary.
      hermesConfig = null;
    }
    return hermesConfig;
  }

  async function ensureModelOptions(refresh = false) {
    if (refresh) modelOptions = null;
    if (modelOptions) return modelOptions;
    const suffix = refresh ? '?refresh=1' : '';
    const [raw, config] = await Promise.all([base(`/api/model/options${suffix}`), ensureHermesConfig(refresh)]);
    modelOptions = API.enrichModelOptions(raw, config);
    return modelOptions;
  }

  function capabilityRoute(config, provider, model) {
    const wanted = String(provider || '').trim().toLowerCase();
    const fallback = { provider: String(provider || '').trim(), model: String(model || '').trim() };
    if (!wanted) return fallback;
    const root = API._internal.configObject(config);
    const providers = root && typeof root.providers === 'object' && !Array.isArray(root.providers) ? root.providers : {};
    for (const [key, entry] of Object.entries(providers)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const identities = [key, entry.name, entry.slug, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
        .map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      if (!identities.includes(wanted)) continue;
      const marker = entry.hws_protocol_bridge;
      if (marker && typeof marker === 'object' && !Array.isArray(marker) && marker.source_provider) {
        return {
          provider: String(marker.source_provider).trim(),
          model: String(marker.source_model || model || '').trim(),
          execution_provider: String(provider || '').trim(),
          execution_model: String(model || '').trim(),
        };
      }
      return fallback;
    }
    return fallback;
  }

  function applyMoaOverrides(body) {
    if (!body?.presets || typeof body.presets !== 'object') return body;
    const next = clone(body);
    for (const [key, effort] of moaOverrides) {
      const [preset, kind, rawIndex] = key.split('|');
      const row = next.presets?.[preset];
      const slot = kind === 'aggregator' ? row?.aggregator : row?.reference_models?.[Number(rawIndex)];
      if (!slot || typeof slot !== 'object') continue;
      const requested = String(effort || 'auto');
      if (requested !== 'auto') API.validateReasoning(modelOptions, String(slot.provider || ''), String(slot.model || ''), requested);
      if (requested === 'auto') delete slot.reasoning_effort; else slot.reasoning_effort = requested;
    }
    return next;
  }

  async function sourceRoute(body) {
    const provider = String(body?.provider || '').trim();
    const model = String(body?.model || '').trim();
    const config = await ensureHermesConfig();
    const capability = capabilityRoute(config, provider, model);
    const capabilityProvider = capability.provider || provider;
    const capabilityModel = capability.model || model;
    let requested = API.reasoningValueFromModelOptions(body?.model_options) || 'auto';
    let checked = null;
    if (requested !== 'auto') {
      const options = await ensureModelOptions();
      const d = API._internal.descriptor(options, capabilityProvider, capabilityModel);
      requested = API.reasoningValueFromModelOptions(body?.model_options, d) || requested;
      checked = API.validateReasoning(options, capabilityProvider, capabilityModel, requested);
    } else if (modelOptions && provider && model) {
      checked = API.validateReasoning(modelOptions, capabilityProvider, capabilityModel, 'auto');
    }
    const result = {
      provider: provider || null,
      model: model || null,
      reasoning: checked?.value || 'auto',
      reasoning_semantic: checked?.semantic || 'auto',
      reasoning_control: checked?.descriptor?.control || 'auto',
      reasoning_source: checked?.descriptor?.source || 'unknown',
      source: 'hermes.model_options+provider_config+gateway.config.set',
    };
    if (capabilityProvider !== provider || capabilityModel !== model) {
      result.source_provider = capabilityProvider || null;
      result.source_model = capabilityModel || null;
    }
    return result;
  }
  const attachRoute = (result, meta) => meta && result && typeof result === 'object' && !Array.isArray(result) ? { ...result, source_route: clone(meta) } : result;

  let downstream = null;
  async function fetchJSON(path, init, internal = false) {
    // Gateway-native calls this same wrapper for its raw downstream request.
    // Mark that hop explicitly: a shared depth counter misclassifies an
    // unrelated concurrent Product request as nested and returns un-enriched
    // /api/model/options data.
    const top = internal !== true;
    let nextInit = init;
    let pending = null;
    const method = String(init?.method || 'GET').toUpperCase();
    const refreshModelOptions = isModelOptionsPath(path) && /(?:^|[?&])refresh=1(?:&|$)/.test(String(path));
      if (top && refreshModelOptions) {
        modelOptions = null;
        hermesConfig = undefined;
      }
      if (top && path === RUNS && method === 'POST') {
        const body = parseBody(init) || {};
        pending = await sourceRoute(body);
        if (pending.reasoning !== 'auto') await applyReasoning(body.session_id, pending.reasoning);
      }
      if (top && (path === MOA_PLUGIN || path === MOA_OFFICIAL) && method === 'PUT') {
        const body = parseBody(init);
        if (body) {
          if (moaOverrides.size && !modelOptions) await ensureModelOptions();
          nextInit = withBody(init, applyMoaOverrides(body));
        }
      }
      const target = top && downstream ? downstream : base;
      let result = await target(path, nextInit);
      if (!top) return result;
      if (pending) {
        const id = String(result?.id || result?.run_id || '').trim();
        if (id) runRoutes.set(id, pending);
        result = attachRoute(result, pending);
      } else {
        const match = String(path || '').match(RUN_RE);
        if (match) result = attachRoute(result, runRoutes.get(decodeURIComponent(match[1])));
      }
      if (isModelOptionsPath(path)) {
        const config = await ensureHermesConfig(refreshModelOptions);
        modelOptions = API.enrichModelOptions(result, config);
        queueMicrotask(() => window.__HWS_MODEL_CAPABILITY_DOM_REFRESH__?.());
        return modelOptions;
      }
      if (path === '/api/config' && method === 'GET') {
        hermesConfig = result && typeof result === 'object' ? clone(result) : null;
        // Product 3 loads config and model options concurrently. A config
        // read is an observation, not a mutation: clearing an already
        // enriched model snapshot here lets the slower response erase the
        // capability data that the model picker just received.
      } else if (isConfigWrite(path, method)) {
        hermesConfig = undefined;
        modelOptions = null;
      }
      if ((path === MOA_PLUGIN || path === MOA_OFFICIAL) && method === 'GET') moaConfig = clone(result);
      if ((path === MOA_PLUGIN || path === MOA_OFFICIAL) && method === 'PUT') { moaConfig = clone(result); moaOverrides.clear(); }
      if (path === MOA_PLUGIN || path === MOA_OFFICIAL) queueMicrotask(() => window.__HWS_MODEL_CAPABILITY_DOM_REFRESH__?.());
      return result;
  }
  Object.defineProperty(SDK, 'fetchJSON', { configurable: true, enumerable: true, get: () => fetchJSON, set: (fn) => { downstream = typeof fn === 'function' ? fn.bind(SDK) : null; } });

  // Product 3 can be mounted by the Dashboard before this dynamically loaded
  // layer finishes installing. Signal readiness so its first model request
  // cannot race the capability/config enrichment path.
  window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITY_BRIDGE_READY__ = true;
  if (typeof window.dispatchEvent === 'function') {
    const event = typeof window.Event === 'function' ? new window.Event('hws-model-capability-ready') : { type: 'hws-model-capability-ready' };
    window.dispatchEvent(event);
  }

  API.applyMoaOverrides = applyMoaOverrides;
  API._runtime = {
    get modelOptions() { return modelOptions; }, get hermesConfig() { return hermesConfig; }, get moaConfig() { return moaConfig; }, moaOverrides, runRoutes,
    moaKey, setMoaOverride: (key, value) => moaOverrides.set(key, value), applyReasoning, sourceRoute, ensureModelOptions, ensureHermesConfig, capabilityRoute,
  };
})();
