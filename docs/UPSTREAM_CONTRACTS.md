# Upstream Contracts

Hermes Worker Studio 2.0 has **one runtime upstream**: `NousResearch/hermes-agent` at the exact revision in `tests/upstream-lock.json`.

The project consumes only documented/public Hermes contracts. If a required feature cannot be expressed through these surfaces, the preferred fix is an additive upstream public contract — never a Studio import of private internals.

## Dashboard extension

Required contract:

- Dashboard plugin manifest and `tab.override`;
- route-scoped exclusive-shell contract when available (currently missing from the pinned revision; local fallback remains explicitly non-sealing);
- official plugin registry;
- `SDK.fetchJSON` / authenticated Dashboard API bridge;
- plugin backend mounted under Hermes plugin API namespace.

Studio overrides `/` without patching Hermes Web and enters native `/sessions` directly for all Hermes navigation.

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
- Hermes Gateway session-scoped `config.set` for live reasoning state (`none` = thinking disabled, concrete accepted value = thinking enabled according to Hermes/provider semantics);
- `GET/POST /api/providers/custom-endpoints`;
- custom endpoint validation;
- request-scoped `provider`, `model`, `model_options` on `/v1/runs`;
- Hermes `delegation.*` for Worker routing/reasoning;
- Hermes `auxiliary.review.*` for review routing;
- Hermes `/api/model/moa` per-slot `reasoning_effort` for MOA References/Aggregator.

Studio must never ship a second model registry. Model capability is resolved from Provider + Model + effective Hermes route/protocol, never from a model-name heuristic.

Reasoning is treated as a capability descriptor, not merely a strength slider. Studio consumes additive public metadata when present (for example `reasoning.supported`, `reasoning.control`, `reasoning.can_disable`, `reasoning.options`/`efforts`, `can_disable_reasoning`, and compatible existing aliases). The normalized controls are unsupported, toggle-only, effort-only, toggle+effort, fixed/mandatory, or Auto.

Missing metadata does **not** authorize Studio to invent either a control or a strength vocabulary. Bare `reasoning: true` proves support only and remains Auto/read-only. A Thinking toggle requires an explicit public disable capability (`can_disable_reasoning=true` or equivalent explicit control). A strength selector appears only when an upstream public field supplies the accepted effort vocabulary. `none` is an off state, not a strength.

Every non-Auto Main or locally changed MOA reasoning override must be validated against the current normalized Hermes capability before it reaches Gateway `config.set` or `/api/model/moa`. Invalid off/effort values fail closed. Existing official MoA preset values are preserved unless the user changes them through Studio.

If one execution plane lacks a public write contract, Studio renders the capability read-only rather than persisting an inert value. The pinned `/review` resolver currently has this boundary for independent reasoning configuration. See `MODEL_CAPABILITY_SEAL.md`.

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
2. Studio CI succeeds, including the model-capability closure test;
3. Hermes own lifecycle/Runs/approval tests selected by CI succeed;
4. Plugin Doctor succeeds;
5. the archive checklist is re-run on the target machine.

No semver assumption substitutes for these semantic checks.
