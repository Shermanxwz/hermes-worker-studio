# Upstream Contracts

Hermes Worker Studio 2.0 has **one runtime upstream**: `NousResearch/hermes-agent` at the exact revision in `tests/upstream-lock.json`.

The project consumes only documented/public Hermes contracts. If a required feature cannot be expressed through these surfaces, the preferred fix is an additive upstream public contract — never a Studio import of private internals.

## Dashboard extension

Required contract:

- Dashboard plugin manifest and `tab.override`;
- official plugin registry;
- `SDK.fetchJSON` / authenticated Dashboard API bridge;
- plugin backend mounted under Hermes plugin API namespace.

Studio overrides `/sessions` without patching Hermes Web.

## Plugin runtime

Required contract:

- manifest v2 / api v1;
- `PluginContext.register_tool`;
- `PluginContext.register_hook` with `pre_tool_call` policy directives;
- `PluginContext.get_config`;
- `PluginContext.subagent_lifecycle` public lifecycle service.

Required lifecycle operations: launch, status, wait, result and public `SubagentHandle` serialization. Studio never constructs `AIAgent` itself.

## Runs API

Required authenticated contracts:

- `GET /v1/capabilities`;
- `POST /v1/runs`;
- `GET /v1/runs/{run_id}`;
- `GET /v1/runs/{run_id}/events`;
- `POST /v1/runs/{run_id}/stop`;
- `POST /v1/runs/{run_id}/approval`;
- `POST /v1/runs/{run_id}/steer`.

Studio has no legacy execution fallback. If native Run submission is unavailable, execution fails closed rather than silently changing transport.

Run status is the source of truth; event projection is bounded UI state only.

## Model/provider contracts

Required contracts:

- `GET /api/model/options` and `?refresh=1`;
- Hermes model/session assignment API;
- `GET/POST /api/providers/custom-endpoints`;
- custom endpoint validation;
- request-scoped `provider`, `model`, `model_options` on `/v1/runs`.

Studio must never ship a second model registry. Missing reasoning effort metadata means `Auto`; no provider/model-name heuristics are allowed.

Worker routing uses Hermes `delegation.*`; review routing uses `auxiliary.review.*`.

## Sessions/history contracts

Required contracts:

- paginated `/api/sessions`;
- paginated `/api/sessions/{id}/messages`;
- `/api/sessions/search`;
- archive/unarchive and `archived` filtering.

Studio does not read Hermes persistence directly.

## Approvals/config

Required contract: Hermes `/api/config` read/write plus native approval implementation.

Studio unattended profile writes:

- `approvals.mode=off`;
- `cron_mode=approve`;
- `single_query_mode=approve`;
- `unattended_mode=approve`;
- `mcp_reload_confirm=false`;
- `destructive_slash_confirm=false`;
- `delegation.subagent_auto_approve=true`.

The Hardline Blocklist is an upstream invariant and remains non-overridable.

## Skills / Plugins / MCP / durable work

Studio treats Hermes as authoritative for Skills, Plugins and MCP and links to the native product surfaces rather than duplicating their state machines.

Long-lived durable multi-agent work should use Hermes Kanban + Profiles. Short child work uses public subagent lifecycle. Studio does not invent persistence/reconnect semantics for lifecycle children.

## Compatibility rule

A Hermes pin may move only when:

1. `scripts/verify_upstreams.py` succeeds against the exact checkout;
2. Studio CI succeeds;
3. Hermes own lifecycle/Runs/approval tests selected by CI succeed;
4. Plugin Doctor succeeds;
5. the archive checklist is re-run on the target machine.

No semver assumption substitutes for these semantic checks.
