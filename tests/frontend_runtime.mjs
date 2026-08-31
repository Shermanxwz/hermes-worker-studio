import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const bundle = await fs.readFile(path.join(rootDir, 'dashboard/dist/index.js'), 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:7999/sessions',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
globalThis.HTMLSelectElement = window.HTMLSelectElement;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.__HERMES_BASE_PATH__ = '';
const { createRoot } = await import('react-dom/client');

const calls = [];
let runPoll = 0;
let endpointSaved = null;
let modelProbePayload = null;
let unattendedProbeCalled = false;
let approvalPayload = null;
let steerPayload = null;
let stopCalled = false;
let skillsRead = 0;

const sessions = Array.from({ length: 10 }, (_, i) => ({
  id: `session-${i + 1}`,
  title: `Conversation ${i + 1}`,
  model: 'main-model',
  message_count: i === 0 ? 250 : 4,
  last_active: 1788138000 - i,
  archived: false,
}));

let config = {
  plugins: { entries: { 'hermes-worker-studio': { settings: { mode: 'AUTO' } } } },
  approvals: { timeout: 300 },
  delegation: {},
  auxiliary: { review: { provider: 'auto', model: '' } },
  unrelated: { keep: true },
};

const modelOptions = {
  provider: 'official',
  model: 'main-model',
  providers: [
    {
      slug: 'official',
      name: 'Official',
      authenticated: true,
      is_current: true,
      models: ['main-model', 'worker-model'],
      capabilities: {
        'main-model': { reasoning: true },
        'worker-model': { reasoning: true, reasoning_efforts: ['balanced', 'deep'] },
      },
    },
    {
      slug: 'custom:new-api',
      name: 'New API',
      authenticated: true,
      is_user_defined: true,
      api_url: 'https://new.example/v1',
      models: ['new-model'],
      capabilities: { 'new-model': { reasoning: true } },
    },
  ],
};

function parseBody(init) {
  return init?.body ? JSON.parse(init.body) : null;
}

function responseFor(url, init = {}) {
  const method = init.method || 'GET';
  const body = parseBody(init);
  calls.push({ url, method, body });

  if (url === '/api/sessions?limit=10&offset=0&order=recent&archived=exclude') return { sessions, total: 123 };
  if (url === '/api/sessions?limit=20&offset=0&order=recent&archived=exclude') return { sessions: sessions.slice(0, 2), total: 45 };
  if (url === '/api/sessions?limit=20&offset=0&order=recent&archived=only') return { sessions: [{ id: 'archived-1', title: 'Archived Conversation', archived: true, message_count: 2 }], total: 1 };
  if (url.startsWith('/api/sessions/search?q=needle&limit=50')) return { results: [{ session_id: 'session-77', title: 'Needle Hit', snippet: '...needle...', message_count: 1 }] };
  if (url.startsWith('/api/sessions/session-1/messages?limit=40&order=latest')) {
    return { messages: [
      { id: 'm1', role: 'user', content: 'old user message' },
      { id: 'm2', role: 'assistant', content: runPoll >= 2 ? 'final persisted answer' : 'old assistant message' },
    ] };
  }
  if (url.startsWith('/api/sessions/session-1/messages?limit=100&offset=0&order=oldest')) return { messages: [{ id: 'h1', role: 'user', content: 'history page 1' }] };
  if (url.startsWith('/api/sessions/session-1/messages?limit=100&offset=100&order=oldest')) return { messages: [{ id: 'h101', role: 'assistant', content: 'history page 2' }] };
  if (url.startsWith('/api/sessions/session-77/messages?')) return { messages: [] };
  if (url.startsWith('/api/sessions/archived-1/messages?')) return { messages: [] };
  if (url.startsWith('/api/sessions/') && method === 'PATCH') return { ok: true };

  if (url === '/api/config') {
    if (method === 'PUT') {
      config = body.config;
      return { ok: true };
    }
    return { config };
  }
  if (url === '/api/model/options' || url === '/api/model/options?refresh=1') return modelOptions;
  if (url === '/api/skills') {
    skillsRead += 1;
    return runPoll >= 2
      ? { skills: [{ name: 'base-skill', enabled: true }, { name: 'learned-after-run', enabled: true }] }
      : { skills: [{ name: 'base-skill', enabled: true }] };
  }

  if (url === '/api/providers/custom-endpoints') {
    if (method === 'GET') return { endpoints: [] };
    endpointSaved = body;
    return { ok: true, id: 'endpoint-1' };
  }
  if (url === '/api/providers/custom-endpoints/validate') return { ok: true, reachable: true, models: ['new-model'] };

  if (url === '/api/plugins/hermes-worker-studio/health') return { ok: true, hermes: { ok: true }, execution: 'Hermes native Runs + subagent lifecycle' };
  if (url === '/api/plugins/hermes-worker-studio/integration') return { hermes: { execution_plane: 'official_runs', worker_plane: 'PluginContext.subagent_lifecycle', model_catalog: '/api/model/options' } };
  if (url === '/api/plugins/hermes-worker-studio/hermes/sessions/session-1/model') return { ok: true, locked: body };
  if (url === '/api/plugins/hermes-worker-studio/hermes/model-probe') {
    modelProbePayload = body;
    return { ok: true, status: 'completed', run_id: 'probe-model-1', provider: body.provider, model: body.model, output: 'HERMES_WORKER_STUDIO_MODEL_OK' };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/unattended/probe') {
    unattendedProbeCalled = true;
    assert.equal(body.confirm, 'RUN_SAFE_UNATTENDED_PROBE');
    return { ok: true, status: 'UNATTENDED_READY', run_id: 'probe-unattended-1', marker_verified: true };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs') return { id: 'run-1', session_id: 'session-1', status: 'running', started_at: 1000 };
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/runs/run-1?after=')) {
    runPoll += 1;
    if (runPoll === 1) {
      return {
        id: 'run-1', session_id: 'session-1', status: 'running', started_at: 1000, elapsed_ms: 1200, last_seq: 5,
        events: [
          { seq: 1, event: 'run.started', data: {}, at: 1000 },
          { seq: 2, event: 'assistant.delta', data: { delta: 'live text' }, at: 1000.1 },
          { seq: 3, event: 'todo.updated', data: { revision: 1, todos: [{ title: 'verify' }] }, at: 1000.2 },
          { seq: 4, event: 'tool.started', data: { tool_name: 'terminal', arguments: 'pwd' }, at: 1000.3 },
          { seq: 5, event: 'approval.required', data: { choices: ['once', 'deny'], command: 'mock approval' }, at: 1000.4 },
        ],
      };
    }
    return {
      id: 'run-1', session_id: 'session-1', status: 'completed', started_at: 1000, ended_at: 1002.4, elapsed_ms: 2400, last_seq: 7,
      events: [
        { seq: 6, event: 'tool.completed', data: { tool_name: 'terminal', result: '/tmp' }, at: 1002.2 },
        { seq: 7, event: 'run.completed', data: { final_response: 'done' }, at: 1002.4 },
      ],
    };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs/run-1/approval') {
    approvalPayload = body;
    return { ok: true, resolved: 1 };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs/run-1/steer') {
    steerPayload = body;
    return { accepted: true };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs/run-1/stop') {
    stopCalled = true;
    return { status: 'stopping' };
  }
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/sessions')) return { id: 'session-new' };

  throw new Error(`Unhandled fetchJSON call: ${method} ${url}`);
}

let Registered = null;
window.__HERMES_PLUGIN_SDK__ = {
  sdkVersion: '1',
  React,
  hooks: {
    useState: React.useState,
    useEffect: React.useEffect,
    useCallback: React.useCallback,
    useMemo: React.useMemo,
    useRef: React.useRef,
    useContext: React.useContext,
    createContext: React.createContext,
  },
  fetchJSON: async (url, init) => responseFor(url, init),
  authedFetch: async () => { throw new Error('not used'); },
  buildWsUrl: async () => '',
  buildWsAuthParam: async () => ['', ''],
  api: {},
  components: {},
  utils: { cn: (...xs) => xs.filter(Boolean).join(' '), timeAgo: () => '', isoTimeAgo: () => '' },
  useI18n: () => ({}),
};
window.__HERMES_PLUGINS__ = {
  register(name, component) {
    assert.equal(name, 'hermes-worker-studio');
    Registered = component;
  },
  registerSlot() {},
};
window.eval(bundle);
assert.ok(Registered, 'bundle must register through official Hermes plugin registry');

const container = window.document.getElementById('root');
const reactRoot = createRoot(container);
await act(async () => { reactRoot.render(React.createElement(Registered)); });

async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check, message, timeout = 3500) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    await act(async () => { await sleep(20); });
    try {
      last = check();
      if (last) return last;
    } catch (error) { last = error; }
  }
  throw new Error(`waitFor timeout: ${message}${last instanceof Error ? ` (${last.message})` : ''}`);
}
function byText(selector, text) {
  return [...window.document.querySelectorAll(selector)].find((el) => el.textContent.includes(text));
}
async function click(el) {
  assert.ok(el, 'element to click must exist');
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
}
function setNativeValue(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : el instanceof window.HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

await waitFor(() => window.document.querySelectorAll('.hws-recents .hws-session-row').length === 10, 'recent ten sessions');
assert.ok(calls.some((x) => x.url === '/api/sessions?limit=10&offset=0&order=recent&archived=exclude'));
assert.ok(calls.some((x) => x.url === '/api/model/options'));
assert.ok(calls.some((x) => x.url === '/api/config'));
for (const label of ['对话', 'Worker', '模型', '无人值守', '完整历史']) assert.ok(byText('.hws-nav button', label));
for (const label of ['技能', '插件', 'MCP']) assert.ok(byText('.hws-native-nav a', label));
assert.equal(byText('.hws-nav button', 'Keys'), undefined);
assert.equal(byText('.hws-nav button', 'Providers'), undefined);

await click(byText('.hws-nav button', '完整历史'));
await waitFor(() => calls.some((x) => x.url === '/api/sessions?limit=20&offset=0&order=recent&archived=exclude'), 'history pagination');
await click(byText('.hws-list-pane .hws-session-row', 'Conversation 1'));
await waitFor(() => calls.some((x) => x.url === '/api/sessions/session-1/messages?limit=100&offset=0&order=oldest'), 'history message pagination');
const searchInput = window.document.querySelector('.hws-list-pane .hws-search-input');
await act(async () => { setNativeValue(searchInput, 'needle'); });
await waitFor(() => calls.some((x) => x.url === '/api/sessions/search?q=needle&limit=50'), 'official FTS search');
assert.ok(byText('.hws-list-pane', 'Needle Hit'));
await act(async () => { setNativeValue(searchInput, ''); });
await click(byText('.hws-mode-tabs button', '已归档'));
await waitFor(() => calls.some((x) => x.url === '/api/sessions?limit=20&offset=0&order=recent&archived=only'), 'archived filter');

await click(byText('.hws-nav button', 'Worker'));
await waitFor(() => byText('.hws-worker-page', 'Hermes Worker'), 'worker page');
assert.ok(byText('.hws-worker-page', 'subagent lifecycle'));
assert.ok(byText('.hws-route-card', '当前对话'));
assert.ok(byText('.hws-route-card', 'Hermes delegation.*'));
assert.ok(byText('.hws-route-card', 'Hermes 官方 /review'));
await click(byText('.hws-mode-tabs button', 'MAIN'));
await waitFor(() => config.plugins.entries['hermes-worker-studio'].settings.mode === 'MAIN', 'MAIN config write');
assert.equal(calls.some((x) => x.url.includes('/worker/')), false, 'browser must not call a Worker sidecar route');

// Worker model supports two exact upstream effort values; Main model has none.
const inheritCheckbox = [...window.document.querySelectorAll('.hws-check input[type="checkbox"]')][0];
await click(inheritCheckbox);
const workerRoute = [...window.document.querySelectorAll('.hws-route-card')].find((x) => x.textContent.includes('Hermes delegation.*'));
const workerSelects = workerRoute.querySelectorAll('select');
await act(async () => { setNativeValue(workerSelects[1], 'worker-model'); });
await waitFor(() => workerRoute.textContent.includes('balanced') && workerRoute.textContent.includes('deep'), 'exact upstream reasoning options');

await click(byText('.hws-nav button', '模型'));
await waitFor(() => byText('.hws-worker-page', '模型 / New API'), 'models page');
assert.ok(byText('.hws-worker-page', '唯一模型目录'));
const endpointInputs = [...window.document.querySelectorAll('.hws-provider-grid input')];
const baseInput = endpointInputs.find((x) => x.placeholder.includes('example.com'));
const keyInput = endpointInputs.find((x) => x.type === 'password');
await act(async () => {
  setNativeValue(baseInput, 'https://new.example/v1');
  setNativeValue(keyInput, 'secret-new-api-key');
});
await click(byText('.hws-provider-panel button', '验证并保存'));
await waitFor(() => endpointSaved !== null, 'custom endpoint save');
assert.equal(endpointSaved.base_url, 'https://new.example/v1');
assert.ok(calls.some((x) => x.url === '/api/providers/custom-endpoints/validate' && x.method === 'POST'));
assert.ok(calls.some((x) => x.url === '/api/model/options?refresh=1'));
await click([...window.document.querySelectorAll('.hws-model-test button')][0]);
await waitFor(() => modelProbePayload !== null, 'real model run probe');
assert.ok(modelProbePayload.model);
assert.ok(byText('.hws-model-test', '真实 Run 通过'));

await click(byText('.hws-nav button', '无人值守'));
await waitFor(() => byText('.hws-worker-page', '授权与无人值守'), 'unattended page');
assert.ok(byText('.hws-official-panel', 'Hardline 边界永久保留'));
await click(byText('.hws-unattended button', '应用并实测无人值守'));
await waitFor(() => unattendedProbeCalled, 'unattended native Run probe');
assert.equal(config.approvals.mode, 'off');
assert.equal(config.approvals.cron_mode, 'approve');
assert.equal(config.approvals.single_query_mode, 'approve');
assert.equal(config.approvals.unattended_mode, 'approve');
assert.equal(config.approvals.mcp_reload_confirm, false);
assert.equal(config.approvals.destructive_slash_confirm, false);
assert.equal(config.delegation.subagent_auto_approve, true);
assert.equal(config.unrelated.keep, true);
await waitFor(() => byText('.hws-result', '无人值守闭环通过'), 'unattended success rendering');

await click(byText('.hws-nav button', '对话'));
await click(byText('.hws-recents .hws-session-row', 'Conversation 1'));
const textarea = await waitFor(() => window.document.querySelector('.hws-composer textarea'), 'composer');
await act(async () => { setNativeValue(textarea, 'run integration task'); });
await click(byText('.hws-composer button', '发送'));
await waitFor(() => calls.some((x) => x.url === '/api/plugins/hermes-worker-studio/hermes/runs'), 'native Run start');
await waitFor(() => byText('.hws-work-body', 'Hermes 计划更新'), 'real todo lifecycle projection');
const approvalOnce = await waitFor(() => byText('.hws-approval-actions button', 'once'), 'approval choice');
await click(approvalOnce);
await waitFor(() => approvalPayload !== null, 'approval forwarding');
assert.equal(approvalPayload.choice, 'once');
const controls = await waitFor(() => window.document.querySelector('.hws-run-controls'), 'run controls');
const steerInput = controls.querySelector('input');
await act(async () => { setNativeValue(steerInput, 'focus on verified evidence'); });
await click(byText('.hws-run-controls button', 'Steer'));
await waitFor(() => steerPayload !== null, 'steer forwarding');
assert.equal(steerPayload.input, 'focus on verified evidence');
await click(byText('.hws-run-controls button', '停止 Run'));
await waitFor(() => stopCalled, 'stop forwarding');
await waitFor(() => byText('.hws-work-head', '工作过程 · 已完成'), 'completed timeline', 4500);
assert.equal(window.document.querySelector('.hws-work-body'), null, 'completed timeline auto-collapses');
assert.ok(byText('.hws-work-head', '2秒'));
await click(window.document.querySelector('.hws-work-head'));
await waitFor(() => byText('.hws-work-body', 'Hermes Skills 变化'), 'skills diff after native Run');
assert.ok(byText('.hws-work-body', 'learned-after-run'));
assert.ok(skillsRead >= 2);

assert.equal(calls.some((x) => x.url.includes(':8788')), false);
assert.equal(calls.some((x) => x.url.includes('codex')), false);

await act(async () => { reactRoot.unmount(); });
dom.window.close();
console.log(`frontend runtime integration passed (${calls.length} official-surface calls)`);
