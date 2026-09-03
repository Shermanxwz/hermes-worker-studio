#!/usr/bin/env python3
"""Archive/product contract gate with the model-capability loader projection.

The historical Product 3 verifier remains byte-stable in verify_contract_core.py.
The public manifest still enters through dashboard/dist/gateway-native.js; that
file is now a deterministic loader whose final layer is the unchanged native
Gateway implementation in gateway-native-core.js.  For the historical checks,
project the core implementation onto the entry path temporarily, run every old
assertion, then restore the loader.  New capability-layer invariants are checked
here before that projection.
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
    fail("Gateway-native loader must install capability core/bridge/DOM before the native Gateway core")
for token in ("script.async = false", "script.onload = () => load(index + 1)"):
    if token not in loader:
        fail(f"Gateway-native loader lost deterministic sequencing token: {token}")

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

if errors:
    print("Model capability architecture verification FAILED:")
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

print("Model capability loader architecture verification passed.")
