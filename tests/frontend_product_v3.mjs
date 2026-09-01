import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [manifestRaw, gateway, js, css, sealedCss, bridge, installer] = await Promise.all([
  fs.readFile(path.join(root, 'dashboard/manifest.json'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/gateway-native.js'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/index-v3.js'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product-sealed.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/plugin_api_v3.py'), 'utf8'),
  fs.readFile(path.join(root, 'scripts/install.sh'), 'utf8'),
]);
const manifest = JSON.parse(manifestRaw);

assert.equal(manifest.version, '3.0.0');
assert.equal(manifest.tab.override, '/', 'Studio must own product home, leaving native /sessions reachable');
assert.equal(manifest.entry, 'dist/gateway-native.js');
assert.equal(manifest.css, 'dist/product-sealed.css');
assert.equal(manifest.api, 'plugin_api_v3.py');
assert.deepEqual(manifest.slots, ['header-left']);
assert.ok(sealedCss.includes('@import url("./product.css");'), 'sealed polish must layer on the stable Product 3 base stylesheet');

for (const token of [
  "SDK.buildWsUrl('/api/ws')",
  "'session.resume'",
  "'prompt.submit'",
  "'session.usage'",
  "'session.context_breakdown'",
  "type === 'todo.updated'",
  "type === 'status.update'",
  "kind === 'compacting'",
  "kind === 'compacted'",
  "'image.attach_bytes'",
  "'session.steer'",
  "'session.interrupt'",
  "'approval.respond'",
  "source: 'hermes_gateway_jsonrpc'",
  "transport: 'official_gateway_websocket'",
  "protocol: 'tui_gateway_jsonrpc_websocket'",
  "new URL('index-v3.js', current.src)",
]) assert.ok(gateway.includes(token), `missing Gateway-native product contract token: ${token}`);

assert.ok(!gateway.includes('API_SERVER_KEY'), 'Gateway browser entry must never see Hermes bearer secrets');
assert.ok(!gateway.includes('estimateTokens'), 'Gateway browser entry must not invent context token estimates');
assert.ok(!gateway.includes('tokenizer'), 'Gateway browser entry must not ship a second tokenizer');

for (const token of [
  "registerSlot('hermes-worker-studio', 'header-left'",
  "['/sessions', '原生 Dashboard · 会话']",
  '← Worker Studio',
  "jinit('PATCH', { title:",
  "jinit('PATCH', { archived:",
  "jinit('DELETE')",
  'titleFromPrompt',
  'Date.now().toString(36)',
  'Ctrl/Cmd+V 粘贴图片',
  'onPaste',
  'onDrop',
  "plugin('/hermes/runs-v3'",
  '官方计划',
  '已完成 ${completed} / ${items.length}',
  'hws3-plan-summary',
  'todo',
  '/hermes/runs/',
  '/steer',
  '/stop',
  '/approval',
  'unattended_restore',
  '完全访问',
  '/api/providers/custom-endpoints',
  '/activate',
  '删除',
  'ContextMeter',
  'officialContextTelemetry',
  'context.compaction',
  'context.snapshot',
  '正在压缩上下文',
  '上下文已压缩',
  '不会把累计 billing/input token 当成当前上下文',
]) assert.ok(js.includes(token), `missing v3 product UI contract token: ${token}`);

assert.ok(!js.includes("title: 'New conversation'"), 'fixed duplicate session title must never return');
assert.ok(!js.includes('API_SERVER_KEY'), 'browser UI bundle must never see Hermes bearer secrets');
assert.ok(js.includes("new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'])"));
assert.ok(js.includes('25 * 1024 * 1024'));

for (const token of ['@media(max-width:820px)', 'env(safe-area-inset-bottom)', '.hws3-mobile-scrim', '.hws3-composer', '.hws3-plan-card', '.hws3-return-slot']) {
  assert.ok(css.includes(token), `missing responsive/product base CSS token: ${token}`);
}
for (const token of ['.hws3-context-meter', '.hws3-context-popover', '.hws3-plan-summary', '@keyframes hws3-context-spin', '@media(max-width:540px)', '@media(prefers-reduced-motion:reduce)']) {
  assert.ok(sealedCss.includes(token), `missing sealed context/plan CSS token: ${token}`);
}

for (const token of [
  'raw_input: Any = body.get("input")',
  '"input": raw_input',
  '@router.post("/hermes/runs-v3")',
  '@router.get("/hermes/sessions/{session_id}/context")',
  '_legacy._hermes_proxy',
  'Hermes official /v1/runs',
  'BUILD_CANDIDATE_SHA = "source-tree"',
  '"candidate_sha": BUILD_CANDIDATE_SHA',
  'context_window_tokens',
  'compression_threshold_tokens',
  'tokens_until_compression',
  'cumulative accounting buckets',
]) {
  assert.ok(bridge.includes(token), `missing v3 probe/compat bridge contract token: ${token}`);
}
assert.ok(!bridge.includes('str(body.get("message") or body.get("input")'), 'v3 bridge must preserve structured multimodal input');

assert.ok(installer.includes('dashboard/dist/gateway-native.js'));
assert.ok(installer.includes("const href = baseHref('/favicon.ico');"));
assert.ok(installer.includes('official Hermes Dashboard /favicon.ico'));
assert.ok(installer.includes('Hermes official TUI Gateway JSON-RPC'));
assert.ok(installer.includes('HWS_CANDIDATE_SHA'));
assert.ok(installer.includes('product-sealed.css'));
assert.ok(installer.includes('could not locate the unique Product 3 candidate marker'));
assert.ok(!installer.includes('cp "$ROOT/dashboard/assets/favicon.svg"'));

console.log('Worker Studio 3 product contract passed.');
