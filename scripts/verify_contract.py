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
    "protocol-runtime.js",
    "gateway-native-core.js",
]
positions = [loader.find(name) for name in expected_layers]
if any(pos < 0 for pos in positions) or positions != sorted(positions):
    fail("Gateway-native source loader must install capability core/bridge/DOM and protocol runtime before the native Gateway core")
for token in ("script.async = false", "script.onload = () => load(index + 1)"):
    if token not in loader:
        fail(f"Gateway-native source loader lost deterministic sequencing token: {token}")

capability_core = read("dashboard/dist/model-capability-core.js")
capability_bridge = read("dashboard/dist/model-capability-bridge.js")
capability_dom = read("dashboard/dist/model-capability-dom.js")
protocol_runtime = read("dashboard/dist/protocol-runtime.js")
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
for token in (
    "/hermes/protocol-route",
    "/hermes/protocols/resolve",
    "/hermes/protocols/probe",
    "/hermes/model-probe",
    "requires_probe",
    "execution_provider",
    "heuristic: false",
    "first_use: true",
):
    if token not in protocol_runtime:
        fail(f"protocol runtime lost per-model dynamic routing contract token: {token}")

# Capability/protocol logic must stay generic. Provider/model names belong to
# Hermes' inventory payload and test fixtures, never production branching logic.
runtime_logic = capability_core + capability_bridge + capability_dom + protocol_runtime
for forbidden in ("minimax", "claude", "gemini", "gpt-", "grok", "deepseek", "kimi", "glm-"):
    if forbidden in runtime_logic.lower():
        fail(f"model capability/protocol layer reintroduced provider/model-name heuristic: {forbidden}")
for forbidden in ("API_SERVER_KEY", "HERMES_WORKER_STUDIO_API_KEY", "new AIAgent"):
    if forbidden in runtime_logic + loader:
        fail(f"model capability/protocol layer crossed sealed runtime/secret boundary: {forbidden}")

# The source loader is a maintainability seam only. The one supported installed
# artifact remains a single manifest entry, assembled deterministically in the
# same order so no extra browser dependency can be omitted by install/release.
installer = read("scripts/install.sh")
install_positions = [installer.find(f'"$ROOT/dashboard/dist/{name}"') for name in expected_layers]
if any(pos < 0 for pos in install_positions) or install_positions != sorted(install_positions):
    fail("installer must compose capability core/bridge/DOM and protocol runtime before native Gateway core")
if '> "$TMP/dashboard/dist/gateway-native.js"' not in installer:
    fail("installer must stage the capability/protocol/native composition into the single gateway-native.js artifact")

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

# npm exists only as a private frontend test harness. Seal correctness must not
# depend on a live third-party advisory endpoint: production npm dependency
# fields are forbidden, test dependencies are exact-pinned, install scripts are
# disabled in CI, and the committed lock root must match package.json exactly.
try:
    package = json.loads(read("package.json"))
except Exception as exc:
    package = {}
    fail(f"invalid package.json: {exc}")
if package.get("name") != "hermes-worker-studio-tests" or package.get("private") is not True:
    fail("root npm package must remain the private hermes-worker-studio-tests harness")
for field in ("dependencies", "optionalDependencies", "peerDependencies"):
    if package.get(field):
        fail(f"production npm dependency field must stay empty: {field}")
dev_dependencies = package.get("devDependencies") or {}
if not isinstance(dev_dependencies, dict) or not dev_dependencies:
    fail("frontend test harness must keep an explicit devDependency set")
else:
    for name, version in dev_dependencies.items():
        parts = str(version).split(".")
        if len(parts) != 3 or not all(part.isdigit() for part in parts):
            fail(f"test dependency must be exact x.y.z pin: {name}={version}")
try:
    package_lock = json.loads(read("package-lock.json"))
except Exception as exc:
    package_lock = {}
    fail(f"invalid package-lock.json: {exc}")
if package_lock.get("lockfileVersion") != 3:
    fail("package-lock.json must remain lockfileVersion 3")
lock_root = (package_lock.get("packages") or {}).get("") or {}
if lock_root.get("devDependencies") != dev_dependencies:
    fail("package-lock root devDependencies must exactly match package.json")

ci = read(".github/workflows/ci.yml")
for token in (
    "Test-only npm dependency boundary",
    "npm ci --ignore-scripts --no-fund --no-audit",
    "node --check dashboard/dist/protocol-runtime.js",
    "node --check tests/frontend_protocol_runtime.mjs",
    'python scripts/stage_security_closure.py "$tmp/plugin_api_v3.py"',
    '! grep -Fq "await request.json()" "$tmp/plugin_api_v3.py"',
    "scripts/stage_security_closure.py",
):
    if token not in ci:
        fail(f"canonical CI lost seal hardening gate: {token}")
if "npm audit" in ci:
    fail("canonical CI must not depend on the live npm advisory service")

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

print("Model capability/protocol loader/install/security architecture verification passed.")
