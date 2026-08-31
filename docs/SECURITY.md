# Security Model

Worker Studio inherits Hermes authentication/safety instead of creating a competing security subsystem. The authenticated operator is trusted to use the powerful Hermes Dashboard; Studio's job is to preserve provenance, secret boundaries, failure isolation, and fail-closed execution policy.

## Trust boundaries

Local upstreams by default:

- Hermes API Server: `127.0.0.1:8642`
- codex-worker-delegation: `127.0.0.1:8788`

Unless `HERMES_WORKER_STUDIO_ALLOW_REMOTE=1`, both bridges require a literal loopback hostname/address. DNS names that merely resolve to loopback are not accepted. Embedded URL credentials are rejected.

Remote opt-in transfers responsibility for TLS/private networking and strong upstream authentication to the operator.

## Secrets

The browser bundle never references or receives:

- `API_SERVER_KEY`
- `HERMES_WORKER_STUDIO_API_KEY`
- `CWD_WEB_TOKEN`
- `HERMES_WORKER_STUDIO_WORKER_TOKEN`

The dashboard plugin backend adds those credentials server-side.

A New API key entered in Worker Routing is intentionally submitted to two authorized owners only:

1. codex-worker-delegation, which owns Worker provider/vault/routing state;
2. Hermes' official Custom Endpoint API, which owns Hermes provider configuration.

The input is cleared after successful save. Studio creates no third secret store.

## Hermes execution truth

When `/v1/capabilities` advertises native run submission, Studio uses Hermes `/v1/runs` as the authoritative execution plane. `/v1/runs/{id}` is terminal truth; Studio's in-memory event list is only a bounded UI projection.

Security consequences:

- event-stream EOF is not success;
- a failed native Run is not silently replayed through legacy Session chat;
- stop/approval/steer are sent to the same Hermes run ID;
- transport state expiration cannot fabricate completion;
- Studio never executes model-requested tools itself in place of Hermes.

Legacy `/api/sessions/{id}/chat/stream` exists only for a capability-confirmed older Hermes runtime.

## Worker four-mode enforcement

Worker mode is an execution policy, not a UI preference.

- `AUTO` and `DELEGATE` (`WORKER` in UI) permit project-managed Worker delegation.
- `OFFICIAL` and `MAIN` reject new project-managed delegation.
- Unknown modes fail closed.

This is enforced twice in Studio:

1. dashboard backend before `/api/worker/start`;
2. native Hermes `worker_delegate` before `/api/worker/start` or `/api/worker/run`.

The Worker server remains the final independent enforcement layer.

`OFFICIAL` is also a fault-isolation boundary. A dead Worker control plane is reported as degraded delegation, not as dead Hermes. Hermes history/search/archive and native non-Worker operation remain independent.

## OAuth/Main provenance

Studio does not weaken the Worker's README contract:

- active ChatGPT OAuth observed through official Codex App Server `account/read` locks Worker/Codex Main to Official;
- no OAuth is the only condition in which third-party standalone Main may be used;
- third-party Main/Worker/Verifier App Server threads retain explicit third-party provenance;
- Studio never labels a third-party thread as Hermes official provider or native subagent.

Hermes root-agent model resolution uses Hermes `/api/model/options`; Worker catalog does not impersonate the Hermes model picker.

## Browser rendering

Conversation text, tool output, search snippets, Worker JSON and errors are rendered as React text/preformatted content. The shipped bundle does not use `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or dynamic script injection for untrusted model/tool output.

## Local Worker passwordless mode

`scripts/run-worker-local.sh` may use `CWD_REQUIRE_AUTH=0` only with loopback binding. Never copy passwordless mode to a public bind. Network-reachable Worker deployments must use the Worker's own hardened authentication/deployment path and an appropriate Studio Worker token.

## Full access / unattended

The intended autonomous local mode is deliberately powerful:

- Worker default requested sandbox: `danger-full-access`;
- local Worker opt-in: `CWD_ALLOW_DANGER_FULL_ACCESS=1`;
- Hermes `approvals.mode=off`;
- Hermes headless modes: `approve`.

This is appropriate only inside a deliberately trusted machine/workspace.

Studio does **not** remove Hermes hardline protections. Upstream hardline remains authoritative.

### Real unattended verification

Writing config is not enough for seal evidence. The authenticated endpoint:

`POST /api/plugins/hermes-worker-studio/hermes/unattended/probe`

requires an explicit confirmation token and then starts a real Hermes native Run. Hermes is instructed to execute one harmless random temp-marker command; Studio polls the official run status and verifies the marker. Studio itself does not substitute a subprocess for Hermes. The marker is removed afterward.

A successful target seal retains both:

- sanitized config read-back proving the intended approval keys;
- probe result `UNATTENDED_READY` proving the API-server execution path actually completed without a human approval wait.

## Event/run memory limits

Studio's projection cache:

- is behind the normal authenticated Dashboard plugin route;
- forwards only to configured Hermes/Worker upstreams;
- caps event count and event payload size;
- expires stale projection records;
- does not own the authoritative Hermes transcript;
- does not convert incomplete legacy SSE into success.

## What to rotate after suspected compromise

Rotate at least:

1. `API_SERVER_KEY` / `HERMES_WORKER_STUDIO_API_KEY`;
2. Worker control token/password if enabled;
3. New API keys;
4. any credential readable by the autonomous Hermes/Worker workspace.

Restart relevant services after rotation so old process-memory credentials and active transports are discarded.
