#!/usr/bin/env python3
"""Verify the exact Hermes public contracts Worker Studio Product 3 is sealed to.

The verifier pins semantics, not incidental source-file placement. Contracts
that have a documented canonical file are checked there; cross-surface config
and dashboard APIs are required to exist somewhere in Hermes' public/product
source, docs or tests so harmless upstream refactors do not create false drift.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
from collections.abc import Iterable

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "tests" / "upstream-lock.json").read_text(encoding="utf-8"))
errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def read(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:
        fail(f"cannot read {path}: {exc}")
        return ""


def git_head(root: pathlib.Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"cannot resolve git HEAD for {root}: {exc.output.strip()}")
        return ""


def require_tokens(path: pathlib.Path, tokens: Iterable[str], label: str) -> None:
    text = read(path)
    for token in tokens:
        if token not in text:
            fail(f"{label} lost required token {token!r} in {path}")


def require_any(root: pathlib.Path, token: str, globs: Iterable[str], label: str) -> None:
    for pattern in globs:
        for path in root.glob(pattern):
            if not path.is_file():
                continue
            try:
                if token in path.read_text(encoding="utf-8", errors="ignore"):
                    return
            except OSError:
                pass
    fail(f"{label} public contract token not found: {token!r}")


def verify_hermes(hermes: pathlib.Path) -> None:
    expected = LOCK["hermes"]
    actual = git_head(hermes)
    if actual != expected["commit"]:
        fail(f"Hermes checkout is not pinned: expected {expected['commit']}, got {actual}")

    pyproject = read(hermes / "pyproject.toml")
    match = re.search(r'^version\s*=\s*"([^"]+)"', pyproject, re.MULTILINE)
    actual_version = match.group(1) if match else "unknown"
    if actual_version != expected["version"]:
        fail(f"Hermes version drift: expected {expected['version']}, got {actual_version}")

    require_tokens(
        hermes / "website" / "docs" / "developer-guide" / "subagent-lifecycle-api.md",
        (
            "Public Subagent Lifecycle API",
            "ctx.subagent_lifecycle",
            "SubagentLaunchRequest",
            "allowed_toolsets",
            "status",
            "wait",
            "cancel",
            "result",
            "reconnect",
            "same host-owned path as `delegate_task`",
        ),
        "Hermes public subagent lifecycle docs",
    )
    require_tokens(
        hermes / "agent" / "subagent_lifecycle.py",
        (
            "PUBLIC_CONTRACT_VERSION = 1",
            "class SubagentLaunchRequest",
            "class SubagentHandle",
            "class SubagentLifecycleService",
            "def launch(",
            "def status(",
            "def wait(",
            "def cancel(",
            "def result(",
        ),
        "Hermes public subagent lifecycle implementation",
    )
    require_tokens(
        hermes / "hermes_cli" / "plugins.py",
        (
            "def subagent_lifecycle",
            "SubagentLifecycleService",
            '"pre_tool_call"',
            '"action": "block"',
            "get_config",
            "set_config",
        ),
        "Hermes PluginContext/policy surface",
    )

    require_tokens(
        hermes / "website" / "docs" / "developer-guide" / "programmatic-integration.md",
        (
            "TUI Gateway JSON-RPC",
            "JSON-RPC over stdio (or WebSocket)",
            "Custom hosts that want fine-grained control of sessions",
            "session.resume",
            "prompt.submit",
            "session.steer",
            "session.interrupt",
            "session.usage",
            "approval.respond",
            "clarify.respond",
            "image.attach",
            "clarify.request",
            "custom desktop / web / TUI host and want every Hermes feature",
        ),
        "Hermes official custom-host Gateway docs",
    )
    require_tokens(
        hermes / "web" / "src" / "plugins" / "registry.ts",
        (
            "buildWsUrl",
            "buildWsAuthParam",
            "window.__HERMES_PLUGIN_SDK__",
            "Use this for any",
            "plugin WebSocket",
        ),
        "Hermes Dashboard Plugin WebSocket SDK",
    )
    require_tokens(
        hermes / "web" / "src" / "plugins" / "slots.ts",
        ('"header-left"', '"sidebar"', "registerSlot", "PluginSlot"),
        "Hermes Dashboard public slot registry",
    )
    require_tokens(
        hermes / "tui_gateway" / "methods_session.py",
        (
            '@method("session.resume")',
            "close_on_disconnect",
            '@method("session.usage")',
            '@method("session.context_breakdown")',
            "context_max",
            "context_percent",
            "context_used",
            "compute_session_context_breakdown",
        ),
        "Hermes Gateway Session/Context RPCs",
    )
    require_tokens(
        hermes / "tui_gateway" / "methods_prompt.py",
        (
            '@method("prompt.submit")',
            '@method("image.attach_bytes")',
            '@method("pdf.attach")',
            '@method("file.attach")',
            '@method("approval.respond")',
            '@method("clarify.respond")',
            '@method("mcp.setup.respond")',
            '@method("sudo.respond")',
            '@method("secret.respond")',
            '@method("terminal.read.respond")',
            "content_base64",
            "data_url",
            "ref_text",
        ),
        "Hermes Gateway prompt/attachment/input-response RPCs",
    )
    require_tokens(
        hermes / "apps" / "shared" / "src" / "json-rpc-gateway.ts",
        (
            "JsonRpcGatewayClient",
            "'todo.updated'",
            "'status.update'",
            "'approval.request'",
            "'clarify.request'",
            "'sudo.request'",
            "'secret.request'",
            "'message.delta'",
            "'message.complete'",
        ),
        "Hermes shared Gateway event contract",
    )
    require_tokens(
        hermes / "apps" / "desktop" / "src" / "plugins" / "hermes-bots" / "group-attachments.ts",
        (
            "kind === 'image'",
            "return 'pdf'",
            "return 'file'",
            "picker button",
            "composer paste handler",
            "room drag & drop",
        ),
        "Hermes official arbitrary attachment UI pipeline",
    )
    require_tokens(
        hermes / "apps" / "desktop" / "src" / "store" / "clarify.ts",
        ("skipClarifyRequest", "clarify.respond", "answer: ''"),
        "Hermes official clarify skip contract",
    )
    require_tokens(
        hermes / "apps" / "desktop" / "src" / "store" / "mcp-setup.ts",
        ("skipMcpSetupRequest", "mcp.setup.respond", "status: 'declined'"),
        "Hermes official MCP setup skip contract",
    )
    require_tokens(
        hermes / "ui-tui" / "src" / "app" / "useInputHandlers.ts",
        (
            "sudo.respond",
            "password: ''",
            "secret.respond",
            "value: ''",
        ),
        "Hermes official sudo/secret cancellation contract",
    )
    require_tokens(
        hermes / "apps" / "desktop" / "src" / "app" / "session" / "hooks" / "use-message-stream" / "gateway-event" / "status.ts",
        (
            "event.type === 'status.update'",
            "payload?.kind === 'compacting'",
            "payload?.kind === 'compacted'",
            "setSessionCompacting",
        ),
        "Hermes official Desktop compaction event projection",
    )

    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "features" / "api-server.md",
        (
            "GET /api/model/options",
            "GET /v1/capabilities",
            "POST /v1/runs",
            "GET /v1/runs/\\{run_id\\}",
            "GET /v1/runs/\\{run_id\\}/events",
            "POST /v1/runs/\\{run_id\\}/stop",
            "POST /v1/runs/\\{run_id\\}/approval",
            "GET /health/detailed",
            "model_options",
            "provider",
        ),
        "Hermes API Server docs",
    )
    require_any(
        hermes,
        "/steer",
        ("tests/**/*.py", "gateway/**/*.py", "hermes_cli/**/*.py", "website/docs/**/*.md"),
        "Hermes Runs steer",
    )

    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "features" / "delegation.md",
        ("delegation.model", "delegation.provider", "The `/review` Command", "auxiliary:", "review:"),
        "Hermes delegation/review docs",
    )
    public_config_globs = (
        "hermes_cli/**/*.py",
        "agent/**/*.py",
        "tools/**/*.py",
        "website/docs/**/*.md",
        "tests/**/*.py",
        "cli-config.yaml.example",
    )
    require_any(hermes, "reasoning_effort", public_config_globs, "Hermes delegation reasoning config")
    require_any(hermes, "subagent_auto_approve", public_config_globs, "Hermes subagent approval config")
    require_any(hermes, "auxiliary", public_config_globs, "Hermes auxiliary review config")

    product_globs = (
        "web/src/**/*.ts",
        "web/src/**/*.tsx",
        "apps/desktop/src/**/*.ts",
        "apps/desktop/src/**/*.tsx",
        "hermes_cli/**/*.py",
        "gateway/**/*.py",
        "tests/**/*.py",
    )
    for token, label in (
        ("/api/model/options", "Hermes canonical model inventory"),
        ("/api/config", "Hermes config API"),
        ("/api/providers/custom-endpoints", "Hermes Custom Endpoint API"),
        ("/api/sessions", "Hermes sessions API"),
        ("/messages", "Hermes session messages API"),
        ("/sessions/search", "Hermes session search API"),
    ):
        require_any(hermes, token, product_globs, label)

    require_any(hermes, "Hardline Blocklist", ("website/docs/**/*.md",), "Hermes hardline security docs")
    require_any(hermes, "approvals.mode: off", ("website/docs/**/*.md",), "Hermes no-prompt approval mode")
    require_any(hermes, "unattended_mode", ("website/docs/**/*.md", "tests/**/*.py", "hermes_cli/**/*.py"), "Hermes unattended approval contract")
    require_any(hermes, "mcp_reload_confirm", public_config_globs, "Hermes MCP approval contract")

    for required_test in (
        "tests/agent/test_subagent_lifecycle.py",
        "tests/gateway/test_api_server_runs.py",
        "tests/tools/test_approval.py",
        "tests/tui_gateway/test_todo_state_events.py",
        "tests/tui_gateway/test_attach_does_not_wait_for_agent.py",
        "tests/agent/test_context_breakdown.py",
    ):
        if not (hermes / required_test).is_file():
            fail(f"Hermes upstream behavior test disappeared: {required_test}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-root", required=True, type=pathlib.Path)
    args = parser.parse_args()
    hermes = args.hermes_root.resolve()
    if set(LOCK) != {"hermes"}:
        fail("tests/upstream-lock.json must contain only the Hermes runtime upstream")
    verify_hermes(hermes)

    if errors:
        print("Pinned Hermes verification FAILED:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    row = LOCK["hermes"]
    print("Pinned Hermes verification passed")
    print(f"  Hermes: {row['repository']}@{row['commit']} ({row['version']}, {row['channel']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
