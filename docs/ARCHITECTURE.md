# Architecture

## 1. Design objective

Hermes Worker Studio is a **product shell, not a Hermes fork**. The archive rule is simple:

> If Hermes already exposes a documented Dashboard/API/Plugin contract, use it directly. Add custom code only where two documented products need to be joined.

This keeps the maintenance surface small enough to freeze for long periods.

## 2. Runtime topology

```text
Browser
  │
  │ official Hermes Dashboard Plugin SDK / authenticated dashboard REST
  ▼
Hermes Dashboard
  ├── /api/sessions, /api/sessions/search, archive/config/custom-endpoints
  └── /api/plugins/hermes-worker-studio/*
         │
         ├── loopback + API_SERVER_KEY ──> Hermes API Server :8642
         │      ├── /v1/capabilities
         │      ├── /api/model/options
         │      ├── /api/sessions
         │      └── /api/sessions/{id}/chat/stream
         │
         └── loopback ───────────────────> codex-worker-delegation :8788
                ├── /api/state
                ├── /api/catalog
                ├── /api/provider*
                ├── /api/routing
                └── /api/worker/*
```

The browser never receives `API_SERVER_KEY` or Worker bearer credentials.

## 3. Source-of-truth table

| Concern | Source of truth | Studio behavior |
|---|---|---|
| Session list | Hermes Dashboard `/api/sessions` | recent=10; full history paginated |
| Session messages | Hermes official session messages API | chat tail=40; history=100/page |
| Search | Hermes FTS `/api/sessions/search` | display results only |
| Archive | Hermes Session PATCH + `archived=only` | no duplicate archive store |
| Runtime work events | Hermes API Server `chat/stream` SSE | preserve event names/data |
| Work duration | run bridge timestamps | live counter, freeze at terminal state |
| Model inventory | Worker registry + Hermes `/api/model/options` | map by actual model/provider metadata |
| Reasoning effort | Worker model capability metadata | `Auto` + advertised values only |
| New API credentials | Worker control plane and Hermes Custom Endpoint | browser clears input after submit |
| Worker routes | codex-worker-delegation state/catalog | Main/Worker/Verifier share one registry |
| Skills / Plugins / MCP | Hermes native dashboard pages | direct navigation, no cloned admin UI |
| Approval policy | Hermes official `approvals` config | writes supported keys only |

## 4. Dashboard extension strategy

`dashboard/manifest.json` uses Hermes' supported `tab.override` mechanism to replace `/sessions`. No Hermes source file is patched. Skills, Plugins, MCP and lower-frequency administration stay on Hermes native pages.

The Studio page contains its own compact conversation rail so daily work is not forced through the large management-oriented Sessions page.

## 5. Real work-event bridge

Hermes Dashboard's documented plugin SDK exposes authenticated JSON fetches, while the agent execution contract is SSE. Studio therefore bridges these two **without exposing private dashboard authentication details**:

1. Browser calls `POST /api/plugins/hermes-worker-studio/hermes/runs` through `SDK.fetchJSON`.
2. Backend starts a daemon bridge that consumes official Hermes `chat/stream` SSE.
3. Event name and JSON data are preserved; Studio does not invent `tool.started` / `tool.completed` events.
4. Browser polls the bridge by cursor (`after=<seq>`) every ~650 ms using the documented authenticated JSON path.
5. `assistant.delta` is rendered as live response text.
6. Tool/run events appear in the work panel.
7. If an actual Worker `task_id` appears in an event payload, Studio polls the Worker status endpoint and shows that returned object.
8. A clean SSE EOF without `run.completed` is marked `incomplete`, never silently promoted to success.
9. Completion freezes duration and collapses the work panel by default.

The raw SSE passthrough endpoint remains available for diagnostics, but the dashboard UI does not depend on private session-token globals.

## 6. Conversation performance contract

Daily chat deliberately does less work:

- Recent rail: 10 sessions.
- Active conversation: latest 40 messages.
- Full session history: 20 sessions/page.
- Full transcript: 100 messages/page.
- Search: server-side FTS; no client history scan.

A user who needs old context explicitly opens Full History. This prevents a multi-year transcript from becoming the normal page-load cost.

## 7. Unified routing contract

Worker modes are read from `codex-worker-delegation`:

- `OFFICIAL`: no Studio route override.
- `AUTO`: Main + Worker + Verifier routes.
- `DELEGATE`: Main coordinates; Worker/Verifier routes remain explicit.
- `MAIN`: Main only.

The chat header's model control edits the same Main route used on the Worker Routing page. The route is persisted back through `/api/routing`; there is no second browser-only routing state.

When an actual Hermes provider can be resolved from `/api/model/options`, Studio also asks the API Server to persist a Session model lock. Resolution is deterministic:

- New API: match a user-defined provider by its actual `api_url` and model.
- Official: use a unique authenticated non-custom provider match, or the provider marked current.
- Ambiguous provider matches are **not guessed**; the conversation continues on Hermes' current official route and the UI can surface the lock warning.

## 8. Reasoning effort rule

`Auto` is the only Studio-defined value. All other slider stops are taken from the selected model's live capability data (`reasoning.options`, with the Worker's advertised effort list as compatibility input).

Studio must never ship a local list such as `low / medium / high / xhigh`. `scripts/verify_contract.py` fails CI if those strings become hard-coded picker values.

## 9. Unattended / full-access rule

The UI's unattended button writes only Hermes-supported approval fields:

```yaml
approvals:
  mode: off
  cron_mode: approve
  single_query_mode: approve
  unattended_mode: approve
  mcp_reload_confirm: false
  destructive_slash_confirm: false
```

Worker delegation defaults to `danger-full-access` and the local convenience launcher sets `CWD_ALLOW_DANGER_FULL_ACCESS=1`.

Hermes' hardline blocklist remains always-on. Studio does not patch or bypass it.

## 10. Network/security boundary

By default the backend accepts only literal `localhost`, `127.0.0.1`, or `::1` upstream hosts. Remote upstreams require explicit `HERMES_WORKER_STUDIO_ALLOW_REMOTE=1`.

This prevents a dashboard configuration mistake from silently turning an authenticated plugin route into a generic SSRF proxy. Remote mode is an operator decision and should be paired with TLS/private networking and upstream authentication.

## 11. Failure behavior

- Worker unavailable: history/search/archive still work; Worker features show degraded status.
- Hermes API Server unavailable: management/history still work; new agent turns fail clearly.
- SSE ends unexpectedly: run becomes `incomplete`.
- New API model endpoint fails: existing routing is not fabricated or replaced by guessed models.
- Hermes Custom Endpoint sync fails: Worker provider save remains visible, and the sync error is shown instead of pretending both systems are aligned.
- Ambiguous Hermes provider mapping: no model lock is sent.

## 12. Upgrade philosophy

On Hermes upgrades, validate contracts before changing code:

1. Dashboard plugin still loads and `tab.override` works.
2. `/api/sessions` + search/archive semantics remain advertised/working.
3. API Server `/v1/capabilities` still advertises session streaming.
4. Worker `/api/catalog` still returns provider/model capability rows.
5. Run `scripts/verify_contract.py`, unit tests, `node --check`, and `hermes plugins doctor --ci`.

Only add compatibility code when an upstream documented contract actually changes. Do not chase internal refactors.
