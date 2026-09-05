from __future__ import annotations

import importlib.util
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRANSFORM_SPEC = importlib.util.spec_from_file_location(
    "hws_stage_reasoning_gateway",
    ROOT / "scripts" / "stage_mixed_protocol.py",
)
assert TRANSFORM_SPEC and TRANSFORM_SPEC.loader
transform = importlib.util.module_from_spec(TRANSFORM_SPEC)
TRANSFORM_SPEC.loader.exec_module(transform)


class StagedReasoningGatewayTests(unittest.TestCase):
    def test_minimax_binary_capability_executes_as_toggle(self) -> None:
        node = shutil.which("node")
        if not node:
            self.skipTest("node is unavailable")

        source = (ROOT / "dashboard" / "dist" / "model-capability-core.js").read_text(encoding="utf-8")
        staged = transform.patch_gateway(source)
        runner = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.window = global;
global.document = { querySelector: () => ({}) };
window.__HERMES_PLUGIN_SDK__ = {
  React: { createElement() { return {}; } },
  fetchJSON: async () => ({}),
};
eval(fs.readFileSync(process.argv[2], 'utf8'));
const api = window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__;
assert.ok(api, 'staged capability API must install');
const options = {
  providers: [{
    slug: 'new-api',
    authenticated: true,
    models: ['opaque-thinking-model'],
    capabilities: { 'opaque-thinking-model': { reasoning: true } },
  }],
};
const config = {
  providers: {
    'new-api': {
      models: {
        'opaque-thinking-model': {
          hws_native_reasoning: 'minimax_openai',
          hws_reasoning: {
            supports_reasoning: true,
            can_disable_reasoning: false,
            reasoning_control: 'fixed',
            reasoning_efforts: ['high'],
          },
        },
      },
    },
  },
};
const enriched = api.enrichModelOptions(options, config);
const cap = enriched.providers[0].capabilities['opaque-thinking-model'];
const descriptor = api._internal.descriptor(enriched, 'new-api', 'opaque-thinking-model');
assert.equal(descriptor.supported, true);
assert.equal(descriptor.control, 'toggle');
assert.equal(descriptor.canDisable, true);
assert.equal(descriptor.source, 'hermes.provider_config.model+native.minimax_openai.binary');
assert.deepEqual(descriptor.efforts, []);
assert.deepEqual(cap.reasoning_efforts.map((row) => row.value), ['none', 'medium']);
assert.equal(api.reasoningLabel(descriptor), '开关');
const off = api.validateReasoning(enriched, 'new-api', 'opaque-thinking-model', 'none');
assert.equal(off.semantic, 'off');
const on = api.validateReasoning(enriched, 'new-api', 'opaque-thinking-model', 'medium');
assert.equal(on.semantic, 'on');
assert.throws(
  () => api.validateReasoning(enriched, 'new-api', 'opaque-thinking-model', 'high'),
  /does not explicitly allow reasoning value/,
);
"""
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            core = root / "model-capability-core.js"
            script = root / "runner.cjs"
            core.write_text(staged, encoding="utf-8")
            script.write_text(runner, encoding="utf-8")
            completed = subprocess.run(
                [node, str(script), str(core)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
