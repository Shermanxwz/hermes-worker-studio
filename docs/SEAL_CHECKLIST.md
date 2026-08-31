# Production / Archive Seal Checklist

A release is not called **sealed** until the checks below pass on the target machine. GitHub CI now proves the repository layer much more deeply — actual bundled UI behavior, HTTP integration, native tools, atomic install behavior, pinned upstream contracts, the Worker's own test suite, a live pinned Worker control plane, Hermes' real Plugin Doctor, and production static-security gates — but it still cannot prove the local Hermes account, API Server credentials, filesystem/service permissions, real historical data, real New API, or the user's actual browser/runtime environment.

See `docs/AUTOMATED_TEST_MATRIX.md` for the exact hosted-runner proof boundary. Record the Hermes version, codex-worker-delegation commit/version, Worker Studio commit, OS, and test time with the target-machine evidence bundle.

## A. Automated/repository gate

- [ ] GitHub Actions CI is green on the **exact commit** being sealed.
- [ ] The CI `Studio static + integration + UI runtime` job passes completely.
- [ ] The CI `Pinned Hermes + Worker public contracts` job passes against the exact revisions in `tests/upstream-lock.json`.
- [ ] The CI `Worker upstream tests + live control plane` job passes, including the Worker's own full tests/check and Studio's live Worker smoke.
- [ ] Hosted Worker production/archive seal commands fail closed with `NOT_SEALED` / `NOT_ARCHIVE_READY` because hosted CI does not possess target-machine evidence.
- [ ] The CI `Hermes real Plugin Doctor` job dynamically registers exactly `worker_delegate`, `worker_status`, and `worker_catalog` against pinned Hermes.
- [ ] The CI `Production security static analysis` job passes.
- [ ] For an independent local reproduction, run:

```bash
python -m compileall -q __init__.py schemas.py tools.py dashboard scripts tests
node --check dashboard/dist/index.js
bash -n scripts/install.sh scripts/run-worker-local.sh
python scripts/verify_contract.py
python -m unittest discover -s tests -p 'test_*.py' -v
npm install --ignore-scripts --no-fund
npm run test:frontend
npm audit --audit-level=high
```

A green Section A means **archive candidate**, not target-machine sealed.

## B. Hermes native plugin gate

- [ ] `hermes plugins doctor . --ci` passes on the target machine.
- [ ] `hermes plugins enable hermes-worker-studio` succeeds.
- [ ] Hermes starts normally with the plugin enabled.
- [ ] Disabling the plugin returns Hermes to its normal behavior without reinstalling Hermes.
- [ ] Re-enabling it restores Worker Studio without modifying Hermes source.

## C. Network boundary

- [ ] Hermes API Server listens on loopback by default.
- [ ] `API_SERVER_KEY` is configured and `HERMES_WORKER_STUDIO_API_KEY` resolves to the same key.
- [ ] Worker control plane listens on `127.0.0.1:8788` for local mode.
- [ ] A non-loopback Worker/API URL is rejected when `HERMES_WORKER_STUDIO_ALLOW_REMOTE` is not `1`.
- [ ] Browser DevTools/network responses do not contain `API_SERVER_KEY` or `CWD_WEB_TOKEN`.
- [ ] Public dashboard deployments use Hermes' normal authentication gate; the Studio does not create a second login system.

## D. Dashboard / navigation

- [ ] Opening the official Hermes dashboard lands on `/sessions` and renders Worker Studio via `tab.override`.
- [ ] No Hermes application file has been patched.
- [ ] First-level Studio navigation contains: chat, search, full history, archive, Worker routing, Skills, Plugins, MCP.
- [ ] Lower-frequency navigation is under More: Models, Cron, Files, Logs, Analytics, Channels, Webhooks, Profiles, Keys, Config, System.
- [ ] Skills / Plugins / MCP and More links open the native Hermes pages.
- [ ] Theme remains usable if the optional Worker Studio theme is not selected.

## E. Conversation performance

Prepare an account with more than 100 sessions and at least one very long session.

- [ ] Recent rail requests exactly 10 sessions.
- [ ] Opening a conversation requests only the latest 40 messages.
- [ ] Full History requests 20 sessions per page.
- [ ] Full transcript pages request 100 messages per page.
- [ ] Opening a 1,000+ message session does not fetch the whole transcript on the normal chat page.
- [ ] Browser remains responsive while the full-history page changes pages.

## F. Search / archive

- [ ] Search finds text from an old conversation that is not in the recent 10.
- [ ] Search finds a pasted Session ID.
- [ ] Search results come from `/api/sessions/search`, not client scanning.
- [ ] Archiving the active session removes it from the normal recent list.
- [ ] Archived page shows it using the official archived filter.
- [ ] Restoring/unarchiving makes it visible again.

## G. Real work process

Run a task that definitely uses at least one Hermes tool.

- [ ] Work panel appears only after a real run starts.
- [ ] Work time increments every second while the run is active.
- [ ] `tool.started` is shown when Hermes emits it.
- [ ] `tool.completed` is shown when Hermes emits it.
- [ ] Tool names/arguments/results shown by Studio match the actual upstream event payload.
- [ ] Assistant text streams while work is running.
- [ ] Final transcript is reloaded from Hermes after completion.
- [ ] Work panel collapses automatically when complete.
- [ ] Collapsed header shows final duration and event count.
- [ ] Expanding the completed panel shows the preserved real events.

Fault injection:

- [ ] Interrupt the upstream SSE before `run.completed`; Studio reports `incomplete`, not success.
- [ ] Stop the Hermes API Server during a run; Studio reports a clear failure and does not fabricate an answer.

## H. Worker delegation process

Run a prompt that triggers the native `worker_delegate` tool or explicitly call it in a controlled test.

- [ ] Hermes sees `worker_delegate`, `worker_status`, `worker_catalog` as registered native plugin tools.
- [ ] `worker_delegate` calls the Worker HTTP API rather than spawning a hidden second implementation.
- [ ] Default requested sandbox is `danger-full-access` unless explicitly overridden by tool args/environment.
- [ ] A real Worker `task_id` is discoverable from tool output/events.
- [ ] Studio begins polling that exact task id.
- [ ] Worker status display matches `/api/worker/status/{task_id}`.
- [ ] Worker failure is displayed as failure, not converted into a completed badge.

## I. New API and model catalog

Use a real OpenAI-compatible upstream.

- [ ] Enter Base URL + API Key and save.
- [ ] Worker `/api/catalog` refreshes with the actual upstream model list.
- [ ] API Key input is cleared immediately after save.
- [ ] Hermes Custom Endpoint is created/updated through its official API.
- [ ] Re-saving the same Base URL updates the existing endpoint instead of intentionally creating a parallel browser-owned model store.
- [ ] Every visible New API model comes from the Worker registry.
- [ ] Per-model Test performs a real Worker connectivity request.
- [ ] A bad model/key visibly fails.

## J. Reasoning capability integrity

Use at least two model cases: one with advertised effort levels and one without.

- [ ] Advertised model slider stops exactly match upstream values plus Auto.
- [ ] Model without advertised efforts shows only Auto and the slider is disabled.
- [ ] Changing model recomputes the slider from that model's capabilities.
- [ ] No `low/medium/high/xhigh` ladder appears unless those exact strings were actually returned by upstream.

## K. Unified routing

For AUTO or WORKER/DELEGATE mode:

- [ ] Main / Worker / Verifier all use the same live model catalog.
- [ ] Saving routes persists through Worker `/api/routing`.
- [ ] Chat header initially reflects the persisted Main route.
- [ ] Changing the chat model writes the same Main route and survives refresh.
- [ ] Worker Routing page then shows the same Main selection.
- [ ] If Hermes can uniquely resolve provider+model from `/api/model/options`, the active Session receives a model lock.
- [ ] If provider resolution is ambiguous, Studio does not guess a provider.

For OFFICIAL mode:

- [ ] Studio does not write custom Main/Worker/Verifier routing overrides.
- [ ] Official runtime remains controlled by the installed Hermes/Codex runtime.

## L. Unattended mode

Use a disposable trusted environment for this test.

- [ ] Click Apply official unattended configuration.
- [ ] Hermes config contains `approvals.mode: off`.
- [ ] `cron_mode`, `single_query_mode`, and `unattended_mode` are `approve`.
- [ ] `mcp_reload_confirm` and `destructive_slash_confirm` are false.
- [ ] A normal dangerous-command approval prompt no longer blocks API/automation work.
- [ ] Hermes hardline blocklist still rejects one safe-to-test representative pattern without executing it.

## M. Degraded operation

- [ ] Stop Worker: history/search/archive remain usable.
- [ ] Restart Worker: Worker page recovers after refresh without reinstalling Studio.
- [ ] Stop Hermes API Server: management/history still render while new turns fail clearly.
- [ ] Restart API Server: new turns work again without reinstalling Studio.
- [ ] Provide an invalid New API URL/key: existing Hermes conversations/history are unaffected.

## N. Upgrade / rollback

- [ ] Upgrade Hermes to the intended long-term version.
- [ ] Re-run all contract/static checks and the focused smoke checks above.
- [ ] Run Worker project's own production/archive seal commands for its exact version.
- [ ] Re-run `scripts/install.sh`; install is idempotent.
- [ ] Keep the previous Worker Studio commit/tag available.
- [ ] Rollback consists only of replacing/disabling this plugin; no Hermes database migration is required by Studio.

## O. Evidence and final seal

Store with the release/tag:

- [ ] CI run URL / commit SHA.
- [ ] `hermes plugins doctor --ci` output.
- [ ] `/v1/capabilities` sanitized output.
- [ ] Worker `/api/health` and sanitized `/api/catalog` output.
- [ ] Screenshot/video of live real tool events and final collapsed duration.
- [ ] Screenshot of 10-session recent rail and paged full history.
- [ ] Screenshot of New API model test and actual reasoning slider values.
- [ ] Sanitized config excerpt showing unattended policy.
- [ ] Version matrix (Hermes / Worker / Studio / OS / Node / Python).

Only after these are attached should the exact commit be tagged as the archive/sealed release.
