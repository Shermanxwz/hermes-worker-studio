import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'dashboard/dist/gateway-native.js'), 'utf8');
const sent = [];
const appendedScripts = [];
const slotCalls = [];
const originalCalls = [];
let wsUrlCalls = 0;

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    });
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  emit(type, value) {
    for (const fn of this.listeners.get(type) || []) fn(value);
  }
  send(raw) {
    const frame = JSON.parse(raw);
    sent.push(frame);
    const socketIndex = FakeWebSocket.instances.indexOf(this) + 1;
    const runtime = `runtime-${socketIndex}`;
    let result = {};
    if (frame.method === 'session.resume') {
      // An idle resume is deliberately not a terminal signal. The reconnect
      // regression below uses stored-1 to prove the native bridge keeps the
      // run attached until an official message.complete or message row wins.
      const active = frame.params.session_id === 'active-1';
      result = {
        session_id: runtime,
        message_count: frame.params.omit_messages === false ? 7 : 4,
        running: active,
        inflight: active,
        todo_state: active ? { revision: 2, todos: [] } : undefined,
      };
    } else if (frame.method === 'session.usage') {
      result = { model: 'model-x', context_used: 32400, context_max: 128000, context_percent: 25.3125, compressions: 2 };
    } else if (frame.method === 'session.context_breakdown') {
      result = { context_used: 32400, context_max: 128000, context_percent: 25.3125, threshold_tokens: 96000, threshold_percent: 75, categories: [{ label: 'Conversation', tokens: 22000 }] };
    } else if (frame.method === 'session.events.since') {
      result = {
        events: frame.params.session_id === 'runtime-2' ? [
          { type: 'message.start', session_id: 'runtime-2', seq: 11, payload: { turn_started_at: 1700000000 } },
          { type: 'message.delta', session_id: 'runtime-2', seq: 12, payload: { text: '刷新后继续接收' } },
        ] : [],
        latest_seq: frame.params.session_id === 'runtime-2' ? 12 : 0,
        truncated: false,
        count: frame.params.session_id === 'runtime-2' ? 2 : 0,
        epoch: 'test-epoch-1',
      };
    } else if (frame.method === 'file.attach') {
      result = { attached: true, ref_text: '@file:attachments/readme.txt' };
    } else if (frame.method === 'image.attach_bytes' || frame.method === 'pdf.attach') {
      result = { attached: true, count: 1 };
    } else if (frame.method === 'prompt.submit') {
      result = { status: 'streaming' };
    } else if (frame.method === 'session.steer') {
      result = { status: 'queued' };
    } else if (frame.method === 'commands.catalog') {
      result = { commands: { '/compress': { description: 'Compress context' }, '/compact': { description: 'Compact context' } }, all: [['/compress', 'Compress context'], ['/compact', 'Compact context']] };
    } else if (frame.method === 'complete.slash') {
      result = { items: [{ text: '/compress', display: '/compress', meta: 'Compress context', kind: 'command' }] };
    } else if (frame.method === 'slash.exec') {
      result = { output: 'Hermes slash executed' };
    } else {
      result = { ok: true };
    }
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) }));
  }
  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
  gatewayEvent(type, payload = {}, session_id = null) {
    const socketIndex = FakeWebSocket.instances.indexOf(this) + 1;
    const runtime = session_id || `runtime-${socketIndex}`;
    this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, payload, session_id: runtime } }) });
  }
}

globalThis.WebSocket = FakeWebSocket;
const SDK = {
  React: { createElement: (...args) => ({ args }) },
  fetchJSON: async (path, init) => {
    originalCalls.push({ path, init });
    if (path === '/api/config') {
      return {
        config: {
          approvals: {
            mode: 'off',
            cron_mode: 'approve',
            single_query_mode: 'approve',
            unattended_mode: 'approve',
            mcp_reload_confirm: false,
            destructive_slash_confirm: false,
          },
          delegation: { subagent_auto_approve: true },
        },
      };
    }
    return { passthrough: true };
  },
  buildWsUrl: async (path) => {
    assert.equal(path, '/api/ws');
    wsUrlCalls += 1;
    return `ws://hermes.local/api/ws?ticket=official-${wsUrlCalls}`;
  },
};
const currentScript = { src: 'https://hermes.local/dashboard-plugins/hermes-worker-studio/dist/gateway-native.js' };
globalThis.window = {
  __HERMES_PLUGIN_SDK__: SDK,
  __HERMES_PLUGINS__: { registerSlot: (...args) => slotCalls.push(args) },
  __HERMES_BASE_PATH__: '',
  location: { pathname: '/' },
};
globalThis.document = {
  currentScript,
  scripts: [currentScript],
  createElement: (tag) => ({ tag, async: true, src: '', onerror: null }),
  head: { appendChild: (node) => appendedScripts.push(node) },
};

vm.runInThisContext(source, { filename: 'gateway-native.js' });
assert.equal(appendedScripts.length, 1);
assert.equal(appendedScripts[0].src, 'https://hermes.local/dashboard-plugins/hermes-worker-studio/dist/index-v3.js');
assert.equal(window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__.protocol, 'tui_gateway_jsonrpc_websocket');
assert.equal(window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__.reconnect, 'session.resume(close_on_disconnect=false)');
assert.deepEqual(window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__.attachments, ['image.attach_bytes', 'pdf.attach', 'file.attach']);
assert.ok(window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__.unattended_input.includes('clarify.respond'));
assert.deepEqual(slotCalls.map((x) => x.slice(0, 2)), [
  ['hermes-worker-studio', 'header-left'],
  ['hermes-worker-studio', 'sidebar'],
]);

const run = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: 'stored-1',
    input: [{ role: 'user', content: [
      { type: 'text', text: '处理三个附件' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=', name: 'shot.png', kind: 'image' } },
      { type: 'file_url', file_url: { url: 'data:application/pdf;base64,JVBERi0=', name: 'doc.pdf', kind: 'pdf' } },
      { type: 'file_url', file_url: { url: 'data:text/plain;base64,aGk=', name: 'readme.txt', kind: 'file' } },
    ] }],
    provider: 'source-provider',
    model: 'model-x',
  }),
});
assert.equal(run.status, 'running');
assert.equal(run.session_id, 'stored-1');
assert.equal(run.source, 'hermes_gateway_jsonrpc');
assert.deepEqual(sent.slice(0, 6).map((x) => x.method), [
  'session.resume',
  'config.set',
  'image.attach_bytes',
  'pdf.attach',
  'file.attach',
  'session.usage',
]);
const firstResume = sent.find((x) => x.method === 'session.resume');
assert.equal(firstResume.params.close_on_disconnect, false);
assert.equal(firstResume.params.omit_messages, true);
assert.equal(firstResume.params.eager_build, true, 'a new session must be built before its route is applied');
const firstModelSet = sent.find((x) => x.method === 'config.set' && x.params.key === 'model');
assert.equal(firstModelSet.params.session_id, 'runtime-1');
assert.equal(firstModelSet.params.value, 'model-x --provider source-provider --session');
const prompt = sent.find((x) => x.method === 'prompt.submit');
assert.match(prompt.params.text, /^处理三个附件/);
assert.match(prompt.params.text, /readme\.txt → @file:attachments\/readme\.txt/);
assert.equal(sent.find((x) => x.method === 'image.attach_bytes').params.session_id, 'runtime-1');
assert.equal(sent.find((x) => x.method === 'pdf.attach').params.filename, 'doc.pdf');
assert.equal(sent.find((x) => x.method === 'file.attach').params.name, 'readme.txt');

const ws1 = FakeWebSocket.instances[0];
assert.equal(ws1.url, 'ws://hermes.local/api/ws?ticket=official-1');
ws1.gatewayEvent('todo.updated', { revision: 1, todos: [
  { id: 'a', content: '第一步', status: 'completed' },
  { id: 'b', content: '第二步', status: 'in_progress' },
  { id: 'c', content: '第三步', status: 'pending' },
] });
ws1.gatewayEvent('status.update', { kind: 'compacting', text: 'Compacting context' });
ws1.gatewayEvent('message.delta', { text: '正在处理' });
ws1.gatewayEvent('status.update', { kind: 'compacted', text: 'Context compacted' });
ws1.gatewayEvent('clarify.request', { request_id: 'clarify-1', question: 'Should I continue?' });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(sent.some((x) => x.method === 'clarify.respond' && x.params.request_id === 'clarify-1' && x.params.answer === ''));
let polled = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${encodeURIComponent(run.id)}?after=0`);
assert.equal(polled.status, 'running');
assert.ok(polled.events.some((e) => e.event === 'clarify.auto_skipped'));
assert.ok(polled.events.some((e) => e.event === 'todo.updated'));
assert.ok(polled.events.some((e) => e.event === 'context.compaction' && e.data.kind === 'compacting'));
assert.ok(polled.events.some((e) => e.event === 'assistant.delta' && e.data.text === '正在处理'));

const context = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/sessions/stored-1/context');
assert.equal(context.available, true);
assert.equal(context.context_used, 32400);
assert.equal(context.context_max, 128000);
assert.equal(context.threshold_tokens, 96000);
assert.equal(context.compression_count, 2);
assert.ok(sent.some((x) => x.method === 'session.context_breakdown'));

const reconciliation = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/session-reconcile', {
  method: 'POST',
  body: JSON.stringify({ session_id: 'stored-1' }),
});
assert.equal(reconciliation.active, false, 'session reconciliation must expose the official idle state');
assert.equal(reconciliation.source, 'hermes.gateway.session.resume');
assert.ok(Number.isFinite(reconciliation.checked_at));
assert.ok(sent.filter((x) => x.method === 'session.resume').some((x) => x.params.omit_messages === true));
const activeReconciliation = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/session-reconcile', {
  method: 'POST',
  body: JSON.stringify({ session_id: 'active-1' }),
});
assert.equal(activeReconciliation.active, true, 'session reconciliation must preserve an officially active session');

ws1.close();
polled = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${encodeURIComponent(run.id)}?after=0`);
assert.equal(polled.status, 'reconnecting');
assert.ok(polled.events.some((e) => e.event === 'transport.reconnecting' && e.data.reason === 'gateway_websocket_closed'));
await new Promise((resolve) => setTimeout(resolve, 350));
polled = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${encodeURIComponent(run.id)}?after=0`);
assert.equal(polled.status, 'running');
assert.equal(FakeWebSocket.instances.length, 2);
assert.equal(FakeWebSocket.instances[1].url, 'ws://hermes.local/api/ws?ticket=official-2');
assert.equal(wsUrlCalls, 2, 'each reconnect must mint a fresh Hermes Dashboard WebSocket auth URL');
const resumes = sent.filter((x) => x.method === 'session.resume');
assert.ok(resumes.every((x) => x.params.close_on_disconnect === false));
assert.ok(resumes.some((x) => x.params.omit_messages === false));
assert.ok(polled.events.some((e) => e.event === 'transport.reconnected' && e.data.runtime === 'runtime-2'));
assert.ok(!polled.events.some((e) => e.event === 'run.completed' && e.data?.source === 'hermes.gateway.session.resume_reconciliation'), 'an idle resume must not fabricate run completion');

const ws2 = FakeWebSocket.instances[1];
ws2.gatewayEvent('message.complete', { text: '完成' });
await new Promise((resolve) => setTimeout(resolve, 10));
polled = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${encodeURIComponent(run.id)}?after=0`);
assert.equal(polled.status, 'completed');
assert.ok(polled.events.some((e) => e.event === 'run.completed'));

const attached = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/session-attach', {
  method: 'POST',
  body: JSON.stringify({
    session_id: 'active-1',
    run_id: 'projection-refresh-1',
    started_at: 1699999998,
    last_seq: 4,
    gateway_last_seq: 0,
  }),
});
assert.equal(attached.attached, true, 'a refreshed page must attach to the official live session');
assert.equal(attached.run.id, 'projection-refresh-1');
assert.equal(attached.run.status, 'running');
assert.equal(attached.source, 'hermes.gateway.session.attach');
assert.equal(attached.replay_count, 2, 'refresh attach must replay the official Gateway event ring');
assert.ok(attached.run.events.some((e) => e.event === 'run.message_started' && e.gateway_seq === 11));
assert.ok(attached.run.events.some((e) => e.event === 'assistant.delta' && e.gateway_seq === 12 && e.data.text === '刷新后继续接收'));
assert.ok(sent.some((x) => x.method === 'session.events.since' && x.params.last_seen === 0));
const attachedAgain = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/session-attach', {
  method: 'POST',
  body: JSON.stringify({ session_id: 'active-1', run_id: 'projection-refresh-1', gateway_last_seq: 0 }),
});
assert.equal(attachedAgain.attached, true, 'a second refresh must re-resume an already attached official run');
assert.equal(attachedAgain.run.status, 'running');
assert.ok(sent.filter((x) => x.method === 'session.resume').length >= 4, 'refresh attach must call official session.resume even when the browser run map already has the run');
ws2.gatewayEvent('message.complete', { text: '刷新后完成' }, 'runtime-2');
await new Promise((resolve) => setTimeout(resolve, 10));
const attachedDone = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs/projection-refresh-1?after=4');
assert.equal(attachedDone.status, 'completed');
assert.ok(attachedDone.events.some((e) => e.event === 'run.completed'));

const run2 = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', {
  method: 'POST',
  body: JSON.stringify({ session_id: 'stored-1', input: '控制测试', provider: 'moa', model: 'default' }),
});
assert.ok(sent.some((x) => x.method === 'config.set' && x.params.key === 'model' && x.params.value === 'default --provider moa --session'));
const catalog = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/commands');
assert.ok(catalog.all.some((item) => item[0] === '/compress'), 'official slash catalog must be exposed');
const completion = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/slash-complete', { method: 'POST', body: JSON.stringify({ session_id: 'stored-1', text: '/' }) });
assert.equal(completion.items[0].text, '/compress', 'official slash completion must be exposed');
const slashResult = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/slash-exec', { method: 'POST', body: JSON.stringify({ session_id: 'stored-1', command: '/compress' }) });
assert.equal(slashResult.output, 'Hermes slash executed', 'slash submission must use native slash.exec');
assert.ok(sent.some((x) => x.method === 'slash.exec' && x.params.command === '/compress'));
await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}/steer`, { method: 'POST', body: JSON.stringify({ input: '调整方向' }) });
assert.equal(sent.at(-1).method, 'session.steer');
await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}/stop`, { method: 'POST', body: '{}' });
assert.equal(sent.at(-1).method, 'session.interrupt');
const stopped = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}?after=0`);
assert.equal(stopped.status, 'interrupted');

const run3 = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', {
  method: 'POST',
  body: JSON.stringify({ session_id: 'stored-1', input: '失败可见性测试', provider: 'moa', model: 'default' }),
});
ws2.gatewayEvent('message.complete', { status: 'error', error: 'No LLM provider configured for task=moa_aggregator' });
await new Promise((resolve) => setTimeout(resolve, 10));
const failed = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run3.id}?after=0`);
assert.equal(failed.status, 'failed');
assert.equal(failed.error, 'No LLM provider configured for task=moa_aggregator');
assert.ok(failed.events.some((e) => e.event === 'run.failed'));

const passthrough = await SDK.fetchJSON('/api/not-studio');
assert.deepEqual(passthrough, { passthrough: true });
assert.ok(originalCalls.some((x) => x.path === '/api/config'), 'Full Access auto-input handling must read Hermes config');
assert.ok(originalCalls.some((x) => x.path === '/api/not-studio'), 'non-Studio routes must still pass through');

console.log('Gateway-native Studio runtime contract passed.');
