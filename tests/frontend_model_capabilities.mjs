import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { JSDOM } from 'jsdom';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFile(path.join(rootDir, `dashboard/dist/${name}`), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const [loader, core, bridge, domLayer] = await Promise.all(['gateway-native.js', 'model-capability-core.js', 'model-capability-bridge.js', 'model-capability-dom.js'].map(read));
const dom = new JSDOM('<!doctype html><html><head><script src="http://127.0.0.1/dashboard/dist/gateway-native.js"></script></head><body></body></html>', { url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });

const calls = [];
const modelOptions = { provider: 'official', model: 'toggle-model', providers: [{ slug: 'official', name: 'Official', authenticated: true, models: ['toggle-model', 'unknown-model', 'effort-model', 'fixed-model', 'plain-model'], capabilities: {
  'toggle-model': { reasoning: true, can_disable_reasoning: true },
  'unknown-model': { reasoning: true },
  'effort-model': { reasoning: { supported: true, control: 'toggle_effort', options: ['low', 'high'], can_disable: true } },
  'fixed-model': { reasoning: { supported: true, control: 'fixed', can_disable: false } },
  'plain-model': { reasoning: false },
} }] };
const moaConfig = { default_preset: 'default', presets: { default: { reference_models: [{ provider: 'official', model: 'effort-model', reasoning_effort: 'low', enabled: true }], aggregator: { provider: 'official', model: 'unknown-model' } } } };
window.__HERMES_PLUGIN_SDK__ = {
  React,
  buildWsUrl: async () => 'ws://127.0.0.1/api/ws',
  fetchJSON: async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', body });
    if (url.startsWith('/api/model/options')) return modelOptions;
    if (url === '/api/plugins/hermes-worker-studio/hermes/moa-config' || url === '/api/model/moa') return (init.method || 'GET') === 'PUT' ? body : moaConfig;
    return {};
  },
};
class FakeWebSocket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 1; queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const msg = JSON.parse(raw);
    calls.push({ rpc: msg.method, params: msg.params });
    const result = msg.method === 'session.resume' ? { session_id: 'runtime-session-1' } : msg.method === 'config.set' ? { value: msg.params.value } : {};
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) }));
  }
  close() { this.readyState = 3; this.onclose?.(); }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket }); window.WebSocket = FakeWebSocket;

// The manifest-owned Gateway entry is a deterministic loader. Capability
// layers must install before the immutable native Gateway core.
const loaded = [];
const nativeAppend = window.document.head.appendChild.bind(window.document.head);
window.document.head.appendChild = (node) => {
  if (node.tagName === 'SCRIPT') {
    loaded.push(path.basename(new URL(node.src).pathname));
    queueMicrotask(() => node.onload?.());
    return node;
  }
  return nativeAppend(node);
};
window.eval(loader);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(loaded, ['model-capability-core.js', 'model-capability-bridge.js', 'model-capability-dom.js', 'gateway-native-core.js']);
window.document.head.appendChild = nativeAppend;

window.eval(core); window.eval(bridge); window.eval(domLayer);
const api = window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__;
assert.equal(api.version, 2);
assert.equal(api.descriptor({ reasoning: false }).control, 'none');
assert.equal(api.descriptor({ reasoning: true }).control, 'auto', 'bare reasoning:true must not invent a disable control');
assert.equal(api.descriptor({ reasoning: true, can_disable_reasoning: true }).control, 'toggle');
assert.equal(api.descriptor({ reasoning: { supported: true, control: 'fixed', can_disable: false } }).control, 'fixed');
assert.deepEqual(plain(api.descriptor({ reasoning: { supported: true, options: ['low', 'high'], can_disable: true } }).efforts.map((x) => x.value)), ['low', 'high']);
const toggleDescriptor = api.descriptor({ reasoning: true, can_disable_reasoning: true });
assert.equal(api.reasoningValueFromModelOptions({ reasoning: { enabled: true } }), '');
assert.equal(api.reasoningValueFromModelOptions({ reasoning: { enabled: true } }, toggleDescriptor), 'medium');
assert.equal(api.reasoningValueFromModelOptions({ reasoning: { enabled: false } }, toggleDescriptor), 'none');
assert.throws(() => api.validateReasoning(modelOptions, 'official', 'unknown-model', 'none'), /does not explicitly allow disabling/);
assert.throws(() => api.validateReasoning(modelOptions, 'official', 'effort-model', 'medium'), /does not explicitly allow reasoning value/);

// Simulate gateway-native-core.js assigning its native wrapper after the
// capability bridge. The accessor must compose rather than replace it.
const capabilityFetch = window.__HERMES_PLUGIN_SDK__.fetchJSON;
window.__HERMES_PLUGIN_SDK__.fetchJSON = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs-v3') return { id: `run-${calls.filter((x) => x.downstreamRun).length + 1}`, status: 'running', session_id: body.session_id, downstream: true };
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/runs/run-')) return { id: url.split('/hermes/runs/')[1].split('?')[0], status: 'completed', events: [] };
  calls.push({ downstreamRun: url, body });
  return capabilityFetch(url, init);
};
const enriched = await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/model/options');
assert.equal(enriched.providers[0].capabilities['toggle-model'].hws_reasoning_control.control, 'toggle');
assert.equal(enriched.providers[0].capabilities['unknown-model'].hws_reasoning_control.control, 'auto');
assert.deepEqual(plain(enriched.providers[0].capabilities['toggle-model'].reasoning_efforts.map((x) => x.value)), ['none', 'medium']);
assert.equal(enriched.providers[0].capabilities['unknown-model'].reasoning_efforts, undefined, 'unknown control must not fabricate none/default efforts');
assert.deepEqual(plain(enriched.providers[0].capabilities['effort-model'].reasoning_efforts.map((x) => x.value)), ['none', 'low', 'high']);

const started = await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: 'stored-session-1', input: 'hello', provider: 'official', model: 'toggle-model', model_options: { reasoning_effort: 'none' } }) });
assert.equal(calls.find((x) => x.rpc === 'session.resume').params.session_id, 'stored-session-1');
assert.deepEqual(plain(calls.find((x) => x.rpc === 'config.set').params), { key: 'reasoning', session_id: 'runtime-session-1', value: 'none' });
assert.deepEqual(plain(started.source_route), { provider: 'official', model: 'toggle-model', reasoning: 'none', reasoning_semantic: 'off', reasoning_control: 'toggle', source: 'hermes.model_options+gateway.config.set' });
const snap = await window.__HERMES_PLUGIN_SDK__.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${started.id}?after=0`);
assert.deepEqual(plain(snap.source_route), plain(started.source_route));

const configWritesBeforeInvalid = calls.filter((x) => x.rpc === 'config.set').length;
await assert.rejects(
  () => window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: 'stored-session-2', input: 'no guessing', provider: 'official', model: 'unknown-model', model_options: { reasoning_effort: 'none' } }) }),
  /does not explicitly allow disabling/,
);
assert.equal(calls.filter((x) => x.rpc === 'config.set').length, configWritesBeforeInvalid, 'invalid capability must fail before Gateway write');

await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/moa-config');
api._runtime.setMoaOverride(api._runtime.moaKey('default', 'reference', 0), 'high');
const saved = await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/moa-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(moaConfig) });
assert.equal(saved.presets.default.reference_models[0].reasoning_effort, 'high');
api._runtime.setMoaOverride(api._runtime.moaKey('default', 'aggregator', 0), 'none');
await assert.rejects(
  () => window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/moa-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(moaConfig) }),
  /does not explicitly allow disabling/,
  'MOA must share the same fail-closed capability validator',
);
api._runtime.moaOverrides.clear();

const verifier = window.document.createElement('section'); verifier.className = 'hws3-card'; verifier.innerHTML = '<header><small>VERIFIER</small></header><div class="hws3-reasoning-capability"><input type="checkbox"><select><option>low</option></select></div>';
const twoCol = window.document.createElement('div'); twoCol.className = 'hws3-two-col'; twoCol.appendChild(verifier); window.document.body.appendChild(twoCol);
api._testing.enhanceVerifier();
assert.equal(verifier.querySelector('input').disabled, true); assert.equal(verifier.querySelector('select').disabled, true); assert.match(verifier.textContent, /未公开独立 reasoning 写入契约/);
console.log('Model capability closure runtime passed.');