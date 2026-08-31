# Final Seal Checklist

Use this checklist only after PR CI and post-merge `main` CI are green. Repository CI proves compatibility with the pinned snapshot; this checklist proves the real target machine.

Record date, host identifier, Hermes commit/version, Studio commit, evidence paths and operator for every run.

## A. Immutable baseline

- [ ] `git rev-parse HEAD` for Studio equals intended release commit.
- [ ] Hermes checkout equals `tests/upstream-lock.json` commit.
- [ ] `python scripts/verify_upstreams.py --hermes-root <checkout>` passes.
- [ ] `python scripts/verify_contract.py` passes.
- [ ] Working trees are clean or deviations are documented and rejected from seal.

## B. Plugin installation

- [ ] `bash scripts/install.sh` completes.
- [ ] staged `hermes plugins doctor` passes.
- [ ] plugin enable succeeds.
- [ ] installed-tree doctor passes.
- [ ] registered tools are exactly `worker_delegate`, `worker_status`, `worker_catalog`.
- [ ] `/sessions` is replaced through Dashboard `tab.override`; no Hermes core file is patched.

## C. Hermes API readiness

- [ ] `/health` responds.
- [ ] authenticated `/health/detailed` is not failed.
- [ ] authenticated `/v1/capabilities` advertises Run submission/status/events/stop and required control features.
- [ ] Browser never receives `API_SERVER_KEY`.

## D. Sessions/history UX

- [ ] recent rail requests at most 10 sessions.
- [ ] opening a conversation initially requests latest 40 messages.
- [ ] Full History paginates 20 sessions/page.
- [ ] transcript history paginates 100 messages/page.
- [ ] FTS search returns a known historical phrase.
- [ ] archive/unarchive moves a test conversation correctly.

## E. Native Runs / work timeline

Run a harmless real task through the Studio.

- [ ] execution is `POST /v1/runs`; no legacy chat transport is used.
- [ ] status polling reflects the authoritative Run status.
- [ ] SSE events render real tool lifecycle.
- [ ] when Hermes emits todo/subagent events they render without fabricated steps.
- [ ] elapsed time advances while running and freezes at terminal state.
- [ ] completed work auto-collapses and can be reopened.
- [ ] Stop works on a disposable long-running Run.
- [ ] Steer is accepted when supported.
- [ ] an approval event can be resolved through the official Run approval endpoint when approval mode is intentionally enabled for this test.

## F. Hermes-native Worker modes

### OFFICIAL
- [ ] `worker_delegate` is blocked with OFFICIAL explanation.
- [ ] native Hermes `delegate_task` remains usable according to Hermes defaults.

### AUTO
- [ ] `worker_delegate` launches a real Hermes `SubagentHandle`.
- [ ] `worker_status` reaches terminal result through public lifecycle.

### WORKER
- [ ] UI displays WORKER while stored/wire semantics are DELEGATE.
- [ ] worker delegation launches Hermes child agent and returns real child identity.

### MAIN
- [ ] direct `worker_delegate` is blocked.
- [ ] native `delegate_task` is also blocked by `pre_tool_call` before child launch.

- [ ] invalid/unknown mode fails closed.

## G. Models / New API

Use a disposable or approved real endpoint credential.

- [ ] Custom Endpoint is saved through Hermes official API.
- [ ] API key is not returned to browser after save; input clears.
- [ ] `GET /api/model/options?refresh=1` contains discovered models.
- [ ] conversation, Worker and Review selectors derive from the same Hermes model inventory.
- [ ] per-model “test” launches a minimal real Hermes Run with target provider+model.
- [ ] a known-good model passes.
- [ ] a deliberately invalid model/credential fails clearly.
- [ ] models without explicit effort metadata show `Auto` only.
- [ ] no model-name heuristic creates fake reasoning levels.

## H. Worker / Review routing

- [ ] Worker configuration writes only Hermes `delegation.*` fields.
- [ ] Review configuration writes only Hermes `auxiliary.review.*` fields.
- [ ] Main follows the active conversation/session model route instead of storing a duplicate Studio Main registry.
- [ ] a Worker launch uses configured Hermes delegation route or documented inheritance.
- [ ] `/review` uses configured reviewer route.

## I. Skills / Plugins / MCP

- [ ] first-level Skills link opens Hermes native Skills surface.
- [ ] a newly created/learned Skill appears through Hermes state/API without Studio synchronization database.
- [ ] Plugins link opens native Plugin management.
- [ ] MCP link opens native MCP management.
- [ ] no duplicate management store exists in Studio.

## J. Unattended

Apply from the visible first-level Unattended page.

- [ ] read current `/api/config` before change.
- [ ] write `approvals.mode=off`.
- [ ] set cron/single-query/unattended modes to approve.
- [ ] set `mcp_reload_confirm=false` and `destructive_slash_confirm=false`.
- [ ] set `delegation.subagent_auto_approve=true`.
- [ ] read config back and verify every value.
- [ ] authenticated real unattended marker Run returns `UNATTENDED_READY` and `marker_verified=true`.
- [ ] marker is removed after probe.
- [ ] a Hermes Hardline Blocklist case remains blocked; no bypass exists.

## K. Restart / persistence / failure injection

- [ ] restart Hermes gateway; sessions/history remain authoritative.
- [ ] reconnect Studio; no stale Run is invented as success.
- [ ] lifecycle child process-restart limitations are represented honestly; Studio does not fake reconnect.
- [ ] API Server unavailable => clear error, no fallback execution runtime starts.
- [ ] invalid Custom Endpoint => model probe fails without affecting Hermes core health.
- [ ] installer staged doctor failure preserves prior installed plugin.

## L. Security sweep

- [ ] no second execution service listening/required for Studio.
- [ ] no production references to removed Worker sidecar/runtime.
- [ ] no bearer secret in browser source, network payloads or committed files.
- [ ] remote API bridge remains disabled unless explicitly intended.
- [ ] no direct SQLite/private Hermes state access.
- [ ] no private Hermes delegation imports.

## M. Final archive evidence

Capture:

- Studio commit SHA;
- Hermes commit SHA/version;
- GitHub PR CI URL/result;
- GitHub post-merge main CI URL/result;
- `verify_contract.py` output;
- `verify_upstreams.py` output;
- Plugin Doctor output;
- real Run evidence;
- four-mode evidence;
- New API/model probe evidence;
- unattended config read-back + marker evidence;
- restart/failure-injection evidence.

Only after A–M pass may the release be labelled:

> **SEALED — Hermes Worker Studio 2.0, Hermes-native, single-runtime archive baseline**

If target-machine evidence cannot be collected, label the repository **ARCHIVE CANDIDATE**, never SEALED.