from __future__ import annotations

import concurrent.futures
import copy
import importlib.util
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRANSFORM_SPEC = importlib.util.spec_from_file_location(
    "hws_stage_mixed_protocol",
    ROOT / "scripts" / "stage_mixed_protocol.py",
)
assert TRANSFORM_SPEC and TRANSFORM_SPEC.loader
transform = importlib.util.module_from_spec(TRANSFORM_SPEC)
TRANSFORM_SPEC.loader.exec_module(transform)


class MixedProtocolStageTransformTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.frontend_source = (ROOT / "dashboard" / "dist" / "index-v3.js").read_text(encoding="utf-8")
        cls.backend_source = (ROOT / "dashboard" / "plugin_api_v3.py").read_text(encoding="utf-8")
        cls.gateway_source = (ROOT / "dashboard" / "dist" / "model-capability-core.js").read_text(encoding="utf-8")
        cls.frontend = transform.patch_frontend(cls.frontend_source)
        cls.backend = transform.patch_backend(cls.backend_source)
        cls.gateway = transform.patch_gateway(cls.gateway_source)

    def test_backend_transform_is_syntax_valid_and_contains_lazy_resolver(self):
        compile(self.backend, "staged-plugin-api-v3.py", "exec")
        for token in (
            '@router.post("/hermes/protocols/resolve")',
            "_AUTO_PROTOCOL_PROBE_LOCKS",
            "_AUTO_PROTOCOL_RETRY_SECONDS",
            "_probe_protocols_sync(provider, model)",
            "with _auto_protocol_probe_lock(provider, model):",
            "_apply_native_reasoning_route",
            "_ensure_minimax_binary_alias",
            '"reasoning_state": "disabled"',
            'f"{adaptive_alias}-reasoning-off"',
            "_run_reasoning_effort(body)",
            '"probe": "first-use or explicit real Hermes /v1/runs for Chat Completions and Responses"',
            "不会按模型名猜测协议",
        ):
            self.assertIn(token, self.backend)
        self.assertNotIn(
            "请先到“模型”页面执行官方真实 Run 探测",
            self.backend,
            "first use must no longer require an operator pre-probe",
        )

    def test_frontend_transform_routes_reasoning_with_chat_worker_verifier(self):
        for token in (
            "resolveProtocolExecutionRoute",
            "'/hermes/protocols/resolve'",
            "reasoning_effort: normalized.effort || 'auto'",
            "native_reasoning: resolved?.native_reasoning || null",
            "sourceFacingProtocolRoute",
            "workerExecution.provider",
            "reviewExecution.provider",
            "首次实际使用会自动探测并缓存",
            "Worker / Verifier 路由已按模型真实协议写入 Hermes 官方配置",
        ):
            self.assertIn(token, self.frontend)
        self.assertNotIn(
            "请先进入“模型”页面点击“官方探测”",
            self.frontend,
            "chat send must resolve the protocol itself",
        )

    def test_staged_gateway_exposes_real_binary_toggle_not_fake_efforts(self):
        for token in (
            "control: 'toggle'",
            "can_disable: true",
            "cap.can_disable_reasoning = true",
            "native.minimax_openai.binary",
            "default_effort: HERMES_DEFAULT_EFFORT",
        ):
            self.assertIn(token, self.gateway)
        self.assertNotIn("control: 'fixed',\n      can_disable: false,\n      source: 'hermes.provider_config.model+native.minimax_openai'", self.gateway)

    def test_frontend_and_gateway_transforms_are_javascript_syntax_valid(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            frontend = root / "index-v3.js"
            gateway = root / "gateway-native.js"
            frontend.write_text(self.frontend, encoding="utf-8")
            gateway.write_text(self.gateway, encoding="utf-8")
            for target in (frontend, gateway):
                completed = subprocess.run(
                    [node, "--check", str(target)],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_transform_is_fail_closed_when_source_drift_removes_anchor(self):
        broken = self.backend_source.replace(
            "def _resolve_route_for_run(provider: str, model: str)",
            "def _renamed_route_for_run(provider: str, model: str)",
            1,
        )
        with self.assertRaises(SystemExit):
            transform.patch_backend(broken)
        broken_gateway = self.gateway_source.replace(
            "function applyNativeReasoningConstraint",
            "function renamedNativeReasoningConstraint",
            1,
        )
        with self.assertRaises(SystemExit):
            transform.patch_gateway(broken_gateway)

    def _load_staged_backend(self):
        directory = tempfile.TemporaryDirectory()
        root = pathlib.Path(directory.name)
        shutil.copy2(ROOT / "dashboard" / "plugin_api.py", root / "plugin_api.py")
        target = root / "plugin_api_v3.py"
        target.write_text(self.backend, encoding="utf-8")
        name = f"hws_staged_protocol_{time.time_ns()}"
        spec = importlib.util.spec_from_file_location(name, target)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            directory.cleanup()
            sys.modules.pop(name, None)
            raise
        self.addCleanup(directory.cleanup)
        self.addCleanup(sys.modules.pop, name, None)
        return module

    def test_first_use_probe_returns_responses_alias_without_name_heuristic(self):
        module = self._load_staged_backend()
        resolved = {
            "provider": "new-api",
            "model": "opaque-model-id",
            "mode": "codex_responses",
            "status": "resolved",
            "requires_probe": False,
            "execution_provider": "hws-protocol-test-responses",
        }
        unresolved = {
            "provider": "new-api",
            "model": "opaque-model-id",
            "status": "unresolved",
            "mode": "",
            "requires_probe": True,
            "execution_provider": "",
        }
        calls = {"probe": 0}

        def fake_probe(provider: str, model: str):
            self.assertEqual((provider, model), ("new-api", "opaque-model-id"))
            calls["probe"] += 1
            return {"ok": True, "status": "resolved", "route": dict(resolved), "results": {}}

        with patch.object(module, "_read_official_config", return_value={}), \
             patch.object(module, "_read_official_model_options", return_value={}), \
             patch.object(module, "_protocol_route_snapshot", return_value=unresolved), \
             patch.object(module, "_recent_failed_protocol_state", return_value=None), \
             patch.object(module, "_probe_protocols_sync", side_effect=fake_probe):
            route = module._resolve_route_for_run("new-api", "opaque-model-id")

        self.assertEqual(route["mode"], "codex_responses")
        self.assertEqual(route["execution_provider"], "hws-protocol-test-responses")
        self.assertEqual(calls["probe"], 1)

    def test_concurrent_first_use_spends_only_one_protocol_probe(self):
        module = self._load_staged_backend()
        probed = threading.Event()
        calls = {"probe": 0}
        calls_lock = threading.Lock()
        unresolved = {
            "provider": "new-api",
            "model": "model-x",
            "status": "unresolved",
            "mode": "",
            "requires_probe": True,
            "execution_provider": "",
        }
        resolved = {
            "provider": "new-api",
            "model": "model-x",
            "status": "resolved",
            "mode": "codex_responses",
            "requires_probe": False,
            "execution_provider": "hws-protocol-once-responses",
        }

        def snapshot(*_args, **_kwargs):
            return dict(resolved if probed.is_set() else unresolved)

        def probe(_provider: str, _model: str):
            with calls_lock:
                calls["probe"] += 1
            time.sleep(0.05)
            probed.set()
            return {"ok": True, "status": "resolved", "route": dict(resolved), "results": {}}

        with patch.object(module, "_read_official_config", return_value={}), \
             patch.object(module, "_read_official_model_options", return_value={}), \
             patch.object(module, "_protocol_route_snapshot", side_effect=snapshot), \
             patch.object(module, "_recent_failed_protocol_state", return_value=None), \
             patch.object(module, "_probe_protocols_sync", side_effect=probe):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                routes = list(pool.map(lambda _i: module._resolve_route_for_run("new-api", "model-x"), range(2)))

        self.assertEqual(calls["probe"], 1)
        self.assertTrue(all(route["execution_provider"] == "hws-protocol-once-responses" for route in routes))

    def test_minimax_binary_on_off_use_distinct_immutable_aliases(self):
        module = self._load_staged_backend()
        config = {
            "providers": {
                "new-api": {
                    "name": "New API",
                    "api": "https://newapi.invalid/v1",
                    "transport": "chat_completions",
                    "models": {
                        "opaque-thinking-model": {
                            "hws_native_reasoning": "minimax_openai",
                            "hws_reasoning": {
                                "supports_reasoning": True,
                                "can_disable_reasoning": True,
                                "reasoning_control": "toggle",
                            },
                        }
                    },
                }
            }
        }
        writes: list[dict] = []

        def proxy(path: str, method: str = "GET", body=None, **_kwargs):
            if path == "/api/config" and method == "PUT":
                writes.append(copy.deepcopy(body))
                return body
            return {}

        base_route = {
            "provider": "new-api",
            "model": "opaque-thinking-model",
            "mode": "chat_completions",
            "status": "declared",
            "requires_probe": False,
            "execution_provider": "new-api",
        }
        with patch.object(module, "_read_official_config", side_effect=lambda: config), \
             patch.object(module._legacy, "_hermes_proxy", side_effect=proxy):
            on_route = module._apply_native_reasoning_route(
                dict(base_route), "new-api", "opaque-thinking-model", "medium"
            )
            adaptive_alias = on_route["execution_provider"]
            adaptive_before = copy.deepcopy(config["providers"][adaptive_alias])
            off_route = module._apply_native_reasoning_route(
                dict(base_route), "new-api", "opaque-thinking-model", "none"
            )
            disabled_alias = off_route["execution_provider"]
            adaptive_after = copy.deepcopy(config["providers"][adaptive_alias])

        self.assertNotEqual(adaptive_alias, disabled_alias)
        self.assertTrue(disabled_alias.endswith("-reasoning-off"))
        self.assertEqual(on_route["native_reasoning"], "adaptive")
        self.assertEqual(off_route["native_reasoning"], "disabled")
        self.assertEqual(adaptive_before, adaptive_after, "creating the off alias must never mutate adaptive state")
        self.assertEqual(adaptive_after["extra_body"]["thinking"], {"type": "adaptive"})
        self.assertEqual(config["providers"][disabled_alias]["extra_body"]["thinking"], {"type": "disabled"})
        self.assertEqual(config["providers"][disabled_alias]["extra_body"]["reasoning_split"], True)
        self.assertEqual(config["providers"][disabled_alias]["hws_protocol_bridge"]["source_provider"], "new-api")
        self.assertEqual(config["providers"][disabled_alias]["hws_protocol_bridge"]["reasoning_state"], "disabled")
        self.assertGreaterEqual(len(writes), 2)

    def test_minimax_binary_concurrent_on_off_cannot_cross_mutate(self):
        module = self._load_staged_backend()
        config = {
            "providers": {
                "new-api": {
                    "api": "https://newapi.invalid/v1",
                    "transport": "chat_completions",
                    "models": {"model-y": {"hws_native_reasoning": "minimax_openai"}},
                }
            }
        }
        route = {
            "provider": "new-api",
            "model": "model-y",
            "mode": "chat_completions",
            "status": "declared",
            "requires_probe": False,
            "execution_provider": "new-api",
        }
        with patch.object(module, "_read_official_config", side_effect=lambda: config), \
             patch.object(module._legacy, "_hermes_proxy", return_value={}):
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(
                    lambda effort: module._apply_native_reasoning_route(dict(route), "new-api", "model-y", effort),
                    ["medium", "none"] * 8,
                ))

        adaptive = {row["execution_provider"] for row in results if row["native_reasoning"] == "adaptive"}
        disabled = {row["execution_provider"] for row in results if row["native_reasoning"] == "disabled"}
        self.assertEqual(len(adaptive), 1)
        self.assertEqual(len(disabled), 1)
        self.assertNotEqual(adaptive, disabled)
        adaptive_alias = next(iter(adaptive))
        disabled_alias = next(iter(disabled))
        self.assertEqual(config["providers"][adaptive_alias]["extra_body"]["thinking"], {"type": "adaptive"})
        self.assertEqual(config["providers"][disabled_alias]["extra_body"]["thinking"], {"type": "disabled"})

    def test_minimax_binary_rejects_fake_effort_and_non_chat_route(self):
        module = self._load_staged_backend()
        config = {
            "providers": {
                "new-api": {
                    "api": "https://newapi.invalid/v1",
                    "transport": "chat_completions",
                    "models": {"model-z": {"hws_native_reasoning": "minimax_openai"}},
                }
            }
        }
        with patch.object(module, "_read_official_config", side_effect=lambda: config):
            with self.assertRaises(HTTPException) as fake_effort:
                module._apply_native_reasoning_route(
                    {"mode": "chat_completions"}, "new-api", "model-z", "high"
                )
            with self.assertRaises(HTTPException) as wrong_protocol:
                module._apply_native_reasoning_route(
                    {"mode": "codex_responses"}, "new-api", "model-z", "none"
                )
        self.assertEqual(fake_effort.exception.status_code, 422)
        self.assertEqual(wrong_protocol.exception.status_code, 409)

    def test_ambiguous_real_probe_remains_fail_closed(self):
        module = self._load_staged_backend()
        ambiguous = {
            "provider": "new-api",
            "model": "model-both",
            "status": "ambiguous",
            "mode": "",
            "requires_probe": True,
            "requires_choice": True,
            "execution_provider": "",
        }
        with patch.object(module, "_read_official_config", return_value={}), \
             patch.object(module, "_read_official_model_options", return_value={}), \
             patch.object(module, "_protocol_route_snapshot", return_value=ambiguous), \
             patch.object(module, "_probe_protocols_sync") as probe:
            with self.assertRaises(HTTPException) as raised:
                module._resolve_route_for_run("new-api", "model-both")
        self.assertEqual(raised.exception.status_code, 409)
        probe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
