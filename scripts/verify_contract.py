#!/usr/bin/env python3
"""Archive/product contract gate with the model-capability loader projection.

The historical Product 3 verifier remains byte-stable in verify_contract_core.py.
The public manifest still enters through dashboard/dist/gateway-native.js; that
file is now a deterministic source loader whose final layer is the unchanged
native Gateway implementation in gateway-native-core.js. The supported install
artifact composes the same ordered layers into one staged gateway-native.js.
For historical checks, project the core implementation onto the entry path
temporarily, run every old assertion, then restore the loader.
"""
from __future__ import annotations

import json
import pathlib
import runpy

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENTRY = ROOT / "dashboard/dist/gateway-native.js"
CORE = ROOT / "dashboard/dist/gateway-native-core.js"
LEGACY = ROOT / "scripts/verify_contract_core.py"

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def read(path: str) -> str:
    target = ROOT / path
    if not target.is_file():
        fail(f"missing required file: {path}")
        return ""
    return target.read_text(encoding="utf-8")


manifest_text = read("dashboard/manifest.json")
try:
    manifest = json.loads(manifest_text)
except Exception as exc:
    manifest = {}
    fail(f"invalid dashboard/manifest.json: {exc}")
if manifest.get("entry") != "dist/gateway-native.js":
    fail("dashboard manifest must keep Gateway-native as the single browser entry")

loader = read("dashboard/dist/gateway-native.js")
expected_layers = [
    "model-capability-core.js",
    "model-capability-bridge.js",
    "model-capability-dom.js",
    "gateway-native-core.js",
]
positions = [loader.find(name) for name in expected_layers]
if any(pos < 0 for pos in positions) or positions != sorted(positions):
    fail("Gateway-native source loader must install capability core/bridge/DOM before the native Gateway core")
for token in ("script.async = false", "script.onload = () => load(index + 1)"):
    if token not in loader:
        fail(f"Gateway-native source loader lost deterministic sequencing token: {token}")

capability_core = read("dashboard/dist/model-capability-core.js")
capability_bridge = read("dashboard/dist/model-capability-bridge.js")
capability_dom = read("dashboard/dist/model-capability-dom.js")
for token in (
    "explicitDisable",
    "supported === true && canDisable === true",
    "validateReasoning",
    "does not explicitly allow disabling reasoning",
    "does not explicitly allow reasoning value",
):
    if token not in capability_core:
        fail(f"model capability core lost fail-closed contract token: {token}")
if "supported === true ? true : null" in capability_core:
    fail("model capability core must not infer can-disable from bare reasoning support")
for token in ("ensureModelOptions", "API.validateReasoning", "config.set", "session.resume", "source_route"):
    if token not in capability_bridge:
        fail(f"model capability bridge lost required runtime contract token: {token}")
for token in ("VERIFIER", "未公开独立 reasoning 写入契约", "hws3-moa-reasoning-capability"):
    if token not in capability_dom:
        fail(f"model capability DOM layer lost execution-plane closure token: {token}")

# Capability logic must stay generic. Provider/model names belong to Hermes'
# inventory payload, never Studio branching logic.
for forbidden in ("minimax", "claude", "gemini", "gpt-", "grok", "deepseek", "kimi", "glm-"):
    if forbidden in (capability_core + capability_bridge + capability_dom).lower():
        fail(f"model capability layer reintroduced provider/model-name heuristic: {forbidden}")
for forbidden in ("API_SERVER_KEY", "HERMES_WORKER_STUDIO_API_KEY", "new AIAgent"):
    if forbidden in capability_core + capability_bridge + capability_dom + loader:
        fail(f"model capability layer crossed sealed runtime/secret boundary: {forbidden}")

# The source loader is a maintainability seam only. The one supported installed
# artifact remains a single manifest entry, assembled deterministically in the
# same order so no extra browser dependency can be omitted by install/release.
installer = read("scripts/install.sh")
install_positions = [installer.find(f'"$ROOT/dashboard/dist/{name}"') for name in expected_layers]
if any(pos < 0 for pos in install_positions) or install_positions != sorted(install_positions):
    fail("installer must compose capability core/bridge/DOM before native Gateway core")
if '> "$TMP/dashboard/dist/gateway-native.js"' not in installer:
    fail("installer must stage the capability/native composition into the single gateway-native.js artifact")

# Local seal hardening is part of the supported artifact, not documentation-only
# guidance. Lock transform ordering, transaction rollback and post-swap validation.
security_transform = read("scripts/stage_security_closure.py")
for token in (
    "os.O_EXCL",
    "os.O_NOFOLLOW",
    "os.open(temporary, flags, 0o600)",
    "request body must contain valid JSON",
    "expected exactly seven staged request.json calls",
):
    if token not in security_transform:
        fail(f"staged security closure lost required token: {token}")

transform_order = [
    installer.find('stage_product_bundle.py" "$TMP/dashboard/dist/index-v3.js"'),
    installer.find('stage_mixed_protocol.py"'),
    installer.find('stage_security_closure.py" "$TMP/dashboard/plugin_api_v3.py"'),
]
if any(pos < 0 for pos in transform_order) or transform_order != sorted(transform_order):
    fail("installer must apply product, mixed-protocol and security transforms in canonical order")
for token in (
    "ROLLBACK_ARMED=1",
    "rollback_install",
    "atomic-exchange",
    'hermes plugins doctor "$DEST" --ci',
    "hermes plugins enable hermes-worker-studio",
):
    if token not in installer:
        fail(f"installer lost rollback/final validation contract token: {token}")
if installer.find('hermes plugins doctor "$DEST" --ci') > installer.find("hermes plugins enable hermes-worker-studio"):
    fail("installed-tree Plugin Doctor must run before official enable so validation failure remains rollback-safe")

ci = read(".github/workflows/ci.yml")
for token in (
    "High-severity frontend dependency audit",
    "npm audit --audit-level=high --ignore-scripts",
    'python scripts/stage_security_closure.py "$tmp/plugin_api_v3.py"',
    '! grep -Fq "await request.json()" "$tmp/plugin_api_v3.py"',
    "scripts/stage_security_closure.py",
):
    if token not in ci:
        fail(f"canonical CI lost seal hardening gate: {token}")

if errors:
    print("Model capability / seal-hardening architecture verification FAILED:")
    for error in errors:
        print(f"  - {error}")
    raise SystemExit(1)

if not CORE.is_file() or not LEGACY.is_file():
    raise SystemExit("missing immutable Gateway/contract core required by sealed loader architecture")

loader_bytes = ENTRY.read_bytes()
try:
    ENTRY.write_bytes(CORE.read_bytes())
    try:
        runpy.run_path(str(LEGACY), run_name="__main__")
    except SystemExit as exc:
        if exc.code not in (None, 0):
            raise
finally:
    ENTRY.write_bytes(loader_bytes)

print("Model capability loader/install/security architecture verification passed.")
