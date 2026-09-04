import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await fs.readFile(path.join(rootDir, 'dashboard/dist/index-v3.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:19119/', runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'MouseEvent']) globalThis[name] = window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.__HERMES_BASE_PATH__ = '';
// This isolated settings harness intentionally omits the dynamic capability
// layer; do not wait for a bridge that is not part of this fixture.
window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITY_BRIDGE_READY__ = true;
window.requestAnimationFrame = (fn) => { fn(Date.now()); return 1; };
globalThis.requestAnimationFrame = window.requestAnimationFrame;
window.HTMLElement.prototype.scrollTo = function scrollTo() {};
window.confirm = () => true;
globalThis.confirm = window.confirm;
window.alert = (message) => { throw new Error(`unexpected alert: ${message}`); };
globalThis.alert = window.alert;

const { createRoot } = await import('react-dom/client');
const calls = [];
let unattendedProbeCount = 0;
let savedEndpointPayload = null;
let activatedEndpoint = null;
let deletedEndpoint = null;
let config = {
  plugins: { entries: { 'hermes-worker-studio': { settings: { mode: 'AUTO' } } } },
  approvals: {
    mode: 'smart', timeout: 300, cron_mode: 'approve', single_query_mode: 'approve',
    unattended_mode: 'approve', mcp_reload_confirm: true, destructive_slash_confirm: true,
  },
  delegation: { subagent_auto_approve: false },
  auxiliary: { review: { provider: 'auto', model: '' } },
};
let endpoints = [{
  id: 'local-api', name: 'Local API', base_url: 'http://127.0.0.1:8080/v1', model: 'old-model',
  models: ['old-model'], discover_models: true, is_current: false, source: 'custom-endpoint',
}];
let moaConfig = {
  default_preset: 'default', active_preset: '',
  presets: { default: {
    reference_models: [{ provider: 'official', model: 'main-model', enabled: true }],
    aggregator: { provider: 'official', model: 'main-model' },
    reference_temperature: null, aggregator_temperature: null, reference_timeout: null,
    degraded_reference_policy: 'loud', max_tokens: 4096, reference_max_tokens: null,
    fanout: 'user_turn', enabled: true,
  } },
};

const modelOptions = {
  provider: 'official', model: 'main-model', providers: [
    {
      slug: 'official', name: 'Official', authenticated: true, is_current: true,
      models: ['main-model'], capabilities: { 'main-model': {} },
    },
    { slug: 'local-api', name: 'Local API', authenticated: true, models: ['found-model'], capabilities: { 'found-model': {} } },
    { slug: 'moa', name: 'Mixture of Agents', authenticated: true, models: ['default'] },
  ],
};

function parseBody(init) { return init?.body ? JSON.parse(init.body) : null; }
function responseFor(url, init = {}) {
  const method = init.method || 'GET';
  const body = parseBody(init);
  calls.push({ url, method, body });

  if (url === '/api/sessions?limit=10&offset=0&order=recent&archived=exclude') return { sessions: [], total: 0 };
  if (url === '/api/model/options' || url === '/api/model/options?refresh=1') return modelOptions;
  if (url === '/api/model/moa' && method === 'GET') return moaConfig;
  if (url === '/api/model/moa' && method === 'PUT') { moaConfig = body; return { ok: true, ...moaConfig }; }
  if (url === '/api/config') {
    if (method === 'PUT') { config = body.config; return { ok: true }; }
    return { config };
  }
  if (url === '/api/providers/custom-endpoints' && method === 'GET') return { endpoints };
  if (url === '/api/providers/custom-endpoints/validate' && method === 'POST') return { ok: true, reachable: true, models: ['found-model'], message: 'ok' };
  if (url === '/api/providers/custom-endpoints' && method === 'POST') {
    savedEndpointPayload = body;
    const id = body.id || 'new-endpoint';
    const next = {
      id, name: body.name, base_url: body.base_url, model: body.model, models: body.models || [body.model],
      discover_models: body.discover_models !== false, is_current: Boolean(body.make_default), source: 'custom-endpoint',
    };
    endpoints = [next, ...endpoints.filter((ep) => ep.id !== id)];
    return { ok: true, id, endpoints };
  }
  if (url === '/api/providers/custom-endpoints/local-api/activate' && method === 'POST') {
    activatedEndpoint = 'local-api';
    endpoints = endpoints.map((ep) => ({ ...ep, is_current: ep.id === 'local-api' }));
    return { ok: true, provider: 'local-api', model: 'old-model' };
  }
  if (url === '/api/providers/custom-endpoints/local-api' && method === 'DELETE') {
    deletedEndpoint = 'local-api';
    endpoints = endpoints.filter((ep) => ep.id !== 'local-api');
    return { ok: true, endpoints };
  }

  if (url === '/api/plugins/hermes-worker-studio/health') return { ok: true, hermes: { ok: true } };
  if (url === '/api/plugins/hermes-worker-studio/integration') return { hermes: { execution_plane: 'official_runs', worker_plane: 'PluginContext.subagent_lifecycle' } };
  if (url === '/api/plugins/hermes-worker-studio/hermes/unattended/probe') {
    unattendedProbeCount += 1;
    assert.equal(body.confirm, 'RUN_SAFE_UNATTENDED_PROBE');
    return { status: 'UNATTENDED_READY', marker_verified: true, run_id: 'probe-full-access' };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/model-probe') return { ok: true, status: 'completed' };
  if (url === '/api/skills') return { skills: [] };

  throw new Error(`Unhandled fetchJSON call: ${method} ${url}`);
}

let Registered = null;
window.__HERMES_PLUGIN_SDK__ = {
  sdkVersion: '1', React,
  hooks: { useState: React.useState, useEffect: React.useEffect, useCallback: React.useCallback, useMemo: React.useMemo, useRef: React.useRef, useContext: React.useContext, createContext: React.createContext },
  fetchJSON: async (url, init) => responseFor(url, init),
  authedFetch: async () => { throw new Error('not used'); }, buildWsUrl: async () => '', buildWsAuthParam: async () => ['', ''], api: {}, components: {}, utils: {}, useI18n: () => ({}),
};
window.__HERMES_PLUGINS__ = { register(_name, component) { Registered = component; }, registerSlot() {} };
window.eval(bundle);
assert.ok(Registered);
const root = createRoot(window.document.getElementById('root'));
await act(async () => { root.render(React.createElement(Registered)); });

async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check, label, timeout = 4000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    await act(async () => { await sleep(20); });
    try { last = check(); if (last) return last; } catch (error) { last = error; }
  }
  throw new Error(`waitFor ${label} timed out${last instanceof Error ? `: ${last.message}` : ''}`);
}
function byText(selector, text) { return [...window.document.querySelectorAll(selector)].find((el) => el.textContent.includes(text)); }
async function click(el) { assert.ok(el, 'element to click must exist'); await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); }
function setValue(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function labeledInput(labelText) {
  const label = [...window.document.querySelectorAll('.hws3-form-grid label')].find((el) => el.textContent.includes(labelText));
  assert.ok(label, `missing label ${labelText}`);
  return label.querySelector('input');
}

await waitFor(() => byText('.hws3-nav button', '完全访问'), 'navigation');

// Full Access is a true two-way Hermes config state transition with restoration.
await click(byText('.hws3-nav button', '完全访问'));
await waitFor(() => window.document.querySelector('.hws3-switch'), 'Full Access switch');
await click(window.document.querySelector('.hws3-switch'));
await waitFor(() => unattendedProbeCount === 1 && config.approvals.mode === 'off', 'Full Access enable');
assert.equal(config.approvals.mcp_reload_confirm, false);
assert.equal(config.approvals.destructive_slash_confirm, false);
assert.equal(config.delegation.subagent_auto_approve, true);
const restore = config.plugins.entries['hermes-worker-studio'].settings.unattended_restore;
assert.equal(restore.approvals.mode, 'smart');
assert.equal(restore.approvals.mcp_reload_confirm, true);
assert.equal(restore.subagent_auto_approve, false);
await waitFor(() => window.document.querySelector('.hws3-switch[aria-pressed="true"]'), 'Full Access UI on');
await click(window.document.querySelector('.hws3-switch[aria-pressed="true"]'));
await waitFor(() => config.approvals.mode === 'smart' && config.delegation.subagent_auto_approve === false, 'Full Access restore');
assert.equal(config.approvals.mcp_reload_confirm, true);
assert.equal(config.approvals.destructive_slash_confirm, true);
assert.equal(config.plugins.entries['hermes-worker-studio'].settings.unattended_restore, null);

// Custom Endpoint lifecycle is Product 3 UI over the official Hermes endpoints.
await click(byText('.hws3-nav button', '模型'));
await waitFor(() => byText('.hws3-endpoint', 'Local API'), 'endpoint list');
assert.equal(window.document.querySelector('.hws3-moa-panel'), null, 'MOA must not be embedded in Models');

// MOA has its own sidebar surface and uses the same official model inventory.
await click(byText('.hws3-nav button', 'MOA'));
await waitFor(() => window.document.querySelector('.hws3-moa-page'), 'independent MOA page');
assert.ok(byText('.hws3-moa-page', '选择参与模型'));
const moaProviderSelects = [...window.document.querySelectorAll('.hws3-moa-slot-grid select')].filter((_, index) => index % 2 === 0);
const moaModelSelects = [...window.document.querySelectorAll('.hws3-moa-slot-grid select')].filter((_, index) => index % 2 === 1);
assert.equal(moaProviderSelects.length, 2);
assert.equal(moaModelSelects.length, 2);
setValue(moaProviderSelects[0], 'local-api');
await waitFor(() => moaModelSelects[0].value === 'found-model', 'MOA model list follows selected provider');
await click(byText('.hws3-moa-actions button', '保存官方 MoA 配置'));
await waitFor(() => calls.some((call) => call.url === '/api/model/moa' && call.method === 'PUT'), 'official MoA config save');
await click(byText('.hws3-nav button', '模型'));
await waitFor(() => byText('.hws3-endpoint', 'Local API'), 'return to Models');
await click(byText('.hws3-endpoint button', '使用'));
await waitFor(() => activatedEndpoint === 'local-api', 'endpoint activation');
assert.ok(calls.some((call) => call.url === '/api/providers/custom-endpoints/local-api/activate' && call.method === 'POST'));

// Edit the existing endpoint, paste a full Responses endpoint URL, test, and save.
await click(byText('.hws3-endpoint .main', 'Local API'));
await waitFor(() => labeledInput('Base URL').value.includes('127.0.0.1'), 'edit form hydration');
setValue(labeledInput('Name'), 'Local API Edited');
setValue(labeledInput('Base URL'), 'https://proxy.example/v1/responses');
setValue(labeledInput('Model'), 'found-model');
assert.equal(window.document.querySelector('.hws3-form-grid select'), null, 'API mode must not be a misleading provider-global selector');
await click(byText('.hws3-actions button', '测试'));
await waitFor(() => byText('.hws3-result', '连接成功'), 'endpoint validation');
const validation = calls.findLast((call) => call.url === '/api/providers/custom-endpoints/validate');
assert.equal(validation.body.base_url, 'https://proxy.example/v1');
await click(byText('.hws3-actions button', '保存'));
await waitFor(() => savedEndpointPayload?.name === 'Local API Edited', 'endpoint save');
assert.equal(savedEndpointPayload.id, 'local-api');
assert.equal(savedEndpointPayload.base_url, 'https://proxy.example/v1');
assert.equal(savedEndpointPayload.model, 'found-model');
assert.ok(!calls.some((call) => call.url === '/api/config' && call.method === 'PUT' && call.body?.providers?.['local-api']?.api_mode), 'saving an endpoint must not overwrite a provider-global protocol mode');

await waitFor(() => byText('.hws3-endpoint', 'Local API Edited'), 'saved endpoint render');
await click(byText('.hws3-endpoint button', '删除'));
await waitFor(() => deletedEndpoint === 'local-api', 'endpoint delete');
assert.ok(!byText('.hws3-endpoint', 'Local API Edited'));

console.log(`Product 3 Full Access + model CRUD integration passed (${calls.length} official-surface calls).`);
