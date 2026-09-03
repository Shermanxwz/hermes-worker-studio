import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { JSDOM } from 'jsdom';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFile(path.join(rootDir, `dashboard/dist/${name}`), 'utf8');
const [entry, core, bridge, domLayer] = await Promise.all(['model-capability-entry.js', 'model-capability-core.js', 'model-capability-bridge.js', 'model-capability-dom.js'].map(read));
const dom = new JSDOM('<!doctype html><html><head><script src="http://127.0.0.1/dashboard/dist/model-capability-entry.js"></script></head><body></body></html>', { url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });

const calls = [];
const modelOptions = { provider: 'official', model: 'toggle-model', providers: [{ slug: 'official', name: 'Official', authenticated: true, models: ['toggle-model', 'effort-model', 'fixed-model', 'plain-model'], capabilities: {
  'toggle-model': { reasoning: true },
  'effort-model': { reasoning: { supported: true, control: 'toggle_effort', options: ['low', 'high'], can_disable: true } },
  'fixed-model': { reasoning: { supported: true, control: 'fixed', can_disable: false } },
  'plain-model': { reasoning: false },
} }] };
const moaConfig = { default_preset: 'default', presets: { default: { reference_models: [{ provider: 'official', model: 'effort-model', reasoning_effort: 'low', enabled: true }], aggregator: { provider: 'official', model: 'toggle-model' } } } };
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
  send(raw) { const msg = JSON.parse(raw); calls.push({ rpc: msg.method, params: msg.params }); const result = msg.method === 'session.resume' ? { session_id: 'runtime-session-1' } : msg.method === 'config.set' ? { value: msg.params.value } : {}; queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) })); }
  close() { this.readyState = 3; this.onclose?.(); }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket }); window.WebSocket = FakeWebSocket;

// Entry must preserve deterministic load order: capability layers, then native Gateway.
const loaded = [];
const nativeAppend = window.document.head.appendChild.bind(window.document.head);
window.document.head.appendChild = (node) => { if (node.tagName === 'SCRIPT') { loaded.push(path.basename(new URL(node.src).pathname)); queueMicrotask(() => node.onload?.()); return node; } return nativeAppend(node); };
window.eval(entry);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(loaded, ['model-capability-core.js', 'model-capability-bridge.js', 'model-capability-dom.js', 'gateway-native.js']);
window.document.head.appendChild = nativeAppend;

window.eval(core); window.eval(bridge); window.eval(domLayer);
const api = window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__;
assert.equal(api.descriptor({ reasoning: false }).control, 'none');
assert.equal(api.descriptor({ reasoning: true }).control, 'toggle');
assert.equal(api.descriptor({ reasoning: { supported: true, control: 'fixed', can_disable: false } }).control, 'fixed');
assert.deepEqual(api.descriptor({ reasoning: { supported: true, options: ['low', 'high'], can_disable: true } }).efforts.map((x) => x.value), ['low', 'high']);
assert.equal(api.reasoningValueFromModelOptions({ reasoning: { enabled: true } }), 'medium');
assert.equal(api.reasoningValueFromModelOptions({ reasoning: { enabled: false } }), 'none');

// Simulate gateway-native.js assigning its wrapper after capability bridge.
const capabilityFetch = window.__HERMES_PLUGIN_SDK__.fetchJSON;
window.__HERMES_PLUGIN_SDK__.fetchJSON = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs-v3') return { id: 'run-1', status: 'running', session_id: body.session_id };
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs/run-1?after=0') return { id: 'run-1', status: 'completed', events: [] };
  return capabilityFetch(url, init);
};
const enriched = await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/model/options');
assert.equal(enriched.providers[0].capabilities['toggle-model'].hws_reasoning_control.control, 'toggle');
assert.deepEqual(enriched.providers[0].capabilities['toggle-model'].reasoning_efforts.map((x) => x.value), ['none', 'medium']);
assert.deepEqual(enriched.providers[0].capabilities['effort-model'].reasoning_efforts.map((x) => x.value), ['none', 'low', 'high']);

const started = await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: 'stored-session-1', input: 'hello', provider: 'official', model: 'toggle-model', model_options: { reasoning_effort: 'none' } }) });
assert.deepEqual(calls.find((x) => x.rpc === 'session.resume').params.session_id, 'stored-session-1');
assert.deepEqual(calls.find((x) => x.rpc === 'config.set').params, { key: 'reasoning', session_id: 'runtime-session-1', value: 'none' });
assert.deepEqual(started.source_route, { provider: 'official', model: 'toggle-model', reasoning: 'none', source: 'hermes.model_options+gateway.config.set' });
const snap = await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs/run-1?after=0');
assert.deepEqual(snap.source_route, started.source_route);

await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/moa-config');
api._runtime.setMoaOverride(api._runtime.moaKey('default', 'reference', 0), 'high');
const saved = await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/hermes-worker-studio/hermes/moa-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(moaConfig) });
assert.equal(saved.presets.default.reference_models[0].reasoning_effort, 'high');

const verifier = window.document.createElement('section'); verifier.className = 'hws3-card'; verifier.innerHTML = '<header><small>VERIFIER</small></header><div class="hws3-reasoning-capability"><input type="checkbox"><select><option>low</option></select></div>';
const twoCol = window.document.createElement('div'); twoCol.className = 'hws3-two-col'; twoCol.appendChild(verifier); window.document.body.appendChild(twoCol);
api._testing.enhanceVerifier();
assert.equal(verifier.querySelector('input').disabled, true); assert.equal(verifier.querySelector('select').disabled, true); assert.match(verifier.textContent, /未公开独立 reasoning 写入契约/);
console.log('Model capability closure runtime passed.');
