#!/usr/bin/env python3
"""Archive/product contract checks for Hermes Worker Studio 3.x.

This is a structural seal gate, not a feature test. It locks the product to one
Hermes-owned execution/model/context/planning plane, one supported installation
artifact, deterministic release transforms, and the responsive/a11y closure
layer. Runtime behavior is covered separately by Python/JS integration tests and
the real-target seal workflow.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def read(path: str) -> str:
    target = ROOT / path
    if not target.is_file():
        fail(f"missing required file: {path}")
        return ""
    return target.read_text(encoding="utf-8")


def require(text: str, token: str, label: str) -> None:
    if token not in text:
        fail(f"{label} lost required contract token: {token}")


def require_all(text: str, tokens: tuple[str, ...], label: str) -> None:
    for token in tokens:
        require(text, token, label)


# ---------------------------------------------------------------------------
# Plugin/product manifest: one product home, native Hermes remains reachable.
# ---------------------------------------------------------------------------
manifest_text = read("dashboard/manifest.json")
try:
    manifest = json.loads(manifest_text)
except Exception as exc:
    manifest = {}
    fail(f"invalid dashboard/manifest.json: {exc}")

if manifest.get("tab", {}).get("override") != "/":
    fail("Worker Studio must own only product home '/' so native /sessions remains reachable")
if manifest.get("tab", {}).get("path") != "/worker-studio":
    fail("dashboard product route must remain /worker-studio")
if manifest.get("entry") != "dist/gateway-native.js":
    fail("dashboard manifest must use the official Gateway-native browser entry")
if manifest.get("css") != "dist/product-closure.css":
    fail("dashboard manifest must load the final product-closure stylesheet")
if manifest.get("api") != "plugin_api_v3.py":
    fail("dashboard manifest must retain the Product 3 probe/compat bridge")
if set(manifest.get("slots") or []) != {"header-left", "sidebar"}:
    fail("dashboard must declare official header-left + sidebar return slots")
if str(manifest.get("version")) != "3.0.0":
    fail("dashboard manifest must remain Product 3.0.0 until a deliberate release bump")

plugin_yaml = read("plugin.yaml")
require_all(
    plugin_yaml,
    ("version: 3.0.0", "worker_delegate", "worker_status", "worker_catalog", "pre_tool_call", "config_schema", "mode:"),
    "plugin manifest",
)

# ---------------------------------------------------------------------------
# Production Python: no private Hermes delegation or second persistence/runtime.
# ---------------------------------------------------------------------------
production_python = [
    "__init__.py",
    "schemas.py",
    "tools.py",
    "dashboard/plugin_api.py",
    "dashboard/plugin_api_v3.py",
]
for path in production_python:
    source = read(path)
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as exc:
        fail(f"Python syntax error in {path}: {exc}")
        continue
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        names = [alias.name for alias in node.names]
        if isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
        for name in names:
            if name.startswith("sqlite3"):
                fail(f"{path} directly imports persistence layer {name}")
            if name.startswith("tools.delegate_tool"):
                fail(f"{path} imports private Hermes delegation implementation {name}")

native_tools = read("tools.py")
require_all(
    native_tools,
    (
        "subagent_lifecycle",
        "SubagentLaunchRequest",
        "policy_pre_tool_call",
        'mode == "MAIN"',
        'mode == "OFFICIAL"',
        '"delegate_task"',
        '"DELEGATE"',
        '"/api/model/options"',
        "while len(_HANDLES) > 256",
        "min(seconds, 86_400.0)",
    ),
    "native tools",
)
for forbidden in ("AIAgent", "_build_child", "_run_child"):
    if forbidden in native_tools:
        fail(f"native tools crossed the public subagent lifecycle boundary: {forbidden}")

# ---------------------------------------------------------------------------
# Hermes HTTP/Gateway bridge contracts.
# ---------------------------------------------------------------------------
backend = read("dashboard/plugin_api.py")
require_all(
    backend,
    (
        "/v1/capabilities",
        "/v1/runs",
        "/events",
        "/stop",
        "/approval",
        "/steer",
        "/api/model/options",
        "/hermes/model-probe",
        "/hermes/unattended/probe",
        "official_runs",
        "no legacy execution fallback",
        "127.0.0.1:8642",
    ),
    "sealed v2 Hermes probe bridge",
)
for forbidden in ("/chat/stream", "_worker(", "worker_proxy", "WORKER_TOKEN"):
    if forbidden in backend:
        fail(f"dashboard backend reintroduced obsolete execution surface: {forbidden}")

bridge3 = read("dashboard/plugin_api_v3.py")
require_all(
    bridge3,
    (
        'raw_input: Any = body.get("input")',
        '"input": raw_input',
        '@router.post("/hermes/runs-v3")',
        '_legacy._hermes_proxy',
        '"/v1/runs"',
        '"multimodal_runs": True',
        '@router.get("/hermes/sessions/{session_id}/context")',
        'context_window_tokens',
        'compression_threshold_tokens',
        'tokens_until_compression',
        'cumulative accounting buckets',
        '"run_projection": "context.snapshot"',
        'BUILD_CANDIDATE_SHA = "source-tree"',
    ),
    "v3 probe/compat bridge source",
)
if 'str(body.get("message") or body.get("input")' in bridge3:
    fail("v3 Runs bridge flattens structured multimodal input")
for forbidden in ('payload.get("input_tokens")', 'payload.get("prompt_tokens")', 'payload.get("total_tokens")'):
    if forbidden in bridge3:
        fail(f"context bridge reintroduced billing-token fallback: {forbidden}")

gateway = read("dashboard/dist/gateway-native.js")
require_all(
    gateway,
    (
        "SDK.buildWsUrl('/api/ws')",
        "'session.resume'",
        "close_on_disconnect: false",
        "'prompt.submit'",
        "'session.usage'",
        "'session.context_breakdown'",
        "const SESSION_RECONCILE",
        "const SESSION_ATTACH",
        "'session.events.since'",
        "hermes.gateway.session.resume_reconciliation",
        "type === 'todo.updated'",
        "type === 'status.update'",
        "kind === 'compacting'",
        "kind === 'compacted'",
        "'image.attach_bytes'",
        "'pdf.attach'",
        "'file.attach'",
        "result?.ref_text",
        "'session.steer'",
        "'session.interrupt'",
        "'approval.respond'",
        "'clarify.respond'",
        "'mcp.setup.respond'",
        "'sudo.respond'",
        "'secret.respond'",
        "'terminal.read.respond'",
        "transport.reconnecting",
        "transport.reconnected",
        "source: 'hermes_gateway_jsonrpc'",
        "transport: 'official_gateway_websocket'",
        "protocol: 'tui_gateway_jsonrpc_websocket'",
        "reconnect: 'session.resume(close_on_disconnect=false)'",
        "attachments: ['image.attach_bytes', 'pdf.attach', 'file.attach']",
        "registerSlot('hermes-worker-studio', 'header-left'",
        "registerSlot('hermes-worker-studio', 'sidebar'",
        "new URL('index-v3.js', current.src)",
    ),
    "Gateway-native product chat",
)
for forbidden in (
    "API_SERVER_KEY",
    "HERMES_WORKER_STUDIO_API_KEY",
    "estimateTokens",
    "tokenizer",
    "new AIAgent",
    "todoPlanner",
    "close_on_disconnect: true",
):
    if forbidden in gateway:
        fail(f"Gateway-native entry reintroduced non-Hermes state/runtime behavior: {forbidden}")

# ---------------------------------------------------------------------------
# Source UI: stable product capabilities; release transforms may only harden it.
# ---------------------------------------------------------------------------
frontend = read("dashboard/dist/index-v3.js")
require_all(
    frontend,
    (
        "RECENT_LIMIT = 10",
        "CHAT_MESSAGE_LIMIT = 10",
        "HISTORY_SESSION_LIMIT = 30",
        "['chat', '对话'",
        "['worker', 'Worker'",
        "['models', '模型'",
        "['moa', 'MOA'",
        "['unattended', '完全访问'",
        "['history', '完整历史'",
        "hws3-native-dashboard-link",
        "href: baseHref('/sessions')",
        "← Worker Studio",
        "/api/sessions/search",
        "jinit('PATCH', { title:",
        "jinit('PATCH', { archived:",
        "jinit('DELETE')",
        "titleFromPrompt",
        "GENERATED_TITLE_SUFFIX",
        "/api/model/options",
        "/api/providers/custom-endpoints",
        "/activate",
        "/hermes/model-probe",
        "/hermes/runs-v3",
        "/steer",
        "/stop",
        "/approval",
        "官方计划",
        "hws3-plan-summary",
        "todo",
        "Hermes Skills 变化",
        "unattended_restore",
        "subagent_auto_approve",
        "Hardline Blocklist",
        "auxiliary.review",
        "delegation.reasoning_effort",
        "onPaste",
        "onDrop",
        "ContextMeter",
        "officialContextTelemetry",
        "reconcileProjectedTurns",
        "officialAssistantForProjectedTurn",
        "projectedTurnNeedsReconciliation",
        "unique nearest response",
        "official_message_timestamp",
        "messagesLoading",
        "官方未提供时长",
        "inferApiModeFromEndpointInput",
        "canonicalApiMode",
        "modelApiMode",
        "hws3-slash-menu",
        "hws3-moa-session-list",
        "/api/model/moa",
        "Mixture of Agents",
        "hws3-moa-page",
        "hws3-moa-flow",
        "locateSearchHit",
        "hws3-history-hit-anchor",
        "highlightText",
        "context.compaction",
        "context.snapshot",
        "Auto Compact 进行中",
        "不会把累计 billing/input token 当成当前上下文",
    ),
    "Product 3 UI source",
)
if "title: 'New conversation'" in frontend:
    fail("fixed duplicate session title returned")
for secret in ("API_SERVER_KEY", "HERMES_WORKER_STUDIO_API_KEY"):
    if secret in frontend:
        fail(f"frontend references server secret {secret}")

reasoning_match = re.search(r"function reasoningOptions\(.*?\n  }\n  function normalizeRoute", frontend, re.S)
if not reasoning_match:
    fail("cannot locate reasoningOptions")
else:
    reasoning_source = reasoning_match.group(0)
    for guessed in ("minimal", "low", "medium", "high", "xhigh"):
        if re.search(rf"['\"]{re.escape(guessed)}['\"]", reasoning_source):
            fail(f"frontend hard-codes reasoning effort {guessed!r}")

primary_nav_match = re.search(r"const PRIMARY_NAV = \[(.*?)\];", frontend, re.S)
if not primary_nav_match:
    fail("cannot locate PRIMARY_NAV")
elif "Keys" in primary_nav_match.group(1) or "Providers" in primary_nav_match.group(1):
    fail("Keys/Providers reappeared as duplicate first-level navigation")

# ---------------------------------------------------------------------------
# Deterministic release transforms: no network/process/runtime ownership.
# ---------------------------------------------------------------------------
stage_bundle = read("scripts/stage_product_bundle.py")
require_all(
    stage_bundle,
    (
        "MAX_ATTACHMENT_BYTES",
        "title: '添加文件'",
        "type: 'file_url'",
        "kind: item.kind || 'file'",
        "application/pdf",
        "role: 'alert'",
        "event.key === 'Escape'",
        "previousFocusRef.current?.focus?.()",
        "'aria-haspopup': 'menu'",
        "role: 'menuitem'",
        "'aria-label': '给 Hermes 发送消息'",
        "'aria-label': '发送消息'",
        "'aria-label': '打开菜单'",
        "'aria-current': view === id ? 'page' : undefined",
        "粘贴 /responses 会规范化到 API Root",
        "mixed attachment Run payload",
    ),
    "Product 3 deterministic UI transform",
)
stage_mixed = read("scripts/stage_mixed_protocol.py")
require_all(
    stage_mixed,
    (
        '@router.post("/hermes/protocols/resolve")',
        "_AUTO_PROTOCOL_PROBE_LOCKS",
        "_AUTO_PROTOCOL_RETRY_SECONDS",
        "with _auto_protocol_probe_lock(provider, model):",
        "_probe_protocols_sync(provider, model)",
        "resolveProtocolExecutionRoute",
        "sourceFacingProtocolRoute",
        "workerExecution.provider",
        "reviewExecution.provider",
        "first-use or explicit real Hermes /v1/runs",
        "首次实际使用会自动探测并缓存",
        "不会按模型名猜测协议",
    ),
    "mixed-protocol deterministic transform",
)
for path, text in (("stage_product_bundle.py", stage_bundle), ("stage_mixed_protocol.py", stage_mixed)):
    for forbidden in ("subprocess", "urllib", "requests", "socket"):
        if forbidden in text:
            fail(f"{path} unexpectedly gained external/process capability: {forbidden}")

# ---------------------------------------------------------------------------
# CSS layering: base -> sealed product polish -> final closure hardening.
# ---------------------------------------------------------------------------
css = read("dashboard/dist/product.css")
require_all(
    css,
    ("@media(max-width:820px)", "env(safe-area-inset-bottom)", ".hws3-mobile-scrim", ".hws3-composer", ".hws3-plan-card", ".hws3-return-slot"),
    "product base CSS",
)
sealed_css = read("dashboard/dist/product-sealed.css")
require_all(
    sealed_css,
    (
        '@import url("./product.css");',
        '.hws3-context-meter',
        '.hws3-context-popover',
        '.hws3-plan-summary',
        '.hws3-file-icon',
        '@keyframes hws3-context-spin',
        '@media(max-width:540px)',
        '@media(prefers-reduced-motion:reduce)',
        'env(safe-area-inset-bottom)',
        'html:has(.hws3-root) #app-sidebar',
        'html:has(.hws3-root) #app-sidebar+div>header',
        '#root>[data-layout-variant]>header',
    ),
    "sealed product CSS",
)
closure_css = read("dashboard/dist/product-closure.css")
require_all(
    closure_css,
    (
        '@import url("./product-sealed.css");',
        ':focus-visible',
        '@media (hover:none),(pointer:coarse)',
        '.hws3-session-more{opacity:1}',
        'max-height:100dvh',
        'min-height:0',
        'env(safe-area-inset-top)',
        '@media(prefers-reduced-motion:reduce)',
        'animation-duration:.001ms!important',
        'transition-duration:.001ms!important',
    ),
    "final product closure CSS",
)

# ---------------------------------------------------------------------------
# Installer: exact candidate stamp, both transforms, closure asset, atomic swap.
# ---------------------------------------------------------------------------
installer = read("scripts/install.sh")
require_all(
    installer,
    (
        "dashboard/dist/gateway-native.js",
        "dashboard/dist/project-mark.png",
        "dashboard/dist/product-sealed.css",
        "dashboard/dist/product-closure.css",
        "project mark via Hermes official plugin static assets",
        "Hermes official TUI Gateway JSON-RPC",
        "scripts/stage_product_bundle.py",
        "scripts/stage_mixed_protocol.py",
        'python3 "$ROOT/scripts/stage_product_bundle.py" "$TMP/dashboard/dist/index-v3.js"',
        'python3 "$ROOT/scripts/stage_mixed_protocol.py"',
        "HWS_CANDIDATE_SHA",
        "could not locate the unique Product 3 candidate marker",
        "Installing plugin atomically",
        "WebSocket reconnects resume durable Hermes Sessions",
    ),
    "supported installer",
)
if 'cp "$ROOT/dashboard/assets/favicon.svg"' in installer:
    fail("installer still ships an independent Worker Studio favicon")
if (ROOT / "dashboard" / "assets" / "favicon.svg").exists():
    fail("independent Worker Studio favicon asset still exists")

# ---------------------------------------------------------------------------
# No sidecar/legacy runtime may re-enter any production or release-build path.
# ---------------------------------------------------------------------------
legacy_repo = "codex-worker-" + "delegation"
legacy_port = ":" + "8788"
legacy_env = "CWD" + "_"
legacy_app_server = "Codex" + " App Server"
runtime_paths = [
    "plugin.yaml",
    "__init__.py",
    "schemas.py",
    "tools.py",
    "dashboard/manifest.json",
    "dashboard/plugin_api.py",
    "dashboard/plugin_api_v3.py",
    "dashboard/dist/gateway-native.js",
    "dashboard/dist/index-v3.js",
    "dashboard/dist/product.css",
    "dashboard/dist/product-sealed.css",
    "dashboard/dist/product-closure.css",
    "deploy/worker-studio.env.example",
    "scripts/install.sh",
    "scripts/stage_product_bundle.py",
    "scripts/stage_mixed_protocol.py",
]
for path in runtime_paths:
    text = read(path)
    for sentinel in (legacy_repo, legacy_port, legacy_env, legacy_app_server):
        if sentinel in text:
            fail(f"{path} still contains removed sidecar runtime sentinel {sentinel!r}")

if (ROOT / "scripts" / "run-worker-local.sh").exists():
    fail("obsolete worker sidecar launcher still exists")
if (ROOT / "tests" / "real_worker_smoke.py").exists():
    fail("obsolete worker sidecar smoke test still exists")

# Exact upstream snapshot remains one Hermes repository only.
lock_text = read("tests/upstream-lock.json")
try:
    lock = json.loads(lock_text)
except Exception as exc:
    lock = {}
    fail(f"invalid tests/upstream-lock.json: {exc}")
if set(lock) != {"hermes"}:
    fail("archive lock must have Hermes as its only runtime upstream")
hermes = lock.get("hermes", {}) if isinstance(lock, dict) else {}
for key in ("repository", "commit", "version", "channel", "snapshot_date", "snapshot_reason"):
    if not hermes.get(key):
        fail(f"Hermes archive lock missing {key}")
if hermes.get("repository") != "NousResearch/hermes-agent":
    fail("Hermes archive lock points at unexpected repository")

if errors:
    print("Archive/product contract verification FAILED:", file=sys.stderr)
    for item in errors:
        print(f"  - {item}", file=sys.stderr)
    raise SystemExit(1)

print(
    "Archive/product contract passed: Hermes remains the sole execution/model/context/plan/policy upstream; "
    "the supported artifact is candidate-stamped, deterministic, responsive, keyboard/touch hardened, "
    "mixed-protocol fail-closed, and Gateway-native."
)
