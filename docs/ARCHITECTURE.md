# Architecture

## 1. Design objective

Hermes Worker Studio is a **product shell, not a Hermes fork**.

> If Hermes or codex-worker-delegation exposes a documented/stable contract, consume that contract. Add Studio code only at the seam between the two products.

The sealed architecture must preserve three independent authorities:

1. **Hermes** owns the root agent, Session transcript, native Run lifecycle, approval/security policy, Skills and provider runtime.
2. **codex-worker-delegation** owns its four-mode policy, Codex App Server provenance, Worker/Verifier tasks, provider vault and capability registry.
3. **Studio** owns only authenticated presentation/adaptation and must not fabricate either upstream's state.

## 2. Runtime topology

```text
Browser
  │
  │ Hermes Dashboard Plugin SDK / authenticated Dashboard REST
  ▼
Hermes Dashboard
  ├── /api/sessions / search / messages / archive
  ├── /api/config / /api/skills / Custom Endpoints
  └── /api/plugins/hermes-worker-studio/*
         │
         ├── loopback + API_SERVER_KEY ──> Hermes API Server :8642
         │      ├── /health / /health/detailed
         │      ├── /v1/capabilities
         │      ├── /api/model/options
         │      ├── /api/sessions / /api/sessions/{id}/model
         │      └── /v1/runs
         │             ├── GET /{run_id}
         │             ├── GET /{run_id}/events
         │             └── POST /{run_id}/stop|approval|steer
         │
         └── loopback (+ optional bearer) ──> codex-worker-delegation :8788
                ├── /api/state
                ├── /api/catalog
                ├── /api/provider*
                ├── /api/mode / /api/routing
                └── /api/worker/*
```

The browser never receives the Hermes API Server or Worker bearer secrets.

## 3. Source-of-truth table

| Concern | Authority | Studio behavior |
|---|---|---|
| Root agent | Hermes Agent | never replaced by Worker/Codex Main |
| Session list/messages | Hermes Dashboard APIs | 10 recent / 40 active / paged full history |
| Search | Hermes `/api/sessions/search` | render server FTS results |
| Archive | Hermes Session PATCH + `archived=only` | no duplicate store |
| Run creation | Hermes `POST /v1/runs` | primary when capability advertised |
| Run terminal state/output | Hermes `GET /v1/runs/{id}` | authoritative truth |
| Run events | Hermes native Run SSE | bounded UI projection; preserve names/data |
| Stop/approval/steer | Hermes Run control endpoints | exact run ID forwarding |
| Legacy execution | Hermes Session `chat/stream` | compatibility only when Runs absent |
| Hermes models/providers | `/api/model/options` | unique-resolution Session lock only |
| Worker modes/routes | Worker `/api/state` + `/api/routing` | no browser-only policy |
| Worker model capability | Worker `/api/catalog` | no local model list |
| Reasoning | Worker model metadata | `Auto` + advertised values only |
| New API secret | Worker vault + Hermes Custom Endpoint | no Studio secret store |
| Skills | Hermes `/api/skills` / native page | no private skill DB |
| Approval policy | Hermes `/api/config` | supported keys only |
| Unattended proof | Hermes native Run + temp marker | real execution proof, not config-write proof |

## 4. Native Runs execution adapter

The Dashboard Plugin SDK gives Studio a stable authenticated JSON path, while Hermes native Runs also expose SSE. Studio bridges the transport without becoming an executor.

1. Browser sends `POST /api/plugins/hermes-worker-studio/hermes/runs`.
2. Backend reads `/v1/capabilities`.
3. If `run_submission` is true, Studio translates the request to Hermes `POST /v1/runs`:
   - `message -> input`;
   - preserve `session_id`;
   - forward only supported request-scoped `instructions`, history/response linkage and model/provider/options fields.
4. Hermes returns the actual `run_id`; Studio does not invent a parallel execution ID.
5. When native event streaming is advertised, Studio consumes `/v1/runs/{id}/events` and stores a bounded event projection.
6. Every browser status poll reconciles against Hermes `GET /v1/runs/{id}`. That status/output/usage is authoritative.
7. `/stop`, `/approval` and `/steer` target the same upstream run ID.
8. Event-stream EOF never decides native Run success/failure.

### Legacy compatibility

Only when capabilities explicitly lack native run submission does Studio create a local projection ID and consume `/api/sessions/{id}/chat/stream`.

For this old path only, clean EOF without a terminal event becomes `incomplete`. A native Run failure never triggers fallback/replay because that could execute the user's request twice.

## 5. Four-mode Worker policy

Worker mode is an execution permission boundary:

| UI | Wire | Delegation |
|---|---|---:|
| OFFICIAL | OFFICIAL | blocked |
| AUTO | AUTO | allowed |
| WORKER | DELEGATE | allowed |
| MAIN | MAIN | blocked |

Studio deliberately repeats the policy at two boundaries:

- Dashboard backend checks real Worker `/api/state` immediately before `/api/worker/start`.
- Native Hermes `worker_delegate` checks `/api/state` immediately before `/api/worker/start` or `/api/worker/run`.

Unknown mode fails closed. The Worker server remains the final upstream enforcement authority.

This prevents UI bypass and stale browser state from becoming an execution-policy bypass.

## 6. OFFICIAL fault isolation

OFFICIAL means project Worker routing is not required for native Hermes operation. Therefore health is split:

- Hermes API Server failure -> Hermes execution unavailable.
- Worker failure -> delegation degraded only.

A failed `:8788` must not mark the Hermes root runtime itself unhealthy or prevent history/search/archive. This mirrors the Worker's own README expectation that OFFICIAL remains native when its local control plane is absent.

## 7. Main/provenance separation

There are two different things called “Main” in the combined product and they must not be conflated:

- **Hermes root/Main conversation runtime**: Hermes provider/model from `/api/model/options` and its Session/runtime rules.
- **Worker/Codex Main**: the Main role defined by codex-worker-delegation and its official App Server integration.

Worker OAuth/provenance rules remain upstream-owned:

- active ChatGPT OAuth -> Worker/Codex Main Official-locked;
- no OAuth -> optional third-party standalone Main;
- third-party standalone threads keep `codex_worker_gateway` provenance;
- third-party threads are not relabeled native subagents.

In Studio `OFFICIAL`, no custom Hermes model/provider lock is sent. Outside OFFICIAL, a desired model can be locked only if Hermes `/api/model/options` uniquely resolves its provider.

## 8. Model/reasoning capability integrity

Studio has no canonical model table and no canonical effort ladder.

- Hermes model/provider truth: Hermes `/api/model/options`.
- Worker route capability truth: Worker `/api/catalog`.
- `Auto` is the only local reasoning sentinel.
- All non-Auto stops must be upstream-advertised for that exact model.
- Ambiguous Hermes provider mapping is a visible non-lock condition, never a guess.

## 9. Skills/Plugin/MCP strategy

Studio links to Hermes native administration instead of cloning it.

- Skills state is authoritative at `/api/skills`.
- Plugins are managed by Hermes native plugin surfaces.
- MCP is managed by Hermes native MCP surfaces.

CI runs the pinned Hermes Skills editor/API tests and real Plugin Doctor. Studio must not grow a second Skills persistence layer.

## 10. Unattended/full-access closure

The UI writes only supported Hermes approval keys. Target-machine seal then performs a separate real probe.

The probe:

1. requires explicit authenticated confirmation;
2. starts Hermes `POST /v1/runs`;
3. instructs Hermes to run one harmless `bash -c` marker write in a random temp path;
4. polls official Run state;
5. verifies the marker;
6. removes it;
7. returns `UNATTENDED_READY` only after both Hermes completion and marker proof.

Studio itself does not execute a substitute subprocess. Hermes hardline stays in force.

Worker local autonomous mode can request `danger-full-access` only because the Worker is separately configured to permit it; it remains loopback-first.

## 11. Performance contract

- Recent rail: 10 Sessions.
- Active conversation: latest 40 messages.
- Full Session list: 20/page.
- Full transcript: 100/page.
- Search: Hermes server FTS.

Normal conversation load must not scale linearly with multi-year Session history.

## 12. Security/network contract

Default accepted upstream hosts are literal `localhost`, `127.0.0.1`, `::1`. Remote upstreams require explicit `HERMES_WORKER_STUDIO_ALLOW_REMOTE=1`; embedded URL credentials are rejected.

This keeps the authenticated plugin backend from accidentally becoming a generic SSRF bridge.

## 13. Failure behavior

- Worker unavailable -> delegation degraded; Hermes root/history surfaces remain independent.
- Hermes API Server unavailable -> new turns fail clearly; Dashboard-owned history/management can remain visible.
- Native Run SSE closes -> status remains whatever Hermes authoritative polling says.
- Native Run errors -> no legacy replay.
- Legacy SSE closes without terminal event -> `incomplete`.
- New API failure -> no guessed replacement model.
- Hermes Custom Endpoint sync failure -> do not claim Worker/Hermes provider alignment.
- Ambiguous provider -> no Session lock.
- OFFICIAL/MAIN delegation attempt -> fail before Worker start.
- Unknown Worker mode -> fail closed.

## 14. Archive upgrade philosophy

Before changing the upstream lock:

1. run `scripts/verify_upstreams.py` against exact candidate commits;
2. run Studio full CI;
3. run Worker own full test/check/seal workflow;
4. run real Worker four-mode smoke;
5. run pinned Hermes own Runs/approval/Skills tests;
6. run Hermes real Plugin Doctor;
7. repeat target-host `docs/SEAL_CHECKLIST.md`.

Only adapt when a public contract actually changes. Never chase internal refactors by importing private state.
