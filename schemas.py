"""Schemas for Hermes Worker Studio's public, Hermes-native tool surface."""

WORKER_DELEGATE = {
    "name": "worker_delegate",
    "description": (
        "Launch a fresh Hermes child agent through the documented public subagent "
        "lifecycle API. This tool never starts Codex, a sidecar Worker server, or a "
        "private AIAgent implementation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "task": {"type": "string", "description": "Self-contained goal for the child Hermes agent."},
            "context": {"type": "string", "description": "Optional focused context for the child."},
            "role": {
                "type": "string",
                "enum": ["worker", "verifier"],
                "description": "Product role. Both map to an isolated Hermes leaf child; verifier receives an independent-review brief.",
            },
            "model": {"type": "string", "description": "Optional Hermes model override supported by SubagentLaunchRequest."},
            "allowed_toolsets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional narrowing of the parent's Hermes toolsets. It can never broaden parent authority.",
            },
            "correlation_id": {"type": "string", "description": "Optional caller-owned idempotency/correlation key for this parent session."},
            "wait_for_completion": {"type": "boolean", "description": "Wait for a terminal child result before returning. Default false."},
            "wait_timeout_seconds": {"type": "number", "description": "Maximum time to wait in this tool call. It does not impose a child execution timeout."},
        },
        "required": ["task"],
    },
}

WORKER_STATUS = {
    "name": "worker_status",
    "description": (
        "Read status/result for a Hermes child launched by worker_delegate. Pass the "
        "opaque handle returned by worker_delegate, or task_id while the current "
        "Hermes process still retains that handle."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "handle": {"type": "object", "description": "Serialized public SubagentHandle returned by worker_delegate."},
            "task_id": {"type": "string", "description": "Convenience lookup for a handle retained in this process."},
            "wait_timeout_seconds": {"type": "number", "description": "Optional bounded wait before returning the latest status."},
        },
    },
}

WORKER_CATALOG = {
    "name": "worker_catalog",
    "description": (
        "Return Studio policy plus the Hermes-native delegation contract. Model/provider "
        "catalogs are intentionally not duplicated here; use Hermes /api/model/options."
    ),
    "parameters": {"type": "object", "properties": {}},
}
