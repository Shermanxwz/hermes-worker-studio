import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'dashboard/dist/gateway-native.js'), 'utf8');
const sent = [];
const appendedScripts = [];

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
    let result = {};
    if (frame.method === 'session.resume') result = { session_id: 'runtime-1', resumed: frame.params.session_id };
    else if (frame.method === 'session.usage') result = { model: 'model-x', context_used: 32400, context_max: 128000, context_percent: 25.3125, compressions: 2 };
    else if (frame.method === 'session.context_breakdown') result = { context_used: 32400, context_max: 128000, context_percent: 25.3125, threshold_tokens: 96000, threshold_percent: 75, categories: [{ label: 'Conversation', tokens: 22000 }] };
    else if (frame.method === 'image.attach_bytes') result = { attached: true, count: 1 };
    else if (frame.method === 'prompt.submit') result = { status: 'streaming' };
    else if (frame.method === 'session.steer') result = { status: 'queued' };
    else if (frame.method === 'session.interrupt') result = { ok: true };
    else if (frame.method === 'approval.respond') result = { ok: true };
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) }));
  }
  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
  gatewayEvent(type, payload = {}, session_id = 'runtime-1') {
    this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, payload, session_id } }) });
  }
}

globalThis.WebSocket = FakeWebSocket;
const originalCalls = [];
const SDK = {
  fetchJSON: async (path, init) => {
    originalCalls.push({ path, init });
    return { passthrough: true };
  },
  buildWsUrl: async (path) => {
    assert.equal(path, '/api/ws');
    return 'ws://hermes.local/api/ws?ticket=official';
  },
};
const currentScript = { src: 'https://hermes.local/api/plugins/hermes-worker-studio/dist/gateway-native.js' };
globalThis.window = { __HERMES_PLUGIN_SDK__: SDK };
globalThis.document = {
  currentScript,
  scripts: [currentScript],
  createElement: (tag) => ({ tag, async: true, src: '', onerror: null }),
  head: { appendChild: (node) => appendedScripts.push(node) },
};

vm.runInThisContext(source, { filename: 'gateway-native.js' });
assert.equal(appendedScripts.length, 1);
assert.match(appendedScripts[0].src, /\/dist\/index-v3\.js$/);
assert.equal(window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__.protocol, 'tui_gateway_jsonrpc_websocket');

const run = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: 'stored-1',
    input: [{ role: 'user', content: [
      { type: 'text', text: '完成三步任务' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ] }],
  }),
});
assert.equal(run.status, 'running');
assert.equal(run.session_id, 'stored-1');
assert.equal(run.source, 'hermes_gateway_jsonrpc');
assert.deepEqual(sent.slice(0, 4).map((x) => x.method), ['session.resume', 'image.attach_bytes', 'session.usage', 'prompt.submit']);
assert.equal(sent.find((x) => x.method === 'prompt.submit').params.text, '完成三步任务');
assert.equal(sent.find((x) => x.method === 'image.attach_bytes').params.session_id, 'runtime-1');

const ws = FakeWebSocket.instances[0];
ws.gatewayEvent('todo.updated', { revision: 1, todos: [
  { id: 'a', content: '第一步', status: 'completed' },
  { id: 'b', content: '第二步', status: 'in_progress' },
  { id: 'c', content: '第三步', status: 'pending' },
] });
ws.gatewayEvent('status.update', { kind: 'compacting', text: 'Compacting context' });
ws.gatewayEvent('message.delta', { text: '正在处理' });
ws.gatewayEvent('status.update', { kind: 'compacted', text: 'Context compacted' });
await new Promise((resolve) => setTimeout(resolve, 0));
ws.gatewayEvent('message.complete', { text: '完成' });
await new Promise((resolve) => setTimeout(resolve, 0));

const polled = await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${encodeURIComponent(run.id)}?after=0`);
assert.equal(polled.status, 'completed');
assert.ok(polled.events.some((e) => e.event === 'todo.updated'));
assert.ok(polled.events.some((e) => e.event === 'context.compaction' && e.data.kind === 'compacting'));
assert.ok(polled.events.some((e) => e.event === 'context.compaction' && e.data.kind === 'compacted'));
assert.ok(polled.events.some((e) => e.event === 'context.snapshot' && e.data.context_used === 32400));
assert.ok(polled.events.some((e) => e.event === 'assistant.delta' && e.data.text === '正在处理'));
assert.ok(polled.events.some((e) => e.event === 'run.completed'));

const context = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/sessions/stored-1/context');
assert.equal(context.available, true);
assert.equal(context.context_used, 32400);
assert.equal(context.context_max, 128000);
assert.equal(context.threshold_tokens, 96000);
assert.equal(context.compression_count, 2);
assert.ok(sent.some((x) => x.method === 'session.context_breakdown'));

const run2 = await SDK.fetchJSON('/api/plugins/hermes-worker-studio/hermes/runs-v3', {
  method: 'POST',
  body: JSON.stringify({ session_id: 'stored-1', input: '继续' }),
});
ws.gatewayEvent('approval.request', { request_id: 'approval-1', choices: ['once', 'deny'] });
await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}/approval`, { method: 'POST', body: JSON.stringify({ choice: 'once' }) });
assert.equal(sent.at(-1).method, 'approval.respond');
assert.equal(sent.at(-1).params.request_id, 'approval-1');
await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}/steer`, { method: 'POST', body: JSON.stringify({ input: '调整方向' }) });
assert.equal(sent.at(-1).method, 'session.steer');
await SDK.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/runs/${run2.id}/stop`, { method: 'POST', body: '{}' });
assert.equal(sent.at(-1).method, 'session.interrupt');

const passthrough = await SDK.fetchJSON('/api/config');
assert.deepEqual(passthrough, { passthrough: true });
assert.equal(originalCalls.length, 1);

console.log('Gateway-native Studio runtime contract passed.');
