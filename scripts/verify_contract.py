#!/usr/bin/env python3
"""Archive/product contract checks for Hermes Worker Studio 3.x.

Studio is a product shell over documented Hermes contracts. The seal fails if a
second runtime/model registry appears, the native Dashboard becomes unreachable,
structured Run input is flattened, or product lifecycle controls disappear.
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
if manifest.get("entry") != "dist/index-v3.js" or manifest.get("css") != "dist/product.css":
    fail("dashboard manifest must point at product v3 UI assets")
if manifest.get("api") != "plugin_api_v3.py":
    fail("dashboard manifest must point at the structured-input preserving v3 bridge")
if manifest.get("slots") != ["header-left"]:
    fail("dashboard must declare the official header-left return slot")
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
    require(backend, token, "sealed v2 Hermes bridge")
for forbidden in ("/chat/stream", "_worker(", "worker_proxy", "WORKER_TOKEN"):
    if forbidden in backend:
        fail(f"dashboard backend reintroduced obsolete execution surface: {forbidden}")

bridge3 = read("dashboard/plugin_api_v3.py")
for token in (
    'raw_input: Any = body.get("input")', '"input": raw_input',
    '@router.post("/hermes/runs-v3")', '_legacy._hermes_proxy',
    '"/v1/runs"', '"multimodal_runs": True',
):
    require(bridge3, token, "v3 Runs bridge")
if 'str(body.get("message") or body.get("input")' in bridge3:
    fail("v3 Runs bridge flattens structured input")

frontend = read("dashboard/dist/index-v3.js")
for token in (
    "RECENT_LIMIT = 20", "CHAT_MESSAGE_LIMIT = 80", "HISTORY_SESSION_LIMIT = 30",
    "['chat', '对话'", "['worker', 'Worker'", "['models', '模型'",
    "['unattended', '完全访问'", "['history', '完整历史'",
    "['/skills', '技能'", "['/plugins', '插件'", "['/mcp', 'MCP'",
    "['/sessions', '原生 Dashboard · 会话'", "registerSlot('hermes-worker-studio', 'header-left'",
    "← Worker Studio", "/api/sessions/search", "jinit('PATCH', { title:",
    "jinit('PATCH', { archived:", "jinit('DELETE')", "titleFromPrompt",
    "Date.now().toString(36)", "/api/model/options", "/api/providers/custom-endpoints",
    "/activate", "/hermes/model-probe", "/hermes/runs-v3", "/steer", "/stop",
    "/approval", "官方计划", "todo", "Hermes Skills 变化", "unattended_restore",
    "subagent_auto_approve", "Hardline Blocklist", "auxiliary.review",
    "delegation.reasoning_effort", "onPaste", "onDrop", "Ctrl/Cmd+V 粘贴图片",
):
    require(frontend, token, "product frontend")

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

css = read("dashboard/dist/product.css")
for token in ("@media(max-width:820px)", "env(safe-area-inset-bottom)", ".hws3-mobile-scrim", ".hws3-composer", ".hws3-plan-card", ".hws3-return-slot"):
    require(css, token, "product CSS")

# Branding is sealed by reuse of the official same-origin Hermes Web favicon,
# not by maintaining a second Studio-owned mark. The source bundle stays
# mountable in isolated tests, while the supported installer rewrites only the
# staged release bundle to /favicon.ico. CI separately proves that exact asset
# exists in the pinned upstream Hermes checkout.
installer = read("scripts/install.sh")
for token in (
    "const href = baseHref('/favicon.ico');",
    "official Hermes Dashboard /favicon.ico",
    "could not locate the unique Product 3 favicon assignment",
):
    require(installer, token, "official Hermes branding installer")
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
    "dashboard/plugin_api.py", "dashboard/plugin_api_v3.py", "dashboard/dist/index-v3.js",
    "deploy/worker-studio.env.example", "scripts/install.sh",
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

print("Archive/product contract passed: Hermes remains the sole execution/model/policy upstream and the v3 product shell is closed.")
