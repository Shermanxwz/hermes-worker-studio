#!/usr/bin/env python3
"""Archive contract checks for Hermes Worker Studio 2.x.

The seal is architectural: Studio must remain a thin product layer over public
Hermes contracts. CI deliberately fails if a second worker runtime, private
Hermes implementation dependency, guessed reasoning ladder, or duplicate model
registry re-enters production code.
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
if manifest.get("tab", {}).get("override") != "/sessions":
    fail("dashboard must replace /sessions through official tab.override")
if manifest.get("entry") != "dist/index.js" or manifest.get("api") != "plugin_api.py":
    fail("dashboard manifest entry/api contract drifted")
if str(manifest.get("version")) != "2.0.0":
    fail("dashboard manifest must remain on sealed 2.0.0 contract")

plugin_yaml = read("plugin.yaml")
for token in ("version: 2.0.0", "worker_delegate", "worker_status", "worker_catalog", "pre_tool_call", "config_schema", "mode:"):
    require(plugin_yaml, token, "plugin manifest")

production_python = ["__init__.py", "schemas.py", "tools.py", "dashboard/plugin_api.py"]
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
    "subagent_lifecycle",
    "SubagentLaunchRequest",
    "policy_pre_tool_call",
    'mode == "MAIN"',
    'mode == "OFFICIAL"',
    '"delegate_task"',
    '"DELEGATE"',
    '"/api/model/options"',
):
    require(native_tools, token, "native tools")
if "AIAgent" in native_tools or "_build_child" in native_tools or "_run_child" in native_tools:
    fail("native tools crossed the public subagent lifecycle boundary")

backend = read("dashboard/plugin_api.py")
for token in (
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
):
    require(backend, token, "dashboard backend")
for forbidden in ("/chat/stream", "_worker(", "worker_proxy", "WORKER_TOKEN"):
    if forbidden in backend:
        fail(f"dashboard backend reintroduced obsolete execution surface: {forbidden}")

frontend = read("dashboard/dist/index.js")
for token in (
    "RECENT_LIMIT = 10",
    "CHAT_MESSAGE_LIMIT = 40",
    "HISTORY_SESSION_LIMIT = 20",
    "HISTORY_MESSAGE_LIMIT = 100",
    "['chat', '对话'",
    "['worker', 'Worker'",
    "['models', '模型'",
    "['unattended', '无人值守'",
    "['history', '完整历史'",
    "['/skills', '技能'",
    "['/plugins', '插件'",
    "['/mcp', 'MCP'",
    "/api/sessions/search",
    "archived=${kind}",
    "/api/model/options",
    "/api/providers/custom-endpoints",
    "/hermes/model-probe",
    "/hermes/runs",
    "todo.updated",
    "Hermes Skills 变化",
    "subagent_auto_approve",
    "Hardline 边界永久保留",
    "auxiliary.review",
    "delegation.reasoning_effort",
):
    require(frontend, token, "frontend")

# Reasoning values must originate in upstream metadata. Auto is Studio's only
# local sentinel. Never recreate a familiar provider-specific effort ladder.
for guessed in ("minimal", "low", "medium", "high", "xhigh"):
    if re.search(rf"['\"]{re.escape(guessed)}['\"]", frontend):
        fail(f"frontend hard-codes reasoning effort {guessed!r}")

# Navigation duplication is a product-contract regression: model credentials
# and custom endpoints belong under Models rather than their own first-level
# Keys/Providers items.
primary_nav_match = re.search(r"const PRIMARY_NAV = \[(.*?)\];", frontend, re.S)
if primary_nav_match:
    primary_nav = primary_nav_match.group(1)
    if "Keys" in primary_nav or "Providers" in primary_nav:
        fail("Keys/Providers reappeared as duplicate first-level navigation")
else:
    fail("cannot locate PRIMARY_NAV")

# Browser code must never receive server bearer secrets.
for secret in ("API_SERVER_KEY", "HERMES_WORKER_STUDIO_API_KEY"):
    if secret in frontend:
        fail(f"frontend references server secret {secret}")

# Entire runtime/install surface must have no second worker service. Build the
# legacy sentinels from fragments so this verifier does not self-match them.
legacy_repo = "codex-worker-" + "delegation"
legacy_port = ":" + "8788"
legacy_env = "CWD" + "_"
legacy_app_server = "Codex" + " App Server"
runtime_paths = [
    "plugin.yaml", "__init__.py", "schemas.py", "tools.py",
    "dashboard/manifest.json", "dashboard/plugin_api.py",
    "dashboard/dist/index.js", "deploy/worker-studio.env.example",
    "scripts/install.sh",
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
    print("Archive contract verification FAILED:", file=sys.stderr)
    for item in errors:
        print(f"  - {item}", file=sys.stderr)
    raise SystemExit(1)

print("Archive contract verification passed: Hermes is the sole execution/model/policy upstream.")
