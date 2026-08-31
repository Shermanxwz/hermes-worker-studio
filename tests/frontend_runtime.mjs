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
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.alert = () => {};
window.__HERMES_BASE_PATH__ = '';

// ReactDOM feature detection must see the jsdom document. Importing it before
// installing the DOM globals makes React fall back to its legacy IE input
// polyfill (attachEvent), which is not representative of a modern browser.
const { createRoot } = await import('react-dom/client');

const calls = [];
let runPoll = 0;
let providerSaved = false;
let configWritten = null;
let lastProviderPayload = null;
let lastConnectivityPayload = null;
let lastRoutingPayload = null;
let lastModelLockPayload = null;

const sessions = Array.from({ length: 10 }, (_, i) => ({
  id: `session-${i + 1}`,
  title: `Conversation ${i + 1}`,
  model: 'new-reason',
  message_count: i === 0 ? 250 : 4,
  last_active: 1788138000 - i,
  archived: false,
}));

const workerState = {
  mode: 'AUTO',
  provider: { baseUrl: 'https://new.example/v1', protocol: 'auto' },
  routing: {
    AUTO: {
      main: { provider: 'third_party', model: 'new-reason', effort: 'balanced' },
      worker: { provider: 'third_party', model: 'new-no-effort', effort: 'auto' },
      verifier: { provider: 'official', model: 'official-model', effort: 'auto' },
    },
  },
};

const catalog = {
  registry: {
    mainPolicy: { providerLocked: false },
    providers: {
      official: {
        models: [{ id: 'official-model', displayName: 'Official Model' }],
      },
      third_party: {
        models: [
          {
            id: 'new-reason',
            displayName: 'New Reason',
            reasoning: {
              options: [
                { value: 'balanced', description: 'balanced upstream' },
                { value: 'deep', description: 'deep upstream' },
              ],
            },
          },
          { id: 'new-no-effort', displayName: 'No Effort Model' },
        ],
      },
    },
  },
  runtime: { effectiveRouting: workerState.routing.AUTO },
};

function responseFor(url, init = {}) {
  calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });

  if (url === '/api/sessions?limit=10&offset=0&order=recent&archived=exclude') {
    return { sessions, total: 123 };
  }
  if (url.startsWith('/api/sessions/session-1/messages?limit=40&order=latest')) {
    return {
      messages: [
        { id: 'm1', role: 'user', content: 'old user message' },
        { id: 'm2', role: 'assistant', content: runPoll >= 2 ? 'final persisted answer' : 'old assistant message' },
      ],
    };
  }
  if (url === '/api/sessions?limit=20&offset=0&order=recent&archived=exclude') {
    return { sessions: sessions.slice(0, 2), total: 45 };
  }
  if (url === '/api/sessions?limit=20&offset=20&order=recent&archived=exclude') {
    return { sessions: [{ id: 'session-21', title: 'Conversation 21', message_count: 1 }], total: 45 };
  }
  if (url === '/api/sessions?limit=20&offset=0&order=recent&archived=only') {
    return { sessions: [{ id: 'archived-1', title: 'Archived Conversation', archived: true, message_count: 2 }], total: 1 };
  }
  if (url.startsWith('/api/sessions/search?q=needle&limit=50')) {
    return { results: [{ session_id: 'session-77', title: 'Needle Hit', snippet: '...needle...' }] };
  }
  if (url.startsWith('/api/sessions/session-1/messages?limit=100&offset=0&order=oldest')) {
    return { messages: [{ id: 'h1', role: 'user', content: 'history page 1' }] };
  }
  if (url.startsWith('/api/sessions/session-1/messages?limit=100&offset=100&order=oldest')) {
    return { messages: [{ id: 'h101', role: 'assistant', content: 'history page 2' }] };
  }
  if (url === '/api/plugins/hermes-worker-studio/worker/state') return workerState;
  if (url === '/api/plugins/hermes-worker-studio/worker/catalog') return catalog;
  if (url === '/api/plugins/hermes-worker-studio/health') return { ok: true, hermes: { ok: true }, worker: { ok: true } };
  if (url === '/api/plugins/hermes-worker-studio/worker/provider' && init.method === 'PUT') {
    providerSaved = true;
    lastProviderPayload = JSON.parse(init.body);
    return { ok: true };
  }
  if (url === '/api/plugins/hermes-worker-studio/worker/provider/probe') return { ok: true, protocol: 'responses', status: 200 };
  if (url === '/api/plugins/hermes-worker-studio/worker/provider/connectivity') {
    lastConnectivityPayload = JSON.parse(init.body);
    return { results: [{ model: lastConnectivityPayload.models[0], ok: true, latencyMs: 12 }] };
  }
  if (url === '/api/plugins/hermes-worker-studio/worker/mode') return { ok: true };
  if (url === '/api/plugins/hermes-worker-studio/worker/routing') {
    lastRoutingPayload = JSON.parse(init.body);
    return { ok: true };
  }
  if (url === '/api/providers/custom-endpoints') {
    if (init.method === 'POST') return { ok: true, id: 'endpoint-1' };
    return { endpoints: [] };
  }
  if (url === '/api/providers/custom-endpoints/validate') return { ok: true };
  if (url === '/api/config') {
    if (init.method === 'PUT') {
      configWritten = JSON.parse(init.body);
      return { ok: true };
    }
    return { config: { approvals: { timeout: 300 }, unrelated: { keep: true } } };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/sessions/session-1/model') {
    lastModelLockPayload = JSON.parse(init.body);
    return { ok: true };
  }
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs') {
    return { id: 'studio-run-1', session_id: 'session-1', status: 'running', started_at: 1000 };
  }
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/runs/studio-run-1?after=')) {
    runPoll += 1;
    if (runPoll === 1) {
      return {
        id: 'studio-run-1',
        session_id: 'session-1',
        status: 'running',
        started_at: 1000,
        elapsed_ms: 1200,
        last_seq: 4,
        events: [
          { seq: 1, event: 'run.started', data: {}, at: 1000 },
          { seq: 2, event: 'assistant.delta', data: { delta: 'live text' }, at: 1000.1 },
          { seq: 3, event: 'tool.started', data: { tool_name: 'worker_delegate', arguments: '{}' }, at: 1000.2 },
          { seq: 4, event: 'tool.completed', data: { tool_name: 'worker_delegate', result: { task_id: 'task-runtime-1' } }, at: 1000.3 },
        ],
      };
    }
    return {
      id: 'studio-run-1',
      session_id: 'session-1',
      status: 'completed',
      started_at: 1000,
      ended_at: 1002.4,
      elapsed_ms: 2400,
      last_seq: 5,
      events: [{ seq: 5, event: 'run.completed', data: { final_response: 'done' }, at: 1002.4 }],
    };
  }
  if (url === '/api/plugins/hermes-worker-studio/worker/status/task-runtime-1') {
    return { task_id: 'task-runtime-1', status: 'completed', output: 'verified' };
  }
  if (url.startsWith('/api/model/options')) {
    return {
      providers: [
        {
          slug: 'custom:worker-studio-new-api',
          aliases: ['custom:worker-studio-new-api'],
          is_user_defined: true,
          authenticated: true,
          api_url: 'https://new.example/v1',
          models: ['new-reason', 'new-no-effort'],
        },
      ],
    };
  }
  if (url.startsWith('/api/sessions/session-77/messages?')) return { messages: [] };
  if (url.startsWith('/api/sessions/archived-1/messages?')) return { messages: [] };
  if (url.startsWith('/api/sessions/session-21/messages?')) return { messages: [] };
  if (url.startsWith('/api/sessions/') && init.method === 'PATCH') return { ok: true };

  throw new Error(`Unhandled fetchJSON call: ${init.method || 'GET'} ${url}`);
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
assert.ok(Registered, 'bundle must register through the official Hermes plugin registry');

const container = window.document.getElementById('root');
const reactRoot = createRoot(container);
await act(async () => {
  reactRoot.render(React.createElement(Registered));
});

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, message, timeout = 3000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    await act(async () => { await sleep(20); });
    try {
      last = check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`waitFor timeout: ${message}${last instanceof Error ? ` (${last.message})` : ''}`);
}

function byText(selector, text) {
  return [...window.document.querySelectorAll(selector)].find((el) => el.textContent.includes(text));
}

async function click(el) {
  assert.ok(el, 'element to click must exist');
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function setNativeValue(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

await waitFor(
  () => window.document.querySelectorAll('.hws-session-row').length === 10,
  'initial recent rail should render ten sessions',
);
assert.ok(calls.some((x) => x.url === '/api/sessions?limit=10&offset=0&order=recent&archived=exclude'));
assert.ok(calls.some((x) => x.url === '/api/sessions/session-1/messages?limit=40&order=latest'));
assert.equal(window.document.querySelectorAll('.hws-session-row').length, 10);
assert.ok(byText('a', 'Skills'));
assert.ok(byText('a', 'Plugins'));
assert.ok(byText('a', 'MCP'));

await click(byText('button', '完整历史对话'));
await waitFor(() => calls.some((x) => x.url === '/api/sessions?limit=20&offset=0&order=recent&archived=exclude'), 'history page request');
assert.ok(byText('.hws-section-head', '20 个会话/页'));
await click(byText('.hws-list-pane .hws-session-row', 'Conversation 1'));
await waitFor(() => calls.some((x) => x.url === '/api/sessions/session-1/messages?limit=100&offset=0&order=oldest'), 'history transcript page 1');
assert.ok(byText('.hws-detail-pane', '250 条消息'));
const detailNext = [...window.document.querySelectorAll('.hws-detail-pane .hws-pagination button')].find((x) => x.textContent.includes('下一页'));
await click(detailNext);
await waitFor(() => calls.some((x) => x.url === '/api/sessions/session-1/messages?limit=100&offset=100&order=oldest'), 'history transcript page 2');

await click(byText('.hws-nav button', '已归档对话'));
await waitFor(() => calls.some((x) => x.url === '/api/sessions?limit=20&offset=0&order=recent&archived=only'), 'archive filter');
assert.ok(byText('.hws-session-row', 'Archived Conversation'));

await click(byText('.hws-nav button', '搜索对话'));
const search = await waitFor(() => window.document.querySelector('.hws-search-input'), 'search input');
await act(async () => { setNativeValue(search, 'needle'); });
await waitFor(() => calls.some((x) => x.url === '/api/sessions/search?q=needle&limit=50'), 'FTS search request');
assert.ok(byText('.hws-search-result', 'Needle Hit'));

await click(byText('.hws-nav button', 'Worker 路由'));
await waitFor(() => byText('.hws-worker-page', 'Hermes 派工系统'), 'worker page');
assert.ok(byText('.hws-worker-page', 'auto'));
assert.ok(byText('.hws-worker-page', 'balanced'));
assert.ok(byText('.hws-worker-page', 'deep'));
const noEffortCard = [...window.document.querySelectorAll('.hws-route-card')].find((el) => el.textContent.includes('No Effort Model'));
assert.ok(noEffortCard);
const noEffortRange = noEffortCard.querySelector('input[type="range"]');
assert.equal(noEffortRange.disabled, true, 'model without upstream efforts must be Auto-only');
assert.ok(noEffortCard.textContent.includes('上游未声明思考强度'));

const providerInputs = window.document.querySelectorAll('.hws-provider-grid input');
assert.equal(providerInputs.length, 2);
await act(async () => {
  setNativeValue(providerInputs[0], 'https://new.example/v1');
  setNativeValue(providerInputs[1], 'secret-new-api-key');
});
await click(byText('.hws-provider-panel button', '保存并刷新模型'));
await waitFor(() => providerSaved, 'provider save');
assert.equal(lastProviderPayload.baseUrl, 'https://new.example/v1');
assert.equal(lastProviderPayload.apiKey, 'secret-new-api-key');
await waitFor(() => providerInputs[1].value === '', 'API key input clear after save');
assert.ok(calls.some((x) => x.url === '/api/providers/custom-endpoints/validate' && x.method === 'POST'));
assert.ok(calls.some((x) => x.url === '/api/providers/custom-endpoints' && x.method === 'POST'));

const modelTestButton = [...window.document.querySelectorAll('.hws-model-test button')][0];
await click(modelTestButton);
await waitFor(() => lastConnectivityPayload !== null, 'real connectivity route invocation');
assert.deepEqual(lastConnectivityPayload.models, ['new-reason']);
await waitFor(() => byText('.hws-model-test', '通过'), 'connectivity result rendering');

await click(byText('.hws-unattended button', '应用官方无人值守配置'));
await waitFor(() => configWritten !== null, 'unattended config write');
assert.equal(configWritten.config.approvals.mode, 'off');
assert.equal(configWritten.config.approvals.cron_mode, 'approve');
assert.equal(configWritten.config.approvals.single_query_mode, 'approve');
assert.equal(configWritten.config.approvals.unattended_mode, 'approve');
assert.equal(configWritten.config.approvals.mcp_reload_confirm, false);
assert.equal(configWritten.config.approvals.destructive_slash_confirm, false);
assert.equal(configWritten.config.approvals.timeout, 300);
assert.equal(configWritten.config.unrelated.keep, true);

await click(byText('.hws-nav button', '新建 / 当前对话'));
await click(byText('.hws-session-row', 'Conversation 1'));
const textarea = await waitFor(() => window.document.querySelector('.hws-composer textarea'), 'composer');
await act(async () => { setNativeValue(textarea, 'run an integration task'); });
await click(byText('.hws-composer button', '发送'));
await waitFor(() => calls.some((x) => x.url === '/api/plugins/hermes-worker-studio/hermes/runs'), 'run start');
await waitFor(() => calls.some((x) => x.url === '/api/plugins/hermes-worker-studio/worker/status/task-runtime-1'), 'worker task polling');
await waitFor(() => byText('.hws-work-head', '工作过程 · 已完成'), 'completed work timeline', 4000);
const work = window.document.querySelector('.hws-work');
assert.ok(work.classList.contains('done'));
assert.ok(work.textContent.includes('2秒'));
assert.equal(window.document.querySelector('.hws-work-body'), null, 'completed work details must auto-collapse');
assert.ok(calls.some((x) => x.url === '/api/sessions/session-1/messages?limit=40&order=latest'), 'final transcript reload');
assert.ok(lastModelLockPayload, 'chat route should resolve and apply an official Hermes session model lock');
assert.equal(lastModelLockPayload.model, 'new-reason');
assert.equal(lastModelLockPayload.require_model_lock, true);

await click(window.document.querySelector('.hws-work-head'));
await waitFor(() => window.document.querySelector('.hws-work-body'), 'manual timeline expansion');
assert.ok(byText('.hws-work-body', '执行工具 · worker_delegate'));
assert.ok(byText('.hws-work-body', '工具完成 · worker_delegate'));

assert.equal(lastRoutingPayload, null, 'viewing/sending must not invent a routing write unless user changes routing');

await act(async () => {
  reactRoot.unmount();
});
dom.window.close();

console.log(`frontend runtime integration passed (${calls.length} mocked official-surface calls)`);
