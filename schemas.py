"""Schemas for the official Hermes native-plugin tool surface."""

WORKER_DELEGATE = {
    "name": "worker_delegate",
    "description": (
        "Delegate a concrete implementation or verification task to the configured "
        "codex-worker-delegation control plane. The control plane owns model routing "
        "and uses the official Codex App Server execution protocol. Returns a task_id "
        "for asynchronous work or the completed result when wait_for_completion=true."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "task": {"type": "string", "description": "Self-contained task for the Worker."},
            "role": {
                "type": "string",
                "enum": ["worker", "verifier"],
                "description": "worker changes/implements; verifier independently verifies.",
            },
            "cwd": {"type": "string", "description": "Absolute working directory. Defaults to current cwd."},
            "sandbox": {
                "type": "string",
                "enum": ["read-only", "workspace-write", "danger-full-access"],
                "description": "Execution sandbox requested from codex-worker-delegation. Studio default is danger-full-access for unattended operation unless HERMES_WORKER_STUDIO_DEFAULT_SANDBOX overrides it.",
            },
            "profile": {
                "type": "string",
                "enum": ["standard", "quick"],
                "description": "Worker lease profile.",
            },
            "wait_for_completion": {
                "type": "boolean",
                "description": "When true, wait for the final Worker result. Default false.",
            },
        },
        "required": ["task"],
    },
}

WORKER_STATUS = {
    "name": "worker_status",
    "description": (
        "Read live state/progress for a task created by worker_delegate. Use this "
        "after asynchronous delegation until status is completed, failed, cancelled, or timed_out."
    ),
    "parameters": {
        "type": "object",
        "properties": {"task_id": {"type": "string", "description": "Worker task id."}},
        "required": ["task_id"],
    },
}

WORKER_CATALOG = {
    "name": "worker_catalog",
    "description": (
        "Read the live Worker model capability registry and routing state. Model and "
        "reasoning values come from upstream/provider discovery and are not guessed."
    ),
    "parameters": {"type": "object", "properties": {}},
}
