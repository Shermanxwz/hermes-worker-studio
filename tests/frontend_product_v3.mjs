import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [manifestRaw, js, css, bridge, installer] = await Promise.all([
  fs.readFile(path.join(root, 'dashboard/manifest.json'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/index-v3.js'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/plugin_api_v3.py'), 'utf8'),
  fs.readFile(path.join(root, 'scripts/install.sh'), 'utf8'),
]);
const manifest = JSON.parse(manifestRaw);

assert.equal(manifest.version, '3.0.0');
assert.equal(manifest.tab.override, '/', 'Studio must own product home, leaving native /sessions reachable');
assert.equal(manifest.entry, 'dist/index-v3.js');
assert.equal(manifest.css, 'dist/product.css');
assert.equal(manifest.api, 'plugin_api_v3.py');
assert.deepEqual(manifest.slots, ['header-left']);

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
]) assert.ok(js.includes(token), `missing v3 product contract token: ${token}`);

assert.ok(!js.includes("title: 'New conversation'"), 'fixed duplicate session title must never return');
assert.ok(!js.includes('API_SERVER_KEY'), 'browser bundle must never see Hermes bearer secrets');
assert.ok(js.includes("new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'])"));
assert.ok(js.includes('25 * 1024 * 1024'));

for (const token of ['@media(max-width:820px)', 'env(safe-area-inset-bottom)', '.hws3-mobile-scrim', '.hws3-composer', '.hws3-plan-card', '.hws3-return-slot']) {
  assert.ok(css.includes(token), `missing responsive/product CSS token: ${token}`);
}

for (const token of ['raw_input: Any = body.get("input")', '"input": raw_input', '@router.post("/hermes/runs-v3")', '_legacy._hermes_proxy', 'Hermes official /v1/runs']) {
  assert.ok(bridge.includes(token), `missing v3 bridge contract token: ${token}`);
}
assert.ok(!bridge.includes('str(body.get("message") or body.get("input")'), 'v3 bridge must preserve structured multimodal input');

// The release installer rewrites only the staged bundle's favicon assignment
// to the official same-origin Hermes Web favicon. No independent brand asset is
// shipped in the installed Product 3 runtime.
assert.ok(installer.includes("const href = baseHref('/favicon.ico');"));
assert.ok(installer.includes('official Hermes Dashboard /favicon.ico'));
assert.ok(!installer.includes('cp "$ROOT/dashboard/assets/favicon.svg"'));

console.log('Worker Studio 3 product contract passed.');
