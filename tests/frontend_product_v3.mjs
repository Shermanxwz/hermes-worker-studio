import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [manifestRaw, gateway, js, css, sealedCss, bridge, installer, stageBundle] = await Promise.all([
  fs.readFile(path.join(root, 'dashboard/manifest.json'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/gateway-native.js'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/index-v3.js'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product-sealed.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/plugin_api_v3.py'), 'utf8'),
  fs.readFile(path.join(root, 'scripts/install.sh'), 'utf8'),
  fs.readFile(path.join(root, 'scripts/stage_product_bundle.py'), 'utf8'),
]);
const manifest = JSON.parse(manifestRaw);

assert.equal(manifest.version, '3.0.0');
assert.equal(manifest.tab.override, '/', 'Studio must own product home, leaving native /sessions reachable');
assert.equal(manifest.entry, 'dist/gateway-native.js');
assert.equal(manifest.css, 'dist/product-sealed.css');
assert.equal(manifest.api, 'plugin_api_v3.py');
assert.deepEqual(manifest.slots, ['header-left', 'sidebar']);
assert.ok(sealedCss.includes('@import url("./product.css");'), 'sealed polish must layer on the stable Product 3 base stylesheet');

for (const token of [
  "SDK.buildWsUrl('/api/ws')",
  "new StudioGatewayClient(() => SDK.buildWsUrl('/api/ws'))",
  "this.urlFactory()",
  "'session.resume'",
  'close_on_disconnect: false',
  "'prompt.submit'",
  "'session.usage'",
  "'session.context_breakdown'",
  'const SESSION_RECONCILE',
  'const SESSION_ATTACH',
  "'session.events.since'",
  "session_attach: 'session.resume + session.events.since'",
  'gateway_last_seq',
  'transport.replay_gap',
  'hermes.gateway.session.resume_reconciliation',
  "type === 'todo.updated'",
  "type === 'status.update'",
  "kind === 'compacting'",
  "kind === 'compacted'",
  "'image.attach_bytes'",
  "'pdf.attach'",
  "'file.attach'",
  'result?.ref_text',
  "'session.steer'",
  "'session.interrupt'",
  "'approval.respond'",
  "'clarify.respond'",
  "'mcp.setup.respond'",
  "'sudo.respond'",
  "'secret.respond'",
  "'terminal.read.respond'",
  'transport.reconnecting',
  'transport.reconnected',
  "source: 'hermes_gateway_jsonrpc'",
  "transport: 'official_gateway_websocket'",
  "protocol: 'tui_gateway_jsonrpc_websocket'",
  "reconnect: 'session.resume(close_on_disconnect=false)'",
  "attachments: ['image.attach_bytes', 'pdf.attach', 'file.attach']",
  "registerSlot('hermes-worker-studio', 'header-left'",
  "registerSlot('hermes-worker-studio', 'sidebar'",
  "new URL('index-v3.js', current.src)",
]) assert.ok(gateway.includes(token), `missing Gateway-native product contract token: ${token}`);

assert.ok(!gateway.includes('API_SERVER_KEY'), 'Gateway browser entry must never see Hermes bearer secrets');
assert.ok(!gateway.includes('estimateTokens'), 'Gateway browser entry must not invent context token estimates');
assert.ok(!gateway.includes('tokenizer'), 'Gateway browser entry must not ship a second tokenizer');
assert.ok(!gateway.includes('close_on_disconnect: true'), 'browser disconnect must not own Hermes Session lifetime');
assert.ok(!gateway.includes("source: 'hermes.gateway.close_on_disconnect'"), 'disconnect must not be projected as a terminal Hermes Run');

// Source Product 3 remains reviewable; the supported installer applies a
// fail-closed release transform for arbitrary files, the direct native
// Dashboard hand-off and Full Access disclosure.
for (const token of [
  "registerSlot('hermes-worker-studio', 'header-left'",
  "hws3-native-dashboard-link",
  "href: baseHref('/sessions')",
  'inferApiModeFromEndpointInput',
  'modelApiMode',
  'protocol capabilities are read per',
  "plugin('/hermes/slash-complete'",
  "plugin('/hermes/commands'",
  "plugin('/hermes/slash-exec'",
  'slashItems.map',
  'ADVANCED_MARKER',
  'markAdvancedNavigation',
  'clearAdvancedNavigation',
  '/hermes/sessions/${encodeURIComponent(id)}/projection',
  '/hermes/moa-sessions',
  'model_config?.provider',
  'browser_model_lock?.provider',
  'expandedTurns',
  'hws3-slash-menu',
  'slashCommandText',
  "display_kind: 'command-result'",
  'hws3-tool-row',
  'hws3-tool-activity',
  'commandBusy',
  'stopPropagation',
  'hws3-moa-session-list',
  '/api/model/moa',
  'Mixture of Agents',
  'locateSearchHit',
  'hws3-history-hit-anchor',
  'highlightText',
  'RECENT_LIMIT = 10',
  'CHAT_MESSAGE_LIMIT = 10',
  '消息全文 FTS',
  '← Worker Studio',
  "jinit('PATCH', { title:",
  "jinit('PATCH', { archived:",
  "jinit('DELETE')",
  'titleFromPrompt',
  'GENERATED_TITLE_SUFFIX',
  'Ctrl/Cmd+V 粘贴文件',
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
  'mapTurnRunsToMessages',
  'reconcileProjectedTurns',
  'projectedTurnIsActive',
  'officialAssistantForProjectedTurn',
  'projectedTurnNeedsReconciliation',
  'hasStaleIncompleteReconciliation',
  'mergeProjectedRunEvents',
  'attachProjectedRun',
  'pollAttachedRun',
  'pollProjectedRecovery',
  'session-attach',
  'cancelRunPoll',
  'unique nearest response',
  'official timestamp only when it is the unique nearest response in a',
  'Load the official messages before exposing the recovered projection',
  'official_message_timestamp',
  'messagesLoading',
  '官方未提供时长',
  'hermes_message_id',
  'hermes_output_exact',
  'hermes_timestamp',
  'system-sync',
  'context.compaction',
  'context.snapshot',
  'Auto Compact 进行中',
  'Compact 完成，正在恢复实时上下文',
  '不会把累计 billing/input token 当成当前上下文',
]) assert.ok(js.includes(token), `missing v3 product UI source contract token: ${token}`);

for (const token of [
  'MAX_ATTACHMENT_BYTES',
  "title: '添加文件'",
  'Ctrl/Cmd+V 粘贴文件',
  "type: 'file_url'",
  "kind: item.kind || 'file'",
]) assert.ok(stageBundle.includes(token), `missing installed Product 3 release transform token: ${token}`);
assert.ok(!stageBundle.includes('HERMES_PRIMARY'), 'the installer must not maintain a copied Hermes navigation list');
assert.ok(!stageBundle.includes("['/sessions', 'Hermes 会话', '☷']"), 'native Sessions must not return to the visible Studio product rail');
assert.ok(!stageBundle.includes("['/cron', '自动化', '◷']"), 'native Automation must not return to the visible Studio product rail');

assert.ok(!js.includes("title: 'New conversation'"), 'fixed duplicate session title must never return');
assert.ok(!js.includes('API_SERVER_KEY'), 'browser UI bundle must never see Hermes bearer secrets');
assert.ok(js.includes("new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'])"));
assert.ok(js.includes('25 * 1024 * 1024'));

for (const token of ['@media(max-width:820px)', 'env(safe-area-inset-bottom)', '.hws3-mobile-scrim', '.hws3-composer', '.hws3-plan-card', '.hws3-return-slot', '.hws3-message.user{grid-template-columns']) {
  assert.ok(css.includes(token), `missing responsive/product base CSS token: ${token}`);
}
for (const token of ['.hws3-context-meter', '.hws3-context-popover', '.hws3-plan-summary', '.hws3-file-icon', '.hws3-history-hit-anchor', '.hws3-moa-page', '.hws3-moa-flow', '.hws3-moa-source-note', '@keyframes hws3-context-spin', '@media(max-width:540px)', '@media(prefers-reduced-motion:reduce)']) {
  assert.ok(sealedCss.includes(token), `missing sealed context/plan/attachment CSS token: ${token}`);
}
for (const token of ['html:has(.hws3-root) #app-sidebar', 'html:has(.hws3-root) #app-sidebar+div>header', '#root>[data-layout-variant]>header']) {
  assert.ok(sealedCss.includes(token), `missing scoped official host-shell compatibility token: ${token}`);
}

for (const token of [
  'raw_input: Any = body.get("input")',
  '"input": raw_input',
  '@router.post("/hermes/runs-v3")',
  '@router.get("/hermes/sessions/{session_id}/context")',
  '@router.get("/hermes/sessions/{session_id}/projection")',
  '@router.put("/hermes/sessions/{session_id}/projection")',
  '@router.get("/hermes/moa-sessions")',
  '_write_projection',
  'os.replace(temporary, path)',
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
assert.ok(installer.includes('dashboard/dist/project-mark.png'));
assert.ok(installer.includes('project mark via Hermes official plugin static assets'));
assert.ok(installer.includes('Hermes official TUI Gateway JSON-RPC'));
assert.ok(installer.includes('scripts/stage_product_bundle.py'));
assert.ok(installer.includes('arbitrary attachments'));
assert.ok(installer.includes('WebSocket reconnects resume durable Hermes Sessions'));
assert.ok(installer.includes('HWS_CANDIDATE_SHA'));
assert.ok(installer.includes('product-sealed.css'));
assert.ok(installer.includes('could not locate the unique Product 3 candidate marker'));
assert.ok(!installer.includes('cp "$ROOT/dashboard/assets/favicon.svg"'));

console.log('Worker Studio 3 product contract passed.');
