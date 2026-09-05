import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await fs.readFile(path.join(rootDir, 'dashboard/dist/index-v3.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div><div id="slot"></div></body></html>', {
  url: 'http://127.0.0.1:19119/sessions',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLFormElement', 'File', 'FileReader', 'Event', 'MouseEvent']) {
  globalThis[name] = window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.__HERMES_BASE_PATH__ = '';
// This isolated Product 3 harness does not load the dynamic capability layer;
// mark that optional layer as already settled so the test exercises Product 3
// immediately instead of waiting for a bridge that is intentionally absent.
window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITY_BRIDGE_READY__ = true;
window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE_READY__ = true;
window.requestAnimationFrame = (fn) => { fn(Date.now()); return 1; };
globalThis.requestAnimationFrame = window.requestAnimationFrame;
window.HTMLElement.prototype.scrollTo = function scrollTo({ top = 0 } = {}) { this.scrollTop = top; };
window.alert = (message) => { throw new Error(`unexpected alert: ${message}`); };
window.confirm = () => true;
globalThis.alert = window.alert;
globalThis.confirm = window.confirm;

const { createRoot } = await import('react-dom/client');
const calls = [];
const patches = [];
const deleted = [];
const modelLocks = [];
let runSerial = 0;
const polls = new Map();
let createdTitle = '';
let latestRunBody = null;
let includeToolMessages = false;
let protocolRoutes = [
  { provider: 'official', model: 'main-model', status: 'unresolved', mode: '', requires_probe: true },
  { provider: 'official', model: 'worker-model', status: 'unresolved', mode: '', requires_probe: true },
];
const bulkProbeCalls = [];
let holdModelOptions = false;
const heldModelOptionResolvers = [];
let config = {
  plugins: { entries: { 'hermes-worker-studio': { settings: { mode: 'AUTO' } } } },
  approvals: { mode: 'smart', timeout: 300, cron_mode: 'approve', single_query_mode: 'approve', unattended_mode: 'approve', mcp_reload_confirm: true, destructive_slash_confirm: true },
  delegation: { subagent_auto_approve: false },
  auxiliary: { review: { provider: 'auto', model: '' } },
};
let sessions = [
  { id: 'session-1', title: 'Conversation One', model: 'main-model', message_count: 3, last_active: 1788138000, archived: false },
  { id: 'session-2', title: 'Conversation Two', model: 'worker-model', message_count: 1, last_active: 1788137000, archived: false },
];

const modelOptions = {
  provider: 'official',
  model: 'main-model',
  providers: [
    {
      slug: 'official', name: 'Official', authenticated: true, is_current: true,
      models: ['main-model', 'worker-model'],
      capabilities: { 'main-model': { reasoning_efforts: ['balanced', 'deep'], can_disable_reasoning: true, context_window: 128000 }, 'worker-model': { reasoning: true } },
    },
    { slug: 'moa', name: 'Mixture of Agents', authenticated: true, models: ['default'] },
  ],
};
const moaConfig = {
  default_preset: 'default', active_preset: '',
  presets: { default: {
    reference_models: [{ provider: 'official', model: 'main-model', enabled: true }],
    aggregator: { provider: 'official', model: 'main-model' },
  } },
};

function parseBody(init) { return init?.body ? JSON.parse(init.body) : null; }
function responseFor(url, init = {}) {
  const method = init.method || 'GET';
  const body = parseBody(init);
  calls.push({ url, method, body });

  if (url === '/api/plugins/hermes-worker-studio/hermes/recent-sessions?limit=10') return {
    sessions: [...sessions, { id: 'session-moa', title: 'MOA Session', provider: 'moa', model: 'default', archived: false, last_active: 1788139500 }],
    total: sessions.length + 1,
  };
  if (url === '/api/plugins/hermes-worker-studio/hermes/moa-sessions') return {
    sessions: [{ id: 'session-moa', title: 'MOA Session', provider: 'moa', model: 'default', studio_moa: { provider: 'moa', preset: 'default' }, last_active: 1788139500 }],
    total: 1,
  };
  if (url === '/api/sessions?limit=10&offset=0&order=recent&archived=exclude') return { sessions: sessions.filter((s) => !s.archived), total: sessions.filter((s) => !s.archived).length };
  if (url.startsWith('/api/sessions/search?')) return { results: [{ ...(sessions.find((s) => s.id === 'session-1') || { id: 'session-1', title: 'Conversation One' }), session_id: 'session-1', role: 'user', snippet: 'needle appears in the complete Hermes history' }] };
  if (url === '/api/sessions/session-1/messages?limit=10&offset=0&order=latest') return { messages: includeToolMessages
    ? [
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm-tool-call-1', role: 'assistant', content: '', tool_calls: [
        { id: 'call-1', function: { name: 'execute_code', arguments: 'probe-a' } },
        { id: 'call-2', function: { name: 'execute_code', arguments: 'probe-b' } },
      ] },
      { id: 'm-tool-result-1', role: 'tool', tool_name: 'execute_code', content: 'result-a' },
      { id: 'm-tool-result-2', role: 'tool', tool_name: 'execute_code', content: 'result-b' },
      { id: 'm-tool-call-2', role: 'assistant', content: '', tool_calls: [{ id: 'call-3', function: { name: 'execute_code', arguments: 'probe-c' } }] },
      { id: 'm-tool-result-3', role: 'tool', tool_name: 'execute_code', content: 'result-c' },
      { id: 'm2', role: 'assistant', content: 'hi' },
    ]
    : [{ id: 'm1', role: 'user', content: 'hello' }, { id: 'm2', role: 'assistant', content: 'hi' }] };
  if (url === '/api/sessions/session-new/messages?limit=10&offset=0&order=latest') return { messages: [{ id: 'nm1', role: 'assistant', content: 'persisted final' }] };
  if (url.startsWith('/api/sessions/') && method === 'PATCH') {
    const id = decodeURIComponent(url.split('/')[3]);
    patches.push({ id, body });
    sessions = sessions.map((s) => s.id === id ? { ...s, ...body } : s);
    return { ok: true };
  }
  if (url.startsWith('/api/sessions/') && method === 'DELETE') {
    const id = decodeURIComponent(url.split('/')[3]);
    deleted.push(id);
    sessions = sessions.filter((s) => s.id !== id);
    return { ok: true };
  }
  if (url.startsWith('/api/sessions?limit=30')) return { sessions, total: sessions.length };
  if (url.startsWith('/api/sessions/session-1/messages?limit=100&offset=0&order=oldest')) return { total: 1, messages: [{ id: 'h1', role: 'user', content: 'needle appears in the complete Hermes history' }] };
  if (url.startsWith('/api/sessions/') && url.includes('/messages?limit=100')) return { total: 0, messages: [] };

  if (url === '/api/config') {
    if (method === 'PUT') { config = body.config; return { ok: true }; }
    return { config };
  }
  if (url === '/api/model/options' || url === '/api/model/options?refresh=1') {
    if (holdModelOptions) return new Promise((resolve) => heldModelOptionResolvers.push(() => resolve(modelOptions)));
    return modelOptions;
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/protocols') return { routes: protocolRoutes };
  if (url === '/api/plugins/hermes-worker-studio/hermes/protocols/probe' && method === 'POST') {
    bulkProbeCalls.push(body);
    protocolRoutes = protocolRoutes.map((route) => route.provider === body.provider && route.model === body.model
      ? { ...route, status: 'resolved', mode: 'codex_responses', requires_probe: false }
      : route);
    return { ok: true, status: 'resolved', route: { provider: body.provider, model: body.model, status: 'resolved', mode: 'codex_responses' } };
  }
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/protocol-route?')) {
    const query = new URL(`http://hws.test${url}`).searchParams;
    return { provider: query.get('provider'), model: query.get('model'), execution_provider: query.get('provider'), requires_probe: false, status: 'native' };
  }
  if (url === '/api/model/moa' && method === 'GET') return moaConfig;
  if (url === '/api/skills') return { skills: [{ name: 'base', enabled: true }] };
  if (url === '/api/providers/custom-endpoints') return { endpoints: [] };

  if (url === '/api/plugins/hermes-worker-studio/health') return { ok: true, hermes: { ok: true } };
  if (url === '/api/plugins/hermes-worker-studio/hermes/sessions') {
    createdTitle = body.title;
    const created = { id: 'session-new', title: body.title, model: 'main-model', archived: false, last_active: 1788139000 };
    if (!sessions.some((s) => s.id === created.id)) sessions = [created, ...sessions];
    return created;
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/sessions/session-new/context' || url === '/api/plugins/hermes-worker-studio/hermes/sessions/session-1/context') return { available: false, source: 'unavailable' };
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/sessions/') && url.endsWith('/model')) {
    const id = decodeURIComponent(url.split('/hermes/sessions/')[1].split('/model')[0]);
    modelLocks.push({ id, body });
    sessions = sessions.map((session) => session.id === id ? { ...session, model: body.model } : session);
    return { ok: true };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs-v3') {
    runSerial += 1;
    const id = `run-${runSerial}`;
    polls.set(id, 0);
    latestRunBody = body;
    return { id, session_id: body.session_id, status: 'running', started_at: 1000 + runSerial };
  }
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/runs/run-') && url.includes('?after=')) {
    const id = url.split('/hermes/runs/')[1].split('?')[0];
    const count = (polls.get(id) || 0) + 1;
    polls.set(id, count);
    if (id === 'run-2') {
      if (count === 1) return {
        id, session_id: 'session-new', status: 'running', started_at: 1002, elapsed_ms: 200, last_seq: 2,
        events: [
          { seq: 1, event: 'run.started', data: {}, at: 1002 },
          { seq: 2, event: 'assistant.delta', data: { delta: 'live ' }, at: 1002.2 },
        ],
      };
      return {
        id, session_id: 'session-new', status: 'completed', started_at: 1002, ended_at: 1003, elapsed_ms: 1000, last_seq: 4, output: 'done',
        events: [
          { seq: 3, event: 'message.complete', data: {}, at: 1002.8 },
          { seq: 4, event: 'run.completed', data: {}, at: 1003 },
        ],
      };
    }
    if (count === 1) return {
      id, session_id: id === 'run-1' ? 'session-new' : 'session-1', status: 'running', started_at: 1000, elapsed_ms: 500, last_seq: 4,
      events: [
        { seq: 1, event: 'run.started', data: {}, at: 1000 },
        { seq: 2, event: 'todo.updated', data: { revision: 1, todos: [{ id: '1', content: 'Inspect', status: 'completed' }, { id: '2', content: 'Finish', status: 'in_progress' }] }, at: 1000.1 },
        { seq: 3, event: 'message.delta', data: { delta: 'live ' }, at: 1000.2 },
        { seq: 4, event: 'tool.started', data: { tool: 'terminal', preview: 'pwd' }, at: 1000.3 },
      ],
    };
    return { id, session_id: id === 'run-1' ? 'session-new' : 'session-1', status: 'completed', started_at: 1000, ended_at: 1001, elapsed_ms: 1000, last_seq: 5, output: 'done', events: [{ seq: 5, event: 'run.completed', data: {}, at: 1001 }] };
  }
  if (url.endsWith('/steer')) return { accepted: true };
  if (url.endsWith('/stop')) return { status: 'stopping' };
  if (url.endsWith('/approval')) return { ok: true };

  throw new Error(`Unhandled fetchJSON call: ${method} ${url}`);
}

let Registered = null;
let Slot = null;
window.__HERMES_PLUGIN_SDK__ = {
  sdkVersion: '1', React,
  hooks: { useState: React.useState, useEffect: React.useEffect, useCallback: React.useCallback, useMemo: React.useMemo, useRef: React.useRef, useContext: React.useContext, createContext: React.createContext },
  fetchJSON: async (url, init) => responseFor(url, init),
  authedFetch: async () => { throw new Error('not used'); },
  buildWsUrl: async () => '', buildWsAuthParam: async () => ['', ''], api: {}, components: {}, utils: {}, useI18n: () => ({}),
};
window.__HERMES_PLUGINS__ = {
  register(name, component) { assert.equal(name, 'hermes-worker-studio'); Registered = component; },
  registerSlot(name, slot, component) { assert.equal(name, 'hermes-worker-studio'); assert.equal(slot, 'header-left'); Slot = component; },
};
window.eval(bundle);
assert.ok(Registered, 'Product 3 bundle must register through official registry');
assert.ok(Slot, 'Product 3 must register official header-left return slot');

const root = createRoot(window.document.getElementById('root'));
await act(async () => { root.render(React.createElement(Registered)); });
const slotRoot = createRoot(window.document.getElementById('slot'));
await act(async () => { slotRoot.render(React.createElement(Slot)); });

async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check, label, timeout = 4000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    await act(async () => { await sleep(20); });
    try { last = check(); if (last) return last; } catch (err) { last = err; }
  }
  throw new Error(`waitFor ${label} timed out${last instanceof Error ? `: ${last.message}` : ''}`);
}
function byText(selector, text) { return [...window.document.querySelectorAll(selector)].find((el) => el.textContent.includes(text)); }
async function click(el) { assert.ok(el, 'element must exist'); await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); }
function setValue(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

await waitFor(() => window.document.querySelectorAll('.hws3-recents .hws3-session-row').length === 2, 'initial recents');
assert.equal([...window.document.querySelectorAll('.hws3-recents .hws3-session-row')].some((el) => el.textContent.includes('MOA Session')), false, 'MOA sessions must stay out of ordinary recents');
for (const label of ['对话', 'Worker', '模型', 'MOA', '完全访问', '完整历史']) assert.ok(byText('.hws3-nav button', label), `missing nav ${label}`);
const nativeDashboardLink = byText('.hws3-native-dashboard-link', '高级 · Hermes Dashboard');
assert.ok(nativeDashboardLink);
assert.equal(nativeDashboardLink.getAttribute('href'), '/sessions');
assert.equal(window.document.querySelector('.hws3-advanced'), null);
assert.equal(window.document.title, 'Hermes Worker Studio');
assert.ok(window.document.querySelector('link[data-hws-favicon]'));
assert.ok(window.document.querySelector('.hws3-brand img[src*="project-mark.png"]'));
assert.equal(window.document.getElementById('slot').textContent.trim(), '← Worker Studio');

// MOA is an independent sidebar surface, not a duplicate section in Models.
await click(byText('.hws3-nav button', 'MOA'));
await waitFor(() => window.document.querySelector('.hws3-moa-page'), 'independent MOA page');
assert.ok(byText('.hws3-moa-page', '选择参与模型'));
await waitFor(() => byText('.hws3-moa-session-list', 'MOA Session'), 'MOA session list');
assert.ok(window.document.querySelectorAll('.hws3-moa-slot-grid select').length >= 4);
await click(byText('.hws3-nav button', '模型'));
await waitFor(() => window.document.querySelector('.hws3-model-catalog'), 'models page without MOA panel');
assert.equal(window.document.querySelector('.hws3-moa-page'), null);
assert.equal(window.document.querySelector('.hws3-moa-panel'), null);
assert.ok(byText('.hws3-page-head button', '一键测试待测模型（2）'));
assert.ok([...window.document.querySelectorAll('.hws3-model-actions > button')].every((button) => button.textContent.trim() === '测试'), 'per-model test actions must use one consistent label');
assert.match(byText('.hws3-model-row', 'worker-model').textContent, /思考：支持 · 强度：未公开/);
const sessionCreateCallsBeforeBulkTest = calls.filter((x) => x.url === '/api/plugins/hermes-worker-studio/hermes/sessions').length;
await click(byText('.hws3-page-head button', '一键测试待测模型（2）'));
await waitFor(() => bulkProbeCalls.length === 2, 'bulk protocol probe calls');
await waitFor(() => byText('.hws3-page', '批量测试完成'), 'bulk protocol probe completion');
assert.equal(calls.filter((x) => x.url === '/api/plugins/hermes-worker-studio/hermes/sessions').length, sessionCreateCallsBeforeBulkTest, 'model tests must not create conversation sessions');
assert.ok(bulkProbeCalls.every((call) => call.provider === 'official' && ['main-model', 'worker-model'].includes(call.model)));

// Reopening a session restores its official persisted model instead of the
// first model in the current provider list. A deliberate dropdown switch is
// persisted through the same official protocol-resolution + model-lock path.
await click(byText('.hws3-nav button', '对话'));
await click([...window.document.querySelectorAll('.hws3-session-row')].find((el) => el.textContent.includes('Conversation Two')));
await waitFor(() => byText('.hws3-chat-title', 'Conversation Two'), 'open model-pinned session');
const routeSelects = window.document.querySelectorAll('.hws3-route-compact select');
assert.equal(routeSelects[1].value, 'worker-model', 'opening a session must restore its persisted model');
const lockCountBeforeManualSwitch = modelLocks.length;
setValue(routeSelects[1], 'main-model');
await waitFor(() => modelLocks.length > lockCountBeforeManualSwitch, 'manual session model lock');
assert.deepEqual(modelLocks.at(-1), { id: 'session-2', body: { provider: 'official', model: 'main-model', require_model_lock: true } });

// A browser refresh destroys Studio's React state. Re-mount the product and
// reopen the same official Session to prove the persisted model lock, rather
// than the in-memory dropdown value, is what wins over the first model.
root.unmount();
holdModelOptions = true;
const refreshedRoot = createRoot(window.document.getElementById('root'));
await act(async () => { refreshedRoot.render(React.createElement(Registered)); });
await waitFor(() => window.document.querySelectorAll('.hws3-recents .hws3-session-row').length === 2, 'refreshed recents');
await click([...window.document.querySelectorAll('.hws3-session-row')].find((el) => el.textContent.includes('Conversation Two')));
await waitFor(() => byText('.hws3-chat-title', 'Conversation Two'), 'reopen after refresh');
holdModelOptions = false;
heldModelOptionResolvers.splice(0).forEach((release) => release());
await waitFor(() => window.document.querySelectorAll('.hws3-route-compact select')[1]?.value === 'main-model', 'late model inventory restore');
assert.equal(window.document.querySelectorAll('.hws3-route-compact select')[1].value, 'main-model', 'refresh must keep the manually selected model');

// Mobile drawer state is real React state, not a CSS-only mock.
await click(window.document.querySelector('.hws3-mobile-bar button[title="菜单"]'));
assert.ok(window.document.querySelector('.hws3-mobile-scrim'));
await click(window.document.querySelector('.hws3-mobile-scrim'));
await waitFor(() => !window.document.querySelector('.hws3-mobile-scrim'), 'mobile drawer close');

// New conversation remains client-only until first send. Hermes, not the
// browser, owns the title so the first prompt can never collide with a
// globally unique title from another session.
await click(byText('.hws3-sidebar button', '新对话'));
const createCallsBefore = calls.filter((x) => x.url.endsWith('/hermes/sessions')).length;
assert.equal(createCallsBefore, 0);
const composer = window.document.querySelector('.hws3-composer textarea');
const reasoningSwitch = window.document.querySelector('.hws3-route-compact .hws3-reasoning-switch input');
const reasoningSlider = window.document.querySelector('.hws3-route-compact .hws3-reasoning-slider');
assert.ok(reasoningSwitch, 'a model that explicitly allows disabling reasoning must expose a switch');
assert.ok(reasoningSlider, 'a model with declared efforts must expose a slider');
setValue(reasoningSlider, '2');
setValue(composer, 'Build a seal test');
await act(async () => { window.document.querySelector('.hws3-composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
await waitFor(() => latestRunBody?.session_id === 'session-new', 'first Run submission');
assert.equal(createdTitle, undefined, 'session creation must omit a client-generated title');
assert.equal(latestRunBody.input, 'Build a seal test');
assert.deepEqual(latestRunBody.model_options, { reasoning: { enabled: true, effort: 'deep' } }, 'selected reasoning effort must reach the official Run as nested model_options');
await waitFor(() => byText('.hws3-plan-card', '官方计划'), 'official plan render');
assert.match(window.document.querySelector('.hws3-plan-summary').textContent, /已完成 1 \/ 2/);
assert.equal(window.document.querySelector('.hws3-plan-list'), null, 'official plan starts collapsed');
await click(window.document.querySelector('.hws3-plan-summary'));
assert.ok(byText('.hws3-plan-list', 'Inspect'));
assert.ok(byText('.hws3-plan-list', 'Finish'));
await waitFor(() => polls.get('run-1') >= 2, 'run completion');

// Clipboard image path reaches the v3 structured input transport.
const workCardsBeforeSimpleRun = window.document.querySelectorAll('.hws3-work').length;
const png = new window.File([new Uint8Array([137, 80, 78, 71])], 'paste.png', { type: 'image/png' });
const paste = new window.Event('paste', { bubbles: true, cancelable: true });
Object.defineProperty(paste, 'clipboardData', { value: { files: [png] } });
await act(async () => { composer.dispatchEvent(paste); await sleep(25); });
await waitFor(() => window.document.querySelectorAll('.hws3-attachment-chip').length === 1, 'pasted attachment chip');
setValue(composer, 'Look at this image');
await act(async () => { window.document.querySelector('.hws3-composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
await waitFor(() => runSerial >= 2, 'image Run submission');
assert.ok(Array.isArray(latestRunBody.input));
const parts = latestRunBody.input[0].content;
assert.equal(parts[0].type, 'text');
assert.equal(parts[1].type, 'image_url');
assert.ok(parts[1].image_url.url.startsWith('data:image/png;base64,'));
await waitFor(() => polls.get('run-2') >= 2, 'image run completion');
await act(async () => { await sleep(25); });
assert.equal(window.document.querySelectorAll('.hws3-work').length, workCardsBeforeSimpleRun, 'completed runs without tools, plans, approvals, context compaction or errors must not leave a work card');

// Open an existing session and exercise the complete official Session CRUD surface.
includeToolMessages = true;
await click([...window.document.querySelectorAll('.hws3-session-row')].find((el) => el.textContent.includes('Conversation One')));
await waitFor(() => byText('.hws3-chat-title', 'Conversation One'), 'open existing session');
await waitFor(() => window.document.querySelector('.hws3-tool-activity-compact'), 'compact official tool activity');
assert.equal(window.document.querySelectorAll('.hws3-tool-activity-compact').length, 1, 'one user turn must render one aggregated tool summary');
assert.match(window.document.querySelector('.hws3-tool-activity-compact').textContent, /3 次调用 · 3 个结果/);
assert.equal(window.document.querySelectorAll('.hws3-tool-activity-compact .hws3-tool-card').length, 0, 'conversation tool summary must not repeat raw command/result cards');
assert.match(window.document.querySelector('.hws3-tool-activity-compact').textContent, /原始详情保留在 Hermes 完整历史/);
assert.equal(window.document.querySelector('.hws3-chat-search'), null, 'content search belongs only to Complete History');
await click(byText('.hws3-nav button', '完整历史'));
const historySearch = window.document.querySelector('.hws3-history-search-label input');
setValue(historySearch, 'needle');
await waitFor(() => calls.some((x) => x.url.startsWith('/api/sessions/search?q=needle&limit=100')), 'official message FTS search');
assert.ok(byText('.hws3-history-search-row', '消息命中'));
await click(window.document.querySelector('.hws3-history-search-row .main'));
await waitFor(() => window.document.querySelector('.hws3-history-hit-anchor.is-hit'), 'jump to complete-history message');
assert.ok(window.document.querySelector('.hws3-history-hit-anchor.is-hit mark[data-search-match="true"]'));
await click(byText('.hws3-nav button', '对话'));
await waitFor(() => byText('.hws3-chat-title', 'Conversation One'), 'return to conversation after history search');
await click(window.document.querySelector('.hws3-chat-actions button[title="重命名"]'));
const renameInput = window.document.querySelector('.hws3-modal input');
setValue(renameInput, 'Renamed Product Session');
await click(byText('.hws3-modal button', '保存'));
await waitFor(() => patches.some((x) => x.id === 'session-1' && x.body.title === 'Renamed Product Session'), 'rename PATCH');
await click(window.document.querySelector('.hws3-chat-actions button[title="归档"]'));
await waitFor(() => patches.some((x) => x.id === 'session-1' && x.body.archived === true), 'archive PATCH');
assert.ok(window.document.querySelector('.hws3-chat-actions button[title="取消归档"]'));
await click(window.document.querySelector('.hws3-chat-actions button[title="取消归档"]'));
await waitFor(() => patches.some((x) => x.id === 'session-1' && x.body.archived === false), 'unarchive PATCH');
await click(window.document.querySelector('.hws3-chat-actions button[title="删除"]'));
await click(byText('.hws3-modal button', '删除'));
await waitFor(() => deleted.includes('session-1'), 'DELETE session');

// Scrolling away pauses following and exposes explicit recovery controls.
const transcript = window.document.querySelector('.hws3-transcript');
Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 400 });
transcript.scrollTop = 100;
await act(async () => { transcript.dispatchEvent(new window.Event('scroll', { bubbles: true })); });
assert.ok(byText('.hws3-scroll-tools button', '回到底部'));
assert.ok(byText('.hws3-scroll-tools label', '自动滚动'));

console.log(`Product 3 runtime integration passed (${calls.length} official-surface calls).`);
