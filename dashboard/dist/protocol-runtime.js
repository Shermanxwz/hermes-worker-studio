(function () {
  'use strict';

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || typeof SDK.fetchJSON !== 'function') {
    console.error('[hermes-worker-studio] protocol runtime requires Hermes Plugin SDK fetchJSON');
    return;
  }

  const originalFetchJSON = SDK.fetchJSON.bind(SDK);
  const PLUGIN = '/api/plugins/hermes-worker-studio';
  const PROTOCOLS = `${PLUGIN}/hermes/protocols`;
  const PROTOCOL_ROUTE = `${PLUGIN}/hermes/protocol-route`;
  const PROTOCOL_RESOLVE = `${PLUGIN}/hermes/protocols/resolve`;
  const PROTOCOL_PROBE = `${PLUGIN}/hermes/protocols/probe`;
  const MODEL_PROBE = `${PLUGIN}/hermes/model-probe`;
  let projectedRoutes = null;

  function jsonBody(init) {
    if (!init || init.body == null) return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body); } catch (_) { return {}; }
    }
    return init.body && typeof init.body === 'object' ? init.body : {};
  }

  function post(body) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  function errorText(error) {
    return String(error?.message || error || '');
  }

  function missingOptionalRoute(error) {
    return /Unhandled fetchJSON call|404|Not Found/i.test(errorText(error));
  }

  function routeKey(route) {
    return `${String(route?.provider || '').trim()}\n${String(route?.model || '').trim()}`;
  }

  function rememberProjection(data) {
    if (Array.isArray(data?.routes)) projectedRoutes = data.routes;
    return data;
  }

  function upsertProjectedRoute(route) {
    if (!Array.isArray(projectedRoutes) || !route?.provider || !route?.model) return route;
    const key = routeKey(route);
    const index = projectedRoutes.findIndex((item) => routeKey(item) === key);
    if (index >= 0) projectedRoutes[index] = route;
    else projectedRoutes.push(route);
    return route;
  }

  function protocolRouteUrl(provider, model) {
    const query = new URLSearchParams({ provider, model });
    return `${PROTOCOL_ROUTE}?${query.toString()}`;
  }

  async function explicitProtocolProbe(provider, model) {
    const result = await originalFetchJSON(PROTOCOL_PROBE, post({ provider, model }));
    upsertProjectedRoute(result?.route);
    return result;
  }

  async function lazyProtocolResolve(provider, model) {
    try {
      const route = await originalFetchJSON(PROTOCOL_RESOLVE, post({ provider, model }));
      return upsertProjectedRoute(route?.route || route);
    } catch (error) {
      if (!missingOptionalRoute(error)) throw error;
      const result = await explicitProtocolProbe(provider, model);
      return result?.route || result;
    }
  }

  async function protocolSnapshot(provider, model) {
    try {
      return await originalFetchJSON(protocolRouteUrl(provider, model));
    } catch (error) {
      if (missingOptionalRoute(error)) return null;
      throw error;
    }
  }

  async function executionRoute(provider, model) {
    const snapshot = await protocolSnapshot(provider, model);
    if (!snapshot) return null;
    if (snapshot?.status === 'ambiguous' || snapshot?.requires_choice) return upsertProjectedRoute(snapshot);
    if (!snapshot?.requires_probe) return upsertProjectedRoute(snapshot);
    return lazyProtocolResolve(provider, model);
  }

  async function diagnosticModelProbe(body, init) {
    const provider = String(body?.provider || '').trim();
    const model = String(body?.model || '').trim();
    if (!provider || !model || provider.toLowerCase() === 'moa' || provider.toLowerCase().startsWith('hws-protocol-')) {
      return originalFetchJSON(MODEL_PROBE, init);
    }

    const snapshot = await protocolSnapshot(provider, model);
    if (!snapshot) return originalFetchJSON(MODEL_PROBE, init);

    // The Models-page diagnostic must never choose Chat merely because the
    // local protocol projection has not populated yet. For an unresolved or
    // ambiguous custom model, run the explicit two-transport Hermes probe and
    // return its real result directly. This is the exact case that previously
    // produced a misleading /v1/chat/completions 500 for Responses-only models.
    if (snapshot?.requires_probe || snapshot?.status === 'ambiguous') {
      return explicitProtocolProbe(provider, model);
    }

    upsertProjectedRoute(snapshot);
    const executionProvider = String(snapshot?.execution_provider || provider).trim() || provider;
    if (executionProvider === provider) return originalFetchJSON(MODEL_PROBE, init);
    return originalFetchJSON(MODEL_PROBE, post({ ...body, provider: executionProvider, model }));
  }

  SDK.fetchJSON = async function protocolRuntimeFetch(path, init) {
    const url = String(path || '');
    const method = String(init?.method || 'GET').toUpperCase();

    if (url === PROTOCOLS && method === 'GET') {
      return rememberProjection(await originalFetchJSON(path, init));
    }

    if (url.startsWith(`${PROTOCOL_ROUTE}?`) && method === 'GET') {
      const requested = new URL(url, 'http://worker-studio.local');
      const provider = String(requested.searchParams.get('provider') || '').trim();
      const model = String(requested.searchParams.get('model') || '').trim();
      if (!provider || !model) return originalFetchJSON(path, init);
      const route = await executionRoute(provider, model);
      return route || originalFetchJSON(path, init);
    }

    // A transformed Product 3 bundle calls /protocols/resolve directly. The
    // checked-in backend source predates that convenience route but already
    // exposes /protocols/probe. Fall back only when the optional resolver is
    // genuinely absent; real probe/auth/transport failures remain fail-closed.
    if (url === PROTOCOL_RESOLVE && method === 'POST') {
      const body = jsonBody(init);
      try {
        const route = await originalFetchJSON(path, init);
        return upsertProjectedRoute(route?.route || route);
      } catch (error) {
        if (!missingOptionalRoute(error)) throw error;
        const result = await explicitProtocolProbe(String(body.provider || ''), String(body.model || ''));
        return result?.route || result;
      }
    }

    if (url === MODEL_PROBE && method === 'POST') {
      return diagnosticModelProbe(jsonBody(init), init);
    }

    return originalFetchJSON(path, init);
  };

  window.__HERMES_WORKER_STUDIO_PROTOCOL_RUNTIME__ = {
    source: 'hermes-official-model-options+real-runs',
    modes: ['chat_completions', 'codex_responses'],
    heuristic: false,
    first_use: true,
  };
})();
