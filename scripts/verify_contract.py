#!/usr/bin/env python3
"""Archive/product contract checks for Hermes Worker Studio 3.x.

Studio is a product shell over documented Hermes contracts. The seal fails if a
second runtime/model/context/planner appears, the native Dashboard becomes
unreachable, structured probe input is flattened, product lifecycle controls
disappear, or the chat surface stops using the official Hermes Gateway.
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


manifest_text = read("dashboard/manifest.json")
try:
    manifest = json.loads(manifest_text)
except Exception as exc:
    manifest = {}
    fail(f"invalid dashboard/manifest.json: {exc}")

if manifest.get("tab", {}).get("override") != "/":
    fail("Worker Studio 3 must own only product home '/' so native /sessions remains reachable")
if manifest.get("tab", {}).get("path") != "/worker-studio":
    fail("dashboard product route must remain /worker-studio")
if manifest.get("entry") != "dist/gateway-native.js" or manifest.get("css") != "dist/product-sealed.css":
    fail("dashboard manifest must point at the Gateway-native sealed Product 3 assets")
if manifest.get("api") != "plugin_api_v3.py":
    fail("dashboard manifest must retain the v3 probe/compat bridge")
if set(manifest.get("slots") or []) != {"header-left", "sidebar"}:
    fail("dashboard must declare official header-left + sidebar return slots")
if str(manifest.get("version")) != "3.0.0":
    fail("dashboard manifest must be 3.0.0")

plugin_yaml = read("plugin.yaml")
for token in ("version: 3.0.0", "worker_delegate", "worker_status", "worker_catalog", "pre_tool_call", "config_schema", "mode:"):
    require(plugin_yaml, token, "plugin manifest")

production_python = ["__init__.py", "schemas.py", "tools.py", "dashboard/plugin_api.py", "dashboard/plugin_api_v3.py"]
for path in production_python:
    source = read(path)
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as exc:
        fail(f"Python syntax error in {path}: {exc}")
        continue
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name for alias in node.names]
            if isinstance(node, ast.ImportFrom) and node.module:
                names.append(node.module)
            for name in names:
                if name.startswith("sqlite3"):
                    fail(f"{path} directly imports persistence layer {name}")
                if name.startswith("tools.delegate_tool"):
                    fail(f"{path} imports private Hermes delegation implementation {name}")

native_tools = read("tools.py")
for token in (
    "subagent_lifecycle", "SubagentLaunchRequest", "policy_pre_tool_call",
    'mode == "MAIN"', 'mode == "OFFICIAL"', '"delegate_task"', '"DELEGATE"',
    '"/api/model/options"',
):
    require(native_tools, token, "native tools")
if "AIAgent" in native_tools or "_build_child" in native_tools or "_run_child" in native_tools:
    fail("native tools crossed the public subagent lifecycle boundary")

backend = read("dashboard/plugin_api.py")
for token in (
    "/v1/capabilities", "/v1/runs", "/events", "/stop", "/approval", "/steer",
    "/api/model/options", "/hermes/model-probe", "/hermes/unattended/probe",
    "official_runs", "no legacy execution fallback", "127.0.0.1:8642",
):
    require(backend, token, "sealed v2 Hermes probe bridge")
for forbidden in ("/chat/stream", "_worker(", "worker_proxy", "WORKER_TOKEN"):
    if forbidden in backend:
        fail(f"dashboard backend reintroduced obsolete execution surface: {forbidden}")

bridge3 = read("dashboard/plugin_api_v3.py")
for token in (
    'raw_input: Any = body.get("input")', '"input": raw_input',
    '@router.post("/hermes/runs-v3")', '_legacy._hermes_proxy',
    '"/v1/runs"', '"multimodal_runs": True',
    '@router.get("/hermes/sessions/{session_id}/context")',
    'context_window_tokens', 'compression_threshold_tokens', 'tokens_until_compression',
    'cumulative accounting buckets', '"run_projection": "context.snapshot"',
):
    require(bridge3, token, "v3 probe/compat bridge")
if 'str(body.get("message") or body.get("input")' in bridge3:
    fail("v3 Runs probe bridge flattens structured input")
for forbidden_context_fallback in ('payload.get("input_tokens")', 'payload.get("prompt_tokens")', 'payload.get("total_tokens")'):
    if forbidden_context_fallback in bridge3:
        fail(f"context bridge reintroduced billing-token fallback: {forbidden_context_fallback}")

gateway = read("dashboard/dist/gateway-native.js")
for token in (
    "SDK.buildWsUrl('/api/ws')",
    "'session.resume'",
    "close_on_disconnect: false",
    "'prompt.submit'",
    "'session.usage'",
    "'session.context_breakdown'",
    "const SESSION_RECONCILE",
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
):
    require(gateway, token, "Gateway-native chat transport")
for forbidden in (
    "API_SERVER_KEY",
    "HERMES_WORKER_STUDIO_API_KEY",
    "estimateTokens",
    "tokenizer",
    "new AIAgent",
    "todoPlanner",
    "close_on_disconnect: true",
    "reason: 'gateway_websocket_closed',\n              });\n            }\n            for (const pending",
):
    if forbidden in gateway:
        fail(f"Gateway-native browser entry reintroduced non-Hermes runtime/context/planner or disconnect-finalization logic: {forbidden}")

frontend = read("dashboard/dist/index-v3.js")
for token in (
    "RECENT_LIMIT = 10", "CHAT_MESSAGE_LIMIT = 10", "HISTORY_SESSION_LIMIT = 30",
    "['chat', '对话'", "['worker', 'Worker'", "['models', '模型'",
    "['moa', 'MOA'",
    "['unattended', '完全访问'", "['history', '完整历史'",
    "hws3-native-dashboard-link", "href: baseHref('/sessions')",
    "registerSlot('hermes-worker-studio', 'header-left'",
    "← Worker Studio", "/api/sessions/search", "jinit('PATCH', { title:",
    "jinit('PATCH', { archived:", "jinit('DELETE')", "titleFromPrompt",
    "Date.now().toString(36)", "/api/model/options", "/api/providers/custom-endpoints",
    "/activate", "/hermes/model-probe", "/hermes/runs-v3", "/steer", "/stop",
    "/approval", "官方计划", "已完成 ${completed} / ${items.length}", "hws3-plan-summary",
    "todo", "Hermes Skills 变化", "unattended_restore", "subagent_auto_approve",
    "Hardline Blocklist", "auxiliary.review", "delegation.reasoning_effort", "onPaste",
    "onDrop", "Ctrl/Cmd+V 粘贴文件", "ContextMeter", "officialContextTelemetry",
    "reconcileProjectedTurns", "projectedTurnIsActive", "officialAssistantForProjectedTurn",
    "projectedTurnNeedsReconciliation", "unique nearest response",
    "official timestamp only when it is the unique nearest response in a",
    "Load the official messages before exposing the recovered projection",
    "official_message_timestamp", "messagesLoading", "官方未提供时长",
    "inferApiModeFromEndpointInput", "canonicalApiMode", "modelApiMode",
    "protocol capabilities are read per", "hws3-slash-menu", "hws3-moa-session-list",
    "/api/model/moa", "Mixture of Agents", "hws3-moa-page", "hws3-moa-flow", "选择参与模型",
    "modelsFor(modelOptions", "locateSearchHit", "hws3-history-hit-anchor",
    "highlightText", "context.compaction", "context.snapshot",
    "Auto Compact 进行中", "Compact 完成，正在恢复实时上下文",
    "不会把累计 billing/input token 当成当前上下文",
):
    require(frontend, token, "product UI source")

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

stage_bundle = read("scripts/stage_product_bundle.py")
for token in (
    "MAX_ATTACHMENT_BYTES",
    "title: '添加文件'",
    "Ctrl/Cmd+V 粘贴文件",
    "type: 'file_url'",
    "kind: item.kind || 'file'",
    "application/pdf",
    "attachment chip",
    "file picker",
    "mixed attachment Run payload",
):
    require(stage_bundle, token, "fail-closed Product 3 release transform")
for forbidden in ("subprocess", "urllib", "requests", "socket"):
    if forbidden in stage_bundle:
        fail(f"release UI transform unexpectedly gained external/process capability: {forbidden}")

css = read("dashboard/dist/product.css")
for token in ("@media(max-width:820px)", "env(safe-area-inset-bottom)", ".hws3-mobile-scrim", ".hws3-composer", ".hws3-plan-card", ".hws3-return-slot"):
    require(css, token, "product base CSS")
sealed_css = read("dashboard/dist/product-sealed.css")
for token in (
    '@import url("./product.css");', '.hws3-context-meter', '.hws3-context-popover',
    '.hws3-plan-summary', '.hws3-file-icon', '@keyframes hws3-context-spin', '@media(max-width:540px)',
    '@media(prefers-reduced-motion:reduce)', 'env(safe-area-inset-bottom)',
    'html:has(.hws3-root) #app-sidebar', 'html:has(.hws3-root) #app-sidebar+div>header',
    '#root>[data-layout-variant]>header',
):
    require(sealed_css, token, "sealed context/plan/attachment CSS")

installer = read("scripts/install.sh")
for token in (
    "dashboard/dist/gateway-native.js",
    "dashboard/dist/project-mark.png",
    "project mark via Hermes official plugin static assets",
    "Hermes official TUI Gateway JSON-RPC",
    "scripts/stage_product_bundle.py",
    'python3 "$ROOT/scripts/stage_product_bundle.py" "$TMP/dashboard/dist/index-v3.js"',
    "arbitrary attachments",
    "WebSocket reconnects resume durable Hermes Sessions",
    "dashboard/dist/product-sealed.css",
):
    require(installer, token, "official Hermes branding/product installer")
if 'cp "$ROOT/dashboard/assets/favicon.svg"' in installer:
    fail("installer still ships an independent Worker Studio favicon")
if (ROOT / "dashboard" / "assets" / "favicon.svg").exists():
    fail("independent Worker Studio favicon asset still exists")

legacy_repo = "codex-worker-" + "delegation"
legacy_port = ":" + "8788"
legacy_env = "CWD" + "_"
legacy_app_server = "Codex" + " App Server"
runtime_paths = [
    "plugin.yaml", "__init__.py", "schemas.py", "tools.py", "dashboard/manifest.json",
    "dashboard/plugin_api.py", "dashboard/plugin_api_v3.py", "dashboard/dist/gateway-native.js",
    "dashboard/dist/index-v3.js", "dashboard/dist/product-sealed.css",
    "deploy/worker-studio.env.example", "scripts/install.sh", "scripts/stage_product_bundle.py",
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

print("Archive/product contract passed: Hermes remains the sole execution/model/context/plan/policy upstream; Studio chat uses official Gateway JSON-RPC, arbitrary attachment RPCs, durable session resume, and no-wait Full Access input handling.")
