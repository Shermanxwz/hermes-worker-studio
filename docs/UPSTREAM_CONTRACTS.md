# Upstream Contracts

This document is the maintenance boundary for a sealed Worker Studio release. If upstream internals move but these documented/public contracts still pass, **do not couple Studio to private implementation details**.

## Exact compatibility lock

`tests/upstream-lock.json` is authoritative.

- Hermes Agent `0.20.6`, pinned post-release snapshot `4f22543509d1b91dc45bcb369447126c5eb14fb7`.
- Recorded official release lineage: `v2026.8.27` / `5fc308a70719a83cccdbba4c0e39c23f5a8239d5`.
- codex-worker-delegation `3.2.0`, pinned `e965517e5bddeda57f5bc2b015a817279ea8e6e5`.

The Hermes pin is intentionally disclosed as a post-release snapshot because the seal depends on the native Runs control surface plus post-release API-server unattended approval classification. CI verifies the release commit is a real ancestor of the snapshot.

## Hermes Dashboard Plugin SDK

Used public surfaces:

- `~/.hermes/plugins/<plugin>/dashboard/manifest.json`
- `tab.override: "/sessions"`
- prebuilt IIFE entry bundle + optional CSS
- `dashboard/plugin_api.py` router under `/api/plugins/<plugin-name>/`
- `window.__HERMES_PLUGIN_SDK__`
- `SDK.React`, `SDK.hooks`, `SDK.fetchJSON`
- `window.__HERMES_PLUGINS__.register(name, component)`

Studio does not import Hermes private React modules or depend on generated chunk names.

## Hermes Dashboard REST

Browser-side official routes include:

| Contract | Use |
|---|---|
| `GET /api/sessions?limit=&offset=&order=&archived=` | recent/full/archive lists |
| `GET /api/sessions/{id}/messages?...` | transcript tail/pages |
| `GET /api/sessions/search?q=&limit=` | official FTS search |
| `PATCH /api/sessions/{id}` | archive/unarchive |
| `GET /api/config` / `PUT /api/config` | approval config read/write |
| `GET /api/skills` | authoritative Skills inventory/native Skills UI |
| Custom Endpoint REST | register/validate New API with Hermes provider logic |

Direct Hermes SQLite/state.db access is forbidden.

## Hermes API Server — native Runs is primary

Server-side bridge only; bearer auth is resolved from `HERMES_WORKER_STUDIO_API_KEY` or `API_SERVER_KEY`.

| Contract | Use |
|---|---|
| `GET /health` | liveness |
| `GET /health/detailed` | bounded readiness |
| `GET /v1/capabilities` | feature discovery |
| `GET /api/model/options` | Hermes provider/model inventory |
| `POST /api/sessions` | persisted conversation |
| `POST /api/sessions/{id}/model` | model lock only after unique provider resolution |
| `POST /v1/runs` | authoritative turn submission |
| `GET /v1/runs/{run_id}` | authoritative run status/output/usage |
| `GET /v1/runs/{run_id}/events` | lifecycle/tool/subagent SSE |
| `POST /v1/runs/{run_id}/stop` | interrupt |
| `POST /v1/runs/{run_id}/approval` | resolve pending approval |
| `POST /v1/runs/{run_id}/steer` | inject guidance into an active run |

Legacy `POST /api/sessions/{id}/chat/stream` is compatibility-only. Studio may use it **only** when `/v1/capabilities` explicitly lacks native run submission. A native Runs error is never silently replayed through legacy chat.

Unknown SSE events are retained generically. Hermes `/v1/runs/{id}` remains terminal truth; an event-stream EOF does not manufacture a terminal state.

## Hermes approval/unattended contract

Only upstream-supported keys are written:

- `approvals.mode = off`
- `approvals.cron_mode = approve`
- `approvals.single_query_mode = approve`
- `approvals.unattended_mode = approve`
- `approvals.mcp_reload_confirm = false`
- `approvals.destructive_slash_confirm = false`

Target seal requires config read-back plus Studio's real Hermes `/hermes/unattended/probe`. The probe starts a native Hermes Run and verifies a harmless marker command completed through Hermes itself. The hardline blocklist is upstream-owned and remains mandatory.

## Hermes model boundary

Hermes root-agent model resolution comes from `/api/model/options`, not Worker catalog imitation. Studio consumes provider slug/auth/model/current/user-defined/API URL data only when it can uniquely map an intended model to an actual Hermes provider. Otherwise it does not guess.

In `OFFICIAL`, Studio sends no custom model/provider lock and leaves Hermes defaults untouched.

## Worker four-mode contract

Worker Studio follows the pinned Worker README semantics exactly:

| UI | Wire | Project Worker delegation |
|---|---|---:|
| OFFICIAL | OFFICIAL | forbidden |
| AUTO | AUTO | allowed |
| WORKER | DELEGATE | allowed |
| MAIN | MAIN | forbidden |

OFFICIAL gives control back to the native Codex/Hermes runtime. MAIN permits Main only. Unknown modes fail closed. Studio enforces this in both the dashboard backend and native Hermes `worker_delegate`; the Worker remains the final upstream authority.

Worker README invariants locked by CI include:

- OFFICIAL `:8788` fault isolation;
- ChatGPT OAuth observed through official App Server `account/read` locks Worker/Codex Main to Official;
- third-party Main only without OAuth and only as explicit standalone App Server provenance;
- `WORKER` maps to `DELEGATE`;
- `account/read`, `model/list`, optional `modelProvider/capabilities/read` feed the live Model Capability Registry;
- Reasoning is model-advertised only;
- third-party threads are not presented as native subagents;
- production/release/archive seals fail closed without target-host evidence.

## Worker HTTP contracts

| Contract | Use |
|---|---|
| `GET /api/health` | health |
| `GET /api/state` | persisted mode/provider/routing; execution-policy read |
| `GET /api/catalog` | actual model/capability registry |
| `PUT /api/provider` | New API config |
| `POST /api/provider/probe` | upstream probe |
| `POST /api/provider/connectivity` | per-model real request |
| `PUT /api/mode` | OFFICIAL/AUTO/DELEGATE/MAIN |
| `PUT /api/routing` | Main/Worker/Verifier routing |
| `POST /api/codex/install` | official Codex integration install |
| `POST /api/verify/coexistence` | coexistence verification |
| `POST /api/worker/start` | async worker task |
| `POST /api/worker/run` | synchronous native-tool task |
| `GET /api/worker/status/{task_id}` | real progress/state |

There is no second Worker implementation in Studio.

## Capability integrity

Worker routing uses `catalog.registry.providers.<provider>.models`. Reasoning values come only from model capability metadata. `Auto` is the sole local sentinel. A model with no advertised efforts remains Auto-only.

## Failure rule

When a public upstream contract is unavailable:

1. keep unrelated Hermes surfaces usable;
2. display/fail at the exact missing boundary;
3. never substitute a private DB/internal import;
4. never fabricate models, efforts, events, task IDs, approval states, or success;
5. use a compatibility adapter only when the replacement is itself stable/documented;
6. keep OFFICIAL independent from a failed Worker delegation control plane.

## Forbidden dependencies

A sealed release must not add, without an explicit architecture revision:

- direct SQLite access to Hermes or Worker databases;
- `hermes_state`/private Hermes UI imports;
- CLI-output scraping when an API exists;
- browser storage/exposure of upstream bearer secrets;
- a local model list or reasoning-effort ladder;
- patched Hermes files;
- patched codex-worker-delegation files;
- third-party provenance masquerading as official/native execution;
- silent Runs-to-legacy replay after a native execution failure.

`scripts/verify_contract.py` and `scripts/verify_upstreams.py` mechanically enforce key portions of this boundary.
