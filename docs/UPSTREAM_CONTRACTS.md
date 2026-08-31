# Upstream Contracts

This document is the maintenance boundary. If a future upstream release changes internals but the contracts below still work, **do not modify Worker Studio**.

## Hermes Dashboard Plugin contract

Source: Hermes' documented Web Dashboard extension system.

Used surfaces:

- `~/.hermes/plugins/<plugin>/dashboard/manifest.json`
- `tab.override: "/sessions"`
- prebuilt IIFE entry bundle
- optional plugin CSS
- `dashboard/plugin_api.py` FastAPI router
- routes mounted below `/api/plugins/<plugin-name>/`
- `window.__HERMES_PLUGIN_SDK__`
- `SDK.React`, `SDK.hooks`, `SDK.fetchJSON`
- `window.__HERMES_PLUGINS__.register(name, component)`

Worker Studio intentionally does not import Hermes' React source modules or depend on generated bundle chunk names.

## Hermes Dashboard REST contracts

The browser uses these official dashboard routes directly through `SDK.fetchJSON`:

| Contract | Use |
|---|---|
| `GET /api/sessions?limit=&offset=&order=&archived=` | recent/full/archive lists |
| `GET /api/sessions/{id}/messages?limit=&offset=&order=` | transcript tail and pages |
| `GET /api/sessions/search?q=&limit=` | FTS session/message search |
| `PATCH /api/sessions/{id}` | archive/unarchive |
| `GET /api/config` | read approval configuration |
| `PUT /api/config` | save official unattended configuration |
| `GET /api/providers/custom-endpoints` | find the Studio New API endpoint |
| `POST /api/providers/custom-endpoints/validate` | validate New API with Hermes provider logic |
| `POST /api/providers/custom-endpoints` | create/update the Hermes Custom Endpoint |

No direct `state.db` access is permitted in this repository.

## Hermes API Server contracts

Server-side bridge only. Bearer auth is supplied from `HERMES_WORKER_STUDIO_API_KEY` or `API_SERVER_KEY`.

| Contract | Use |
|---|---|
| `GET /health` | health |
| `GET /v1/capabilities` | runtime contract discovery/diagnostics |
| `GET /api/model/options` | Hermes-aware provider/model mapping |
| `POST /api/sessions` | create persisted conversation |
| `POST /api/sessions/{id}/model` | confirmed session runtime lock when provider can be resolved |
| `POST /api/sessions/{id}/chat/stream` | actual conversation turn + lifecycle SSE |

Expected stream event families include `assistant.delta`, `tool.started`, `tool.completed`, and `run.completed`. Unknown future events are retained and displayed generically rather than dropped.

A missing `run.completed` is not interpreted as success.

## Hermes approval contract

Only documented keys are written:

- `approvals.mode = off`
- `approvals.cron_mode = approve`
- `approvals.single_query_mode = approve`
- `approvals.unattended_mode = approve`
- `approvals.mcp_reload_confirm = false`
- `approvals.destructive_slash_confirm = false`

The hardline blocklist is upstream-owned and remains in force.

## Hermes model capability contract

`/api/model/options` is treated as a provider/model inventory, not as a hard-coded provider list. Worker Studio uses:

- provider `slug`
- `authenticated`
- `models[]`
- `is_current`
- `is_user_defined`
- `api_url`
- aliases when available

If these fields cannot uniquely resolve the selected Worker route to an actual Hermes provider, Studio does not guess.

## codex-worker-delegation contracts

Worker Studio only calls its public HTTP control surface:

| Contract | Use |
|---|---|
| `GET /api/health` | health |
| `GET /api/state` | persisted mode/provider/routing state |
| `GET /api/catalog` | actual model/capability registry |
| `PUT /api/provider` | save New API credentials/config |
| `POST /api/provider/probe` | upstream connectivity probe |
| `POST /api/provider/connectivity` | per-model real request test |
| `PUT /api/mode` | OFFICIAL/AUTO/DELEGATE/MAIN |
| `PUT /api/routing` | Main/Worker/Verifier route configuration |
| `POST /api/codex/install` | official Codex integration install |
| `POST /api/verify/coexistence` | coexistence verification |
| `POST /api/worker/start` | async worker task |
| `POST /api/worker/run` | synchronous worker task for native tool calls |
| `GET /api/worker/status/{task_id}` | real Worker progress/state |

The native Hermes plugin tools call the same endpoints. There is no second Worker implementation in this repository.

## Worker model/capability rules

The Worker registry is authoritative for route editing. The UI consumes actual model rows from:

```text
catalog.registry.providers.<provider>.models
```

Reasoning values are read from model capability metadata. `Auto` is the only locally defined sentinel. A model that advertises no effort levels gets a disabled one-position slider labelled Auto.

## Version negotiation and failure rule

Worker Studio prefers capability/shape detection over version string branching.

When an upstream contract is missing:

1. Keep unrelated surfaces working.
2. Display the exact failing feature boundary.
3. Do not substitute a private database/internal import.
4. Do not fabricate models, reasoning levels, tool events, or success states.
5. Add a compatibility adapter only when the replacement is itself documented/stable.

## Forbidden dependencies

A sealed release must not add any of the following without an explicit architecture revision:

- direct SQLite access to Hermes or Worker databases;
- imports from `hermes_state` or Hermes private Web components;
- scraping Hermes/Codex terminal output to infer runtime state when an API exists;
- browser storage of upstream API bearer keys;
- a locally maintained model list;
- a locally maintained reasoning-effort ladder;
- patched files inside the Hermes installation;
- patched files inside codex-worker-delegation.

`scripts/verify_contract.py` enforces a subset of these mechanically.
