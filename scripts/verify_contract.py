#!/usr/bin/env python3
"""Static archive contract checks.

These checks intentionally test boundaries rather than implementation details:
Worker Studio must remain a thin consumer of documented Hermes/Worker surfaces
and must not quietly grow a private-database or guessed-capability dependency.
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
    p = ROOT / path
    if not p.is_file():
        fail(f"missing required file: {path}")
        return ""
    return p.read_text(encoding="utf-8")


manifest_text = read("dashboard/manifest.json")
try:
    manifest = json.loads(manifest_text)
except Exception as exc:
    manifest = {}
    fail(f"invalid dashboard/manifest.json: {exc}")

if manifest.get("tab", {}).get("override") != "/sessions":
    fail("dashboard plugin must override /sessions through official tab.override")
if manifest.get("entry") != "dist/index.js" or manifest.get("api") != "plugin_api.py":
    fail("dashboard manifest entry/api contract drifted")

plugin_yaml = read("plugin.yaml")
for tool in ("worker_delegate", "worker_status", "worker_catalog"):
    if tool not in plugin_yaml:
        fail(f"native plugin no longer declares {tool}")

for py_name in ("__init__.py", "schemas.py", "tools.py", "dashboard/plugin_api.py"):
    source = read(py_name)
    try:
        tree = ast.parse(source, filename=py_name)
    except SyntaxError as exc:
        fail(f"Python syntax error in {py_name}: {exc}")
        continue
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name for alias in node.names]
            if isinstance(node, ast.ImportFrom) and node.module:
                names.append(node.module)
            for name in names:
                if name.startswith("hermes_state") or name.startswith("sqlite3"):
                    fail(f"{py_name} imports private/persistence layer {name}; use official HTTP/plugin contracts")

backend = read("dashboard/plugin_api.py")
for token in (
    "/v1/capabilities",
    "/api/model/options",
    "/api/sessions",
    "/chat/stream",
    "/api/catalog",
    "/api/provider/connectivity",
    "/api/routing",
    "HERMES_WORKER_STUDIO_ALLOW_REMOTE",
    "_RUN_EVENT_LIMIT",
):
    if token not in backend:
        fail(f"backend lost required contract token: {token}")

frontend = read("dashboard/dist/index.js")
for token in (
    "RECENT_LIMIT = 10",
    "CHAT_MESSAGE_LIMIT = 40",
    "HISTORY_SESSION_LIMIT = 20",
    "HISTORY_MESSAGE_LIMIT = 100",
    "/api/sessions/search",
    "/api/providers/custom-endpoints",
    "reasoning?.options",
    "/hermes/runs",
    "/worker/provider/connectivity",
    "unattended_mode: 'approve'",
):
    if token not in frontend:
        fail(f"frontend lost required behavior token: {token}")

# The archive view passes the official filter into the shared paged-session
# component; the final URL is assembled from that prop at runtime.
if not re.search(r"archived:\s*['\"]only['\"]", frontend):
    fail("frontend lost archived-only view")

# Never invent the common Codex effort ladder. Exact effort strings must flow
# from the upstream capability registry. Auto is the only local sentinel.
for guessed in ("minimal", "low", "medium", "high", "xhigh"):
    if re.search(rf"['\"]{re.escape(guessed)}['\"]", frontend):
        fail(f"frontend hard-codes reasoning effort {guessed!r}; only upstream-advertised values are allowed")

# Browser code may use official Dashboard API + plugin backend only. Upstream
# bearer secrets stay server side.
for secret in ("API_SERVER_KEY", "CWD_WEB_TOKEN", "HERMES_WORKER_STUDIO_API_KEY", "HERMES_WORKER_STUDIO_WORKER_TOKEN"):
    if secret in frontend:
        fail(f"frontend references server secret {secret}")

# Keep upstream bridges loopback by default.
if "127.0.0.1:8642" not in backend or "127.0.0.1:8788" not in backend:
    fail("backend loopback defaults changed")
if "danger-full-access" not in read("tools.py"):
    fail("worker_delegate no longer defaults to requested full-access sandbox")

if errors:
    print("Archive contract verification FAILED:", file=sys.stderr)
    for item in errors:
        print(f"  - {item}", file=sys.stderr)
    raise SystemExit(1)

print("Archive contract verification passed.")
