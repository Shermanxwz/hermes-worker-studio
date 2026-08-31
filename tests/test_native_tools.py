from __future__ import annotations

import dataclasses
import importlib.util
import json
import pathlib
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


@dataclasses.dataclass(frozen=True)
class FakeLaunchRequest:
    goal: str
    context: str | None = None
    role: str = "leaf"
    model: str | None = None
    allowed_toolsets: tuple[str, ...] | None = None
    blocked_tools: tuple[str, ...] = ()
    working_directory: str | None = None
    parent_session_id: str | None = None
    correlation_id: str | None = None
    metadata: dict = dataclasses.field(default_factory=dict)
    timeout_seconds: float | None = None


@dataclasses.dataclass(frozen=True)
class FakeHandle:
    subagent_id: str
    parent_session_id: str = "parent-1"
    capability: str = "opaque"

    def to_dict(self):
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, value):
        return cls(**value)


agent_mod = types.ModuleType("agent")
lifecycle_mod = types.ModuleType("agent.subagent_lifecycle")
lifecycle_mod.SubagentLaunchRequest = FakeLaunchRequest
lifecycle_mod.SubagentHandle = FakeHandle
sys.modules.setdefault("agent", agent_mod)
sys.modules["agent.subagent_lifecycle"] = lifecycle_mod

SPEC = importlib.util.spec_from_file_location("hws_native_tools", ROOT / "tools.py")
assert SPEC and SPEC.loader
tools = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tools)


class FakeService:
    def __init__(self):
        self.requests = []
        self.handles = {}
        self.waits = []

    def launch(self, request):
        self.requests.append(request)
        handle = FakeHandle(f"child-{len(self.requests)}")
        self.handles[handle.subagent_id] = handle
        return handle

    def status(self, handle):
        return {"state": "RUNNING", "subagent_id": handle.subagent_id}

    def wait(self, handle, timeout_seconds=None):
        self.waits.append((handle.subagent_id, timeout_seconds))
        return {"state": "SUCCEEDED", "completed": True, "timed_out": False}

    def result(self, handle):
        return {"ready": True, "terminal_state": "SUCCEEDED", "summary": f"done:{handle.subagent_id}"}


class FakeContext:
    def __init__(self, mode="AUTO"):
        self.mode = mode
        self.subagent_lifecycle = FakeService()

    def get_config(self, key, default=None):
        if key == "mode":
            return self.mode
        return default


class NativeToolsTests(unittest.TestCase):
    def setUp(self):
        self.ctx = FakeContext("AUTO")
        tools.bind_context(self.ctx)
        with tools._HANDLES_LOCK:
            tools._HANDLES.clear()

    def test_auto_launches_only_public_hermes_lifecycle(self):
        payload = json.loads(tools.worker_delegate({
            "task": "implement feature",
            "context": "repo context",
            "model": "provider/model",
            "allowed_toolsets": ["file", "terminal"],
            "correlation_id": "corr-1",
        }))
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["transport"], "hermes_subagent_lifecycle_v1")
        self.assertEqual(payload["task_id"], "child-1")
        request = self.ctx.subagent_lifecycle.requests[0]
        self.assertEqual(request.goal, "implement feature")
        self.assertEqual(request.context, "repo context")
        self.assertEqual(request.role, "leaf")
        self.assertEqual(request.model, "provider/model")
        self.assertEqual(request.allowed_toolsets, ("file", "terminal"))
        self.assertEqual(request.correlation_id, "corr-1")
        self.assertEqual(request.metadata, {"studio_role": "worker"})
        self.assertIsNone(request.working_directory)
        self.assertIsNone(request.timeout_seconds)

    def test_verifier_is_independent_leaf_brief_not_private_runtime(self):
        payload = json.loads(tools.worker_delegate({"task": "verify change", "role": "verifier", "context": "diff"}))
        self.assertTrue(payload["ok"])
        request = self.ctx.subagent_lifecycle.requests[0]
        self.assertEqual(request.role, "leaf")
        self.assertEqual(request.metadata["studio_role"], "verifier")
        self.assertIn("independent verifier", request.context)
        self.assertIn("diff", request.context)

    def test_wait_is_a_wait_only_and_does_not_set_child_timeout(self):
        payload = json.loads(tools.worker_delegate({
            "task": "long job",
            "wait_for_completion": True,
            "wait_timeout_seconds": 12.5,
        }))
        self.assertTrue(payload["ok"])
        self.assertEqual(self.ctx.subagent_lifecycle.waits, [("child-1", 12.5)])
        self.assertEqual(payload["result"]["terminal_state"], "SUCCEEDED")
        self.assertIsNone(self.ctx.subagent_lifecycle.requests[0].timeout_seconds)

    def test_status_accepts_retained_task_id_or_serialized_handle(self):
        started = json.loads(tools.worker_delegate({"task": "check"}))
        by_id = json.loads(tools.worker_status({"task_id": started["task_id"]}))
        by_handle = json.loads(tools.worker_status({"handle": started["handle"], "wait_timeout_seconds": 1}))
        self.assertTrue(by_id["ok"])
        self.assertTrue(by_handle["ok"])
        self.assertEqual(by_id["task_id"], "child-1")
        self.assertEqual(by_handle["result"]["summary"], "done:child-1")

    def test_official_leaves_delegation_to_native_delegate_task(self):
        self.ctx.mode = "OFFICIAL"
        payload = json.loads(tools.worker_delegate({"task": "do not launch"}))
        self.assertFalse(payload["ok"])
        self.assertEqual(self.ctx.subagent_lifecycle.requests, [])
        self.assertIsNone(tools.policy_pre_tool_call("delegate_task", {}))
        directive = tools.policy_pre_tool_call("worker_delegate", {})
        self.assertEqual(directive["action"], "block")

    def test_main_fails_closed_at_public_pre_tool_policy_boundary(self):
        self.ctx.mode = "MAIN"
        for name in ("delegate_task", "worker_delegate"):
            directive = tools.policy_pre_tool_call(name, {})
            self.assertEqual(directive["action"], "block")
            self.assertIn("MAIN", directive["message"])
        payload = json.loads(tools.worker_delegate({"task": "must not launch"}))
        self.assertFalse(payload["ok"])
        self.assertEqual(self.ctx.subagent_lifecycle.requests, [])

    def test_delegate_alias_and_unknown_mode_policy(self):
        self.ctx.mode = "WORKER"
        allowed = json.loads(tools.worker_delegate({"task": "go"}))
        self.assertTrue(allowed["ok"])
        self.assertEqual(allowed["mode"], "DELEGATE")

        self.ctx.mode = "MYSTERY"
        catalog = json.loads(tools.worker_catalog({}))
        self.assertEqual(catalog["mode"], "MAIN")
        self.assertFalse(catalog["delegation_allowed"])

    def test_catalog_points_to_hermes_as_single_source_of_truth(self):
        catalog = json.loads(tools.worker_catalog({}))
        self.assertTrue(catalog["ok"])
        self.assertEqual(catalog["execution"], "PluginContext.subagent_lifecycle")
        self.assertEqual(catalog["model_catalog"], "/api/model/options")
        self.assertIn("delegation.*", catalog["worker_configuration"])
        self.assertNotIn("codex", json.dumps(catalog).lower())

    def test_validation_errors_are_structured(self):
        self.assertFalse(json.loads(tools.worker_delegate({}))["ok"])
        self.assertFalse(json.loads(tools.worker_delegate({"task": "x", "role": "unknown"}))["ok"])
        self.assertFalse(json.loads(tools.worker_status({}))["ok"])
        self.assertFalse(json.loads(tools.worker_delegate({"task": "x", "wait_timeout_seconds": -1}))["ok"])


if __name__ == "__main__":
    unittest.main()
