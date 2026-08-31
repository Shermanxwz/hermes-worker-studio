# Production / Archive Seal Checklist

A release is called **SEALED** only after every applicable target-machine item below passes and its evidence is retained. Hosted GitHub CI proves the repository/archive-candidate layer deeply, but it cannot honestly prove private OAuth, real provider credentials, the intended browser, host permissions or service recovery.

Record with the evidence bundle:

- Studio exact commit SHA;
- Hermes exact commit/version/profile;
- Worker exact commit/version;
- OS / Python / Node versions;
- test timestamp and operator;
- CI run URL for the exact commit.

## A. Exact repository gate

- [ ] PR CI is green on the exact proposed head SHA.
- [ ] PR is merged without bypassing required checks.
- [ ] CI is green again on the exact resulting `main` SHA.
- [ ] `python scripts/verify_contract.py` passes locally from that exact checkout.
- [ ] `tests/upstream-lock.json` matches the intended Hermes/Worker deployment.
- [ ] Hermes pin is visibly recorded as `0.20.6 post-release-snapshot`, not mislabeled as the official release tag.
- [ ] Release lineage records `v2026.8.27` / `5fc308a70719a83cccdbba4c0e39c23f5a8239d5` and the snapshot `4f22543509d1b91dc45bcb369447126c5eb14fb7`.

A green Section A means **ARCHIVE CANDIDATE**, not SEALED.

## B. Hermes native plugin installation

On the target Hermes machine:

- [ ] `hermes plugins doctor . --ci` passes.
- [ ] `hermes plugins enable hermes-worker-studio` succeeds.
- [ ] Hermes starts normally with the plugin enabled.
- [ ] `/sessions` renders Studio through official `tab.override`.
- [ ] No Hermes source/application file was patched.
- [ ] Disable plugin -> native Hermes behavior returns without reinstalling Hermes.
- [ ] Re-enable plugin -> Studio returns without database migration.

Save Plugin Doctor output.

## C. Network/authentication boundary

- [ ] Hermes API Server is loopback-only unless an explicit hardened remote design is being sealed.
- [ ] `API_SERVER_KEY` / Studio Hermes key are configured correctly.
- [ ] Worker is loopback `127.0.0.1:8788` for local mode.
- [ ] Non-loopback Hermes/Worker URL is rejected while `HERMES_WORKER_STUDIO_ALLOW_REMOTE != 1`.
- [ ] Embedded credentials in upstream URLs are rejected.
- [ ] Browser DevTools/network payloads contain no Hermes API Server key or Worker bearer token.
- [ ] Dashboard uses Hermes' own authentication gate; Studio introduces no second login system.

## D. Hermes native Runs execution plane

From Studio, run a turn that uses at least one Hermes tool.

- [ ] `/api/plugins/hermes-worker-studio/integration` reports `execution_plane=official_runs` on the pinned Hermes.
- [ ] Sending a turn creates a Hermes `/v1/runs` run, not a Studio synthetic executor.
- [ ] Run ID shown/observed by Studio matches Hermes native run ID.
- [ ] `GET /v1/runs/{run_id}` reaches `completed` for a successful turn.
- [ ] Studio final status/output matches Hermes' authoritative status.
- [ ] SSE lifecycle includes real `run.started` / tool / assistant / terminal events as emitted upstream.
- [ ] Work duration increments while active and freezes at terminal state.
- [ ] Final transcript reloads from Hermes Session storage.
- [ ] Completed work panel collapses and can be reopened with preserved events.

Fault injection:

- [ ] Interrupt native Run event SSE while the Run itself continues; Studio does **not** invent `incomplete` or `completed` from transport EOF and later status polling reconciles with Hermes.
- [ ] Force a real native Run failure; Studio does not replay the prompt through legacy `chat/stream`.
- [ ] On a deliberately old Hermes instance with `run_submission=false`, legacy compatibility is used and a clean EOF without `run.completed` becomes `incomplete`, never success.

## E. Native Run controls

Use the authenticated Studio plugin API against a disposable run where appropriate.

- [ ] `POST /hermes/runs/{id}/stop` reaches Hermes native `/v1/runs/{id}/stop` and the run settles to cancelled/stopped according to Hermes.
- [ ] A pending approval can be resolved through `/hermes/runs/{id}/approval` with a valid Hermes choice (`once`, `session`, `always`, `deny`).
- [ ] Invalid approval choices are rejected by Studio before forwarding.
- [ ] `/hermes/runs/{id}/steer` is accepted for an active Hermes run and rejected by Hermes for an inactive run.
- [ ] A legacy compatibility run refuses native Runs control instead of pretending the control succeeded.

Retain sanitized request/status evidence for one stop and, when practical, one approval/steer case.

## F. Conversation/history/search/archive performance

Prepare 100+ Sessions and at least one 1,000+ message Session.

- [ ] Recent rail fetches exactly 10 Sessions.
- [ ] Normal conversation opens only latest 40 messages.
- [ ] Full History fetches 20 Sessions/page.
- [ ] Full transcript fetches 100 messages/page.
- [ ] Normal open of 1,000+ message Session does not fetch the whole transcript.
- [ ] Browser remains responsive during history pagination.
- [ ] Search finds old content not present in recent 10 via `/api/sessions/search`.
- [ ] Search finds a known Session ID.
- [ ] Search is server-side FTS, not browser full-history scanning.
- [ ] Archive removes the Session from normal recent list.
- [ ] Archived page uses official `archived=only`.
- [ ] Restore/unarchive returns it to normal visibility.

## G. Hermes Skills / Plugins / MCP official surfaces

- [ ] Studio primary navigation opens native Hermes Skills page.
- [ ] Native `/api/skills` returns the real target profile's Skills inventory.
- [ ] Enable/disable/edit a disposable Skill through Hermes native UI and verify it persists.
- [ ] Plugins page opens native Hermes plugin management.
- [ ] MCP page opens native Hermes MCP management.
- [ ] A new/changed Skill is visible through native `/api/skills`; no Studio private skill store exists.

Do not claim a Studio-specific “learned skill” notification unless the shipped UI visibly provides it; native Skills state is the authority.

## H. Worker four modes — real control plane

Use the same real Worker instance intended for seal. Verify mode via Worker `/api/state` and Studio/native tool behavior.

### OFFICIAL

- [ ] Set `OFFICIAL`; `/api/state.mode == OFFICIAL`.
- [ ] Studio does not write project custom routing overrides.
- [ ] Native `worker_delegate` fails closed without starting `/api/worker/start`/`run`.
- [ ] Studio `/worker/start` also returns 409 before Worker execution.
- [ ] Stop Worker `:8788`; Hermes history/search/archive stay usable.
- [ ] With Worker stopped, a Hermes turn that does not require project Worker delegation still works.
- [ ] Restart Worker; routing page recovers without reinstalling Studio.

### AUTO

- [ ] Set `AUTO`; `/api/state.mode == AUTO`.
- [ ] Main / Worker / Verifier route cards use real Worker registry.
- [ ] `worker_delegate` can create a real project Worker task.
- [ ] Real task ID is observed and `/api/worker/status/{task_id}` matches Studio display.

### WORKER / DELEGATE

- [ ] UI `WORKER` persists wire `DELEGATE`.
- [ ] Main coordinates while project Worker delegation is allowed.
- [ ] Native `worker_catalog.studio_policy.ui_mode == WORKER` and `mode == DELEGATE`.
- [ ] Worker/Verifier execution provenance matches the Worker audit/state.

### MAIN

- [ ] Set `MAIN`; `/api/state.mode == MAIN`.
- [ ] New project Worker delegation is rejected by Studio backend.
- [ ] Native `worker_delegate` also rejects it before worker start/run.
- [ ] Main-only operation continues.

### Unknown/faulted state

- [ ] A controlled invalid/unknown mode test in non-production harness fails closed rather than assuming delegation is allowed.

## I. Worker OAuth/Main provenance

On a real signed-in Linux target where Worker production seal can observe ChatGPT OAuth:

- [ ] Worker official App Server `account/read` observes the actual account state.
- [ ] When account type is ChatGPT, Worker/Codex Main provider is Official-locked server-side.
- [ ] Bypassing browser and attempting third-party Main while OAuth-active is rejected.
- [ ] Worker/Verifier may still use legitimate third-party routes if configured.
- [ ] If testing no-OAuth mode, third-party Main runs only as standalone App Server provenance using `codex_worker_gateway`.
- [ ] UI/audit does not claim that standalone third-party Main replaced the official ChatGPT/Hermes root provider.
- [ ] Third-party threads are not labeled native subagents.

## J. New API + model capability integrity

Use a real OpenAI-compatible upstream.

- [ ] Save Base URL + API Key through Worker Routing.
- [ ] Worker `/api/catalog` refreshes with the real model list.
- [ ] Password input is cleared after success.
- [ ] Hermes official Custom Endpoint is created/updated without a Studio secret store.
- [ ] Re-saving the same endpoint updates rather than intentionally creating a duplicate Studio-owned provider DB.
- [ ] Per-model connectivity performs a real Worker request.
- [ ] Bad key/model visibly fails.
- [ ] Embedding/vector models do not become generation routes when Worker marks them non-generation.

For Reasoning:

- [ ] Model with advertised efforts shows exactly `Auto + advertised values` in advertised order.
- [ ] Model without advertised efforts shows only disabled `Auto`.
- [ ] Switching model recomputes valid effort immediately.
- [ ] No common ladder (`low/medium/high/xhigh`) appears merely because Studio recognizes the strings.
- [ ] Backend rejects unsupported injected effort according to Worker upstream policy.

## K. Hermes model/provider resolution

- [ ] `OFFICIAL` sends no Studio custom model/provider lock and follows Hermes default.
- [ ] In non-OFFICIAL mode, a selected model is locked to a Hermes Session only when `/api/model/options` uniquely resolves provider + model.
- [ ] Ambiguous provider mapping is not guessed.
- [ ] Worker catalog is never presented as the authoritative Hermes root model inventory.

## L. Unattended / full-authority closure

Use a disposable trusted environment.

1. Apply the official unattended configuration.
2. Read `/api/config` back.
3. Verify exact values:

- [ ] `approvals.mode == off`.
- [ ] `cron_mode == approve`.
- [ ] `single_query_mode == approve`.
- [ ] `unattended_mode == approve`.
- [ ] `mcp_reload_confirm == false`.
- [ ] `destructive_slash_confirm == false`.

Then run the real probe:

```text
POST /api/plugins/hermes-worker-studio/hermes/unattended/probe
{"confirm":"RUN_SAFE_UNATTENDED_PROBE"}
```

- [ ] Probe returns `ok=true`, `status=UNATTENDED_READY`, `marker_verified=true`.
- [ ] Probe's run ID is a real Hermes native Run.
- [ ] No manual approval was required.
- [ ] Marker was created by Hermes tool execution and cleaned by the probe.
- [ ] A safe hardline representative remains blocked by Hermes without execution.

Save sanitized config excerpt + probe result. **Config write without read-back + probe is not a seal.**

## M. Degraded operation/recovery

- [ ] Stop Worker: Hermes non-Worker surfaces remain usable.
- [ ] Restart Worker: Studio recovers without reinstall.
- [ ] Stop Hermes API Server: history/management UI still renders where served by Dashboard; new runs fail clearly.
- [ ] Restart API Server: new turns work without reinstall.
- [ ] Invalid New API does not break existing Hermes history/native provider operation.
- [ ] Browser refresh during/after a run reconciles from authoritative Hermes Session/status as supported by the runtime.

## N. Upgrade / rollback

- [ ] Re-run all repository/upstream contracts against the intended long-term Hermes/Worker versions before changing the lock.
- [ ] Worker `npm run seal:production` passes on this same signed-in target.
- [ ] Worker `npm run seal:release` passes where required by the Worker release process.
- [ ] Worker `npm run seal:archive` reaches its real archive-ready result on this same target.
- [ ] `scripts/install.sh` is idempotent.
- [ ] Previous Studio tag/commit remains available.
- [ ] Roll back by replacing/disabling Studio plugin only; no Studio-owned Hermes DB migration is required.
- [ ] After rollback, native Hermes `/sessions` behavior is restored.

## O. Final evidence bundle

Attach/store with the exact sealed tag:

- [ ] green PR CI URL + head SHA;
- [ ] green post-merge `main` CI URL + exact main SHA;
- [ ] Hermes Plugin Doctor output;
- [ ] sanitized `/v1/capabilities` + `/health/detailed`;
- [ ] native Runs create/status/events evidence;
- [ ] stop and, if applicable, approval/steer evidence;
- [ ] Worker `/api/health`, `/api/state`, sanitized `/api/catalog`;
- [ ] four-mode screenshots/logs including OFFICIAL worker-outage isolation;
- [ ] 10-session recent rail + paged full-history evidence;
- [ ] real New API connectivity + real reasoning capability values;
- [ ] native Skills evidence;
- [ ] unattended sanitized config read-back + `UNATTENDED_READY` result;
- [ ] Worker real production/release/archive seal outputs;
- [ ] service stop/restart and rollback evidence;
- [ ] version matrix and OS/browser/runtime details.

Only after every applicable item is satisfied should the exact commit/tag be called **SEALED**. Until then the strongest valid repository-only label is **ARCHIVE CANDIDATE**.
