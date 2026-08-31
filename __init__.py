"""Hermes Worker Studio native plugin registration."""
from . import schemas, tools


def register(ctx):
    tools.bind_context(ctx)
    ctx.register_tool(
        name="worker_delegate",
        toolset="worker-studio",
        schema=schemas.WORKER_DELEGATE,
        handler=tools.worker_delegate,
    )
    ctx.register_tool(
        name="worker_status",
        toolset="worker-studio",
        schema=schemas.WORKER_STATUS,
        handler=tools.worker_status,
    )
    ctx.register_tool(
        name="worker_catalog",
        toolset="worker-studio",
        schema=schemas.WORKER_CATALOG,
        handler=tools.worker_catalog,
    )
    ctx.register_hook("pre_tool_call", tools.policy_pre_tool_call)
