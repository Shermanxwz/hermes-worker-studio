import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../dashboard/dist/protocol-runtime.js', import.meta.url), 'utf8');
const PLUGIN = '/api/plugins/hermes-worker-studio';

function missing(message = '404 Not Found') {
  throw new Error(message);
}

function loadBridge(handler) {
  const calls = [];
  const sdk = {
    fetchJSON: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ path: String(path), method: String(init?.method || 'GET').toUpperCase(), body });
      return handler(String(path), init, body, calls);
    },
  };
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    window: { __HERMES_PLUGIN_SDK__: sdk },
  };
  vm.runInNewContext(source, sandbox, { filename: 'protocol-runtime.js' });
  return { sdk, calls, sandbox };
}

{
  const { sdk, calls } = loadBridge(async (path, _init, body) => {
    if (path.startsWith(`${PLUGIN}/hermes/protocol-route?`)) {
      return { provider: 'new-api', model: 'gpt-5.6-sol', status: 'unresolved', requires_probe: true, execution_provider: '' };
    }
    if (path === `${PLUGIN}/hermes/protocols/resolve`) {
      assert.deepEqual(body, { provider: 'new-api', model: 'gpt-5.6-sol' });
      return { provider: 'new-api', model: 'gpt-5.6-sol', status: 'resolved', mode: 'codex_responses', requires_probe: false, execution_provider: 'hws-protocol-sol-responses' };
    }
    throw new Error(`unexpected ${path}`);
  });
  const route = await sdk.fetchJSON(`${PLUGIN}/hermes/protocol-route?provider=new-api&model=gpt-5.6-sol`);
  assert.equal(route.mode, 'codex_responses');
  assert.equal(route.execution_provider, 'hws-protocol-sol-responses');
  assert.equal(calls.filter((call) => call.path === `${PLUGIN}/hermes/protocols/resolve`).length, 1);
}

{
  let modelProbeCalls = 0;
  const projection = { routes: [] };
  const { sdk, calls } = loadBridge(async (path, _init, body) => {
    if (path === `${PLUGIN}/hermes/protocols`) return projection;
    if (path.startsWith(`${PLUGIN}/hermes/protocol-route?`)) {
      return { provider: 'new-api', model: 'gpt-5.6-luna', status: 'unresolved', requires_probe: true, execution_provider: '' };
    }
    if (path === `${PLUGIN}/hermes/protocols/probe`) {
      assert.deepEqual(body, { provider: 'new-api', model: 'gpt-5.6-luna' });
      return {
        ok: true,
        status: 'resolved',
        route: { provider: 'new-api', model: 'gpt-5.6-luna', status: 'resolved', mode: 'codex_responses', requires_probe: false, execution_provider: 'hws-protocol-luna-responses' },
        results: {
          chat_completions: { ok: false, status: 'failed', error: '/v1/chat/completions endpoint not supported' },
          codex_responses: { ok: true, status: 'completed' },
        },
      };
    }
    if (path === `${PLUGIN}/hermes/model-probe`) {
      modelProbeCalls += 1;
      return { ok: false, error: 'should not be called for unresolved model' };
    }
    throw new Error(`unexpected ${path}`);
  });
  const projected = await sdk.fetchJSON(`${PLUGIN}/hermes/protocols`);
  assert.strictEqual(projected, projection);
  assert.strictEqual(projected.routes, projection.routes, 'ModelsPage keeps the official route-array reference in React state');
  const result = await sdk.fetchJSON(`${PLUGIN}/hermes/model-probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'new-api', model: 'gpt-5.6-luna' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.route.mode, 'codex_responses');
  assert.equal(modelProbeCalls, 0, 'unresolved diagnostics must never fall through to provider-default Chat probe');
  assert.equal(calls.filter((call) => call.path === `${PLUGIN}/hermes/protocols/probe`).length, 1);
  assert.equal(projection.routes.length, 1, 'real probe must update the already-rendered protocol projection');
  assert.equal(projection.routes[0].status, 'resolved');
  assert.equal(projection.routes[0].mode, 'codex_responses');
  assert.equal(projection.routes[0].execution_provider, 'hws-protocol-luna-responses');
}

{
  const { sdk, calls } = loadBridge(async (path, _init, body) => {
    if (path.startsWith(`${PLUGIN}/hermes/protocol-route?`)) {
      return { provider: 'new-api', model: 'opaque-model', status: 'resolved', mode: 'codex_responses', requires_probe: false, execution_provider: 'hws-protocol-opaque-responses' };
    }
    if (path === `${PLUGIN}/hermes/model-probe`) {
      assert.equal(body.provider, 'hws-protocol-opaque-responses');
      assert.equal(body.model, 'opaque-model');
      return { ok: true, status: 'completed' };
    }
    throw new Error(`unexpected ${path}`);
  });
  const result = await sdk.fetchJSON(`${PLUGIN}/hermes/model-probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'new-api', model: 'opaque-model' }),
  });
  assert.equal(result.ok, true);
  assert.equal(calls.at(-1).body.provider, 'hws-protocol-opaque-responses');
}

{
  const { sdk, calls } = loadBridge(async (path, _init, body) => {
    if (path === `${PLUGIN}/hermes/protocols/resolve`) missing();
    if (path === `${PLUGIN}/hermes/protocols/probe`) {
      return { ok: true, status: 'resolved', route: { provider: body.provider, model: body.model, status: 'resolved', mode: 'codex_responses', requires_probe: false, execution_provider: 'hws-protocol-terra-responses' } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const route = await sdk.fetchJSON(`${PLUGIN}/hermes/protocols/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'new-api', model: 'gpt-5.6-terra' }),
  });
  assert.equal(route.mode, 'codex_responses');
  assert.equal(calls.filter((call) => call.path === `${PLUGIN}/hermes/protocols/probe`).length, 1);
}

assert.equal(Boolean(globalThis.__HERMES_WORKER_STUDIO_PROTOCOL_RUNTIME__), false, 'bridge must not leak into Node globalThis');
console.log('frontend protocol runtime bridge passed');
