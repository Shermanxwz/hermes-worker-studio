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
      result = {
        session_id: runtime,
        message_count: frame.params.omit_messages === false ? 7 : 4,
        running: frame.params.omit_messages === false,
        inflight: frame.params.omit_messages === false,
        todo_state: frame.params.omit_messages === false ? { revision: 2, todos: [] } : undefined,
      };
    } else if (frame.method === 'session.usage') {
      result = { model: 'model-x', context_used: 32400, context_max: 128000, context_percent: 25.3125, compressions: 2 };
    } else if (frame.method === 'session.context_breakdown') {
      result = { context_used: 32400, context_max: 128000, context_percent: 25.3125, threshold_tokens: 96000, threshold_percent: 75, categories: [{ label: 'Conversation', tokens: 22000 }] };
    } else if (frame.method === 'file.attach') {
      result = { attached: true, ref_text: '@file:attachments/readme.txt' };
    } else if (frame.method === 'image.attach_bytes' || frame.method === 'pdf.attach') {
      result = { attached: true, count: 1 };
    } else if (frame.method === 'prompt.submit') {
      result = { status: 'streaming' };
    } else if (frame.method === 'session.steer') {
      result = { status: 'queued' };
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
  }),
});
assert.equal(run.status, 'running');
assert.equal(run.session_id, 'stored-1');
assert.equal(run.source, 'hermes_gateway_jsonrpc');
assert.deepEqual(sent.slice(0, 6).map((x) => x.method), [
  'session.resume',
  'image.attach_bytes',
  'pdf.attach',
  'file.attach',
  'session.usage',
  'prompt.submit',
]);
const firstResume = sent.find((x) => x.method === 'session.resume');
assert.equal(firstResume.params.close_on_disconnect, false);
assert.equal(firstResume.params.omit_messages, true);
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

const ws2 = FakeWebSocket.instances[1];
ws2.gatewayEvent('message.complete', { text: '完成' });
await new Promise((resolve) => setTimeout(resolve, 10));
polled = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${encodeURIComponent(run.id)}?after=0`);
assert.equal(polled.status, 'completed');
assert.ok(polled.events.some((e) => e.event === 'run.completed'));

const run2 = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', {
  method: 'POST',
  body: JSON.stringify({ session_id: 'stored-1', input: '控制测试' }),
});
await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}/steer`, { method: 'POST', body: JSON.stringify({ input: '调整方向' }) });
assert.equal(sent.at(-1).method, 'session.steer');
await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}/stop`, { method: 'POST', body: '{}' });
assert.equal(sent.at(-1).method, 'session.interrupt');
const stopped = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}?after=0`);
assert.equal(stopped.status, 'interrupted');

const passthrough = await SDK.fetchJSON('/api/not-studio');
assert.deepEqual(passthrough, { passthrough: true });
assert.ok(originalCalls.some((x) => x.path === '/api/config'), 'Full Access auto-input handling must read Hermes config');
assert.ok(originalCalls.some((x) => x.path === '/api/not-studio'), 'non-Studio routes must still pass through');

console.log('Gateway-native Studio runtime contract passed.');
