import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [
  manifestRaw,
  gateway,
  js,
  css,
  sealedCss,
  closureCss,
  bridge,
  installer,
  stageBundle,
  stageMixed,
] = await Promise.all([
  fs.readFile(path.join(root, 'dashboard/manifest.json'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/gateway-native.js'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/index-v3.js'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product-sealed.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/dist/product-closure.css'), 'utf8'),
  fs.readFile(path.join(root, 'dashboard/plugin_api_v3.py'), 'utf8'),
  fs.readFile(path.join(root, 'scripts/install.sh'), 'utf8'),
  fs.readFile(path.join(root, 'scripts/stage_product_bundle.py'), 'utf8'),
  fs.readFile(path.join(root, 'scripts/stage_mixed_protocol.py'), 'utf8'),
]);
const manifest = JSON.parse(manifestRaw);

assert.equal(manifest.version, '3.0.0');
assert.equal(manifest.tab.override, '/', 'Studio must own product home while native /sessions remains reachable');
assert.equal(manifest.tab.path, '/worker-studio');
assert.equal(manifest.entry, 'dist/gateway-native.js');
assert.equal(manifest.css, 'dist/product-closure.css');
assert.equal(manifest.api, 'plugin_api_v3.py');
assert.deepEqual(manifest.slots, ['header-left', 'sidebar']);

assert.ok(sealedCss.includes('@import url("./product.css");'), 'sealed polish must layer over Product 3 base CSS');
assert.ok(closureCss.includes('@import url("./product-sealed.css");'), 'closure CSS must layer over sealed Product 3 CSS');

for (const token of [
  "SDK.buildWsUrl('/api/ws')",
  "new StudioGatewayClient(() => SDK.buildWsUrl('/api/ws'))",
  'this.urlFactory()',
  "'session.resume'",
  'close_on_disconnect: false',
  "'prompt.submit'",
  "'session.usage'",
  "'session.context_breakdown'",
  'const SESSION_RECONCILE',
  'const SESSION_ATTACH',
  "'session.events.since'",
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
]) assert.ok(gateway.includes(token), `missing Gateway-native contract token: ${token}`);

for (const forbidden of ['API_SERVER_KEY', 'estimateTokens', 'tokenizer', 'close_on_disconnect: true', 'new AIAgent']) {
  assert.ok(!gateway.includes(forbidden), `Gateway browser entry reintroduced forbidden behavior: ${forbidden}`);
}

// Checked-in Product 3 source stays reviewable and owns the stable product
// information architecture. Deterministic transforms below produce the exact
// supported install artifact and are separately syntax/runtime tested.
for (const token of [
  "registerSlot('hermes-worker-studio', 'header-left'",
  'hws3-native-dashboard-link',
  "href: baseHref('/sessions')",
  'inferApiModeFromEndpointInput',
  'modelApiMode',
  "plugin('/hermes/slash-complete'",
  "plugin('/hermes/commands'",
  "plugin('/hermes/slash-exec'",
  'ADVANCED_MARKER',
  '/hermes/sessions/${encodeURIComponent(id)}/projection',
  '/hermes/moa-sessions',
  'hws3-moa-page',
  'hws3-tool-activity-compact',
  'data-tool-detail-source',
  'buildToolSummaryGroups',
  'hasMeaningfulWork',
  'shouldRenderWorkTimeline',
  '原始详情保留在 Hermes 完整历史',
  'commandBusy',
  'locateSearchHit',
  'hws3-history-hit-anchor',
  'RECENT_LIMIT = 10',
  'CHAT_MESSAGE_LIMIT = 10',
  '消息全文 FTS',
  '← Worker Studio',
  "jinit('PATCH', { title:",
  "jinit('PATCH', { archived:",
  "jinit('DELETE')",
  'titleFromPrompt',
  'GENERATED_TITLE_SUFFIX',
  'onPaste',
  'onDrop',
  "plugin('/hermes/runs-v3'",
  '官方计划',
  'hws3-plan-summary',
  'unattended_restore',
  '完全访问',
  '/api/providers/custom-endpoints',
  '/activate',
  'configuredModelContext',
  'saveModelContext',
  'context_length',
  'hws3-model-context',
  'configuredProviderEntry',
  '旧配置已失效',
  '思考：支持',
  '思考：未确认',
  '强度：未公开',
  'ContextMeter',
  'officialContextTelemetry',
  'reasoningModelOptions',
  'hws3-reasoning-switch',
  'hws3-reasoning-slider',
  'fallbackTitle',
  'serverSession.title',
  'mapTurnRunsToMessages',
  'reconcileProjectedTurns',
  'projectedTurnIsActive',
  'officialAssistantForProjectedTurn',
  'projectedTurnNeedsReconciliation',
  'mergeProjectedRunEvents',
  'attachProjectedRun',
  'pollAttachedRun',
  'pollProjectedRecovery',
  'session-attach',
  'cancelRunPoll',
  'official_message_timestamp',
  'messagesLoading',
  '官方未提供时长',
  'system-sync',
  'context.compaction',
  'context.snapshot',
  'Auto Compact 进行中',
  '不会把累计 billing/input token 当成当前上下文',
]) assert.ok(js.includes(token), `missing Product 3 UI source token: ${token}`);

assert.ok(!js.includes("title: 'New conversation'"), 'fixed duplicate session title must never return');
assert.ok(!js.includes('API_SERVER_KEY'), 'browser UI source must never see Hermes bearer secrets');
assert.ok(js.includes('function fetchJSON(path, init) { return (window.__HERMES_PLUGIN_SDK__ || SDK).fetchJSON(path, init); }'), 'Product 3 must resolve the current SDK object and fetch layer at call time so capability enrichment is not bypassed during dynamic loading');
assert.ok(!js.includes('const fetchJSON = SDK.fetchJSON;'), 'Product 3 must not capture the pre-bridge SDK fetch layer');
assert.ok(js.includes('waitForCapabilityBridge();'), 'Product 3 must wait for the capability bridge before its first model inventory request');
assert.ok(js.includes("hws-model-capability-ready"), 'Product 3 must have an explicit capability bridge readiness signal');
assert.ok(js.includes("hws-gateway-native-ready"), 'Product 3 must wait for the Gateway-native downstream before its first model inventory request');

for (const token of [
  'MAX_ATTACHMENT_BYTES',
  "title: '添加文件'",
  "'aria-label': '添加文件'",
  "type: 'file_url'",
  "kind: item.kind || 'file'",
  "role: 'alert'",
  "'aria-live': 'assertive'",
  "'aria-modal': 'true'",
  "event.key === 'Escape'",
  'previousFocusRef.current?.focus?.()',
  "'aria-haspopup': 'menu'",
  "role: 'menuitem'",
  "'aria-expanded': expanded",
  "'aria-label': '给 Hermes 发送消息'",
  "'aria-label': '发送消息'",
  "'aria-label': '打开菜单'",
  "'aria-current': view === id ? 'page' : undefined",
  '粘贴 /responses 会规范化到 API Root',
]) assert.ok(stageBundle.includes(token), `missing deterministic Product 3 closure transform token: ${token}`);

for (const token of [
  '@router.post("/hermes/protocols/resolve")',
  '_AUTO_PROTOCOL_PROBE_LOCKS',
  '_AUTO_PROTOCOL_RETRY_SECONDS',
  'with _auto_protocol_probe_lock(provider, model):',
  '_probe_protocols_sync(provider, model)',
  'resolveProtocolExecutionRoute',
  'sourceFacingProtocolRoute',
  'workerExecution.provider',
  'reviewExecution.provider',
  'first-use or explicit real Hermes /v1/runs',
  '首次实际使用会自动探测并缓存',
  '不会按模型名猜测协议',
]) assert.ok(stageMixed.includes(token), `missing mixed-protocol closure transform token: ${token}`);

for (const token of [
  '@media(max-width:820px)',
  'env(safe-area-inset-bottom)',
  '.hws3-mobile-scrim',
  '.hws3-composer',
  '.hws3-plan-card',
  '.hws3-return-slot',
]) assert.ok(css.includes(token), `missing Product 3 base CSS token: ${token}`);

for (const token of [
  '.hws3-context-meter',
  '.hws3-context-popover',
  '.hws3-plan-summary',
  '.hws3-file-icon',
  '.hws3-history-hit-anchor',
  '.hws3-moa-page',
  '.hws3-moa-flow',
  '.hws3-reasoning-switch',
  '.hws3-reasoning-slider',
  'cubic-bezier(.22,1.2,.36,1)',
  '.hws3-context-warning',
  '.hws3-model-context',
  '.hws3-system-sync-details',
  '.hws3-tool-activity-compact',
  '.hws3-work-head',
  '@keyframes hws3-context-spin',
  '@media(max-width:540px)',
  'html:has(.hws3-root) #app-sidebar',
  '#root>[data-layout-variant]>header',
]) assert.ok(sealedCss.includes(token), `missing sealed Product 3 CSS token: ${token}`);

for (const token of [
  ':focus-visible',
  '@media (hover:none),(pointer:coarse)',
  '.hws3-session-more{opacity:1}',
  'max-height:100dvh',
  'min-height:0',
  'env(safe-area-inset-top)',
  '@media(prefers-reduced-motion:reduce)',
  'animation-duration:.001ms!important',
  'transition-duration:.001ms!important',
]) assert.ok(closureCss.includes(token), `missing final product closure CSS token: ${token}`);

for (const token of [
  'raw_input: Any = body.get("input")',
  '"input": raw_input',
  '@router.post("/hermes/runs-v3")',
  '@router.get("/hermes/sessions/{session_id}/context")',
  '@router.get("/hermes/sessions/{session_id}/projection")',
  '@router.put("/hermes/sessions/{session_id}/projection")',
  '_write_projection',
  'os.replace(temporary, path)',
  '_legacy._hermes_proxy',
  'BUILD_CANDIDATE_SHA = "source-tree"',
  '"candidate_sha": BUILD_CANDIDATE_SHA',
  'cumulative accounting buckets',
]) assert.ok(bridge.includes(token), `missing v3 bridge source token: ${token}`);
assert.ok(!bridge.includes('str(body.get("message") or body.get("input")'), 'v3 bridge must preserve structured input');

for (const token of [
  'dashboard/dist/gateway-native.js',
  'dashboard/dist/project-mark.png',
  'dashboard/dist/product-sealed.css',
  'dashboard/dist/product-closure.css',
  'project mark via Hermes official plugin static assets',
  'Hermes official TUI Gateway JSON-RPC',
  'scripts/stage_product_bundle.py',
  'scripts/stage_mixed_protocol.py',
  'HWS_CANDIDATE_SHA',
  'could not locate the unique Product 3 candidate marker',
  'Installing plugin atomically',
  'WebSocket reconnects resume durable Hermes Sessions',
]) assert.ok(installer.includes(token), `missing installer contract token: ${token}`);
assert.ok(!installer.includes('cp "$ROOT/dashboard/assets/favicon.svg"'));

for (const transform of [stageBundle, stageMixed]) {
  for (const forbidden of ['subprocess', 'urllib', 'requests', 'socket']) {
    assert.ok(!transform.includes(forbidden), `release transform gained forbidden external/process capability: ${forbidden}`);
  }
}

console.log('Worker Studio 3 product + final closure contract passed.');
