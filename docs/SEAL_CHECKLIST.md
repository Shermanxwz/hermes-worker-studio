# Final Seal Checklist — Product 3

`SEAL_ACCEPTANCE.md` is canonical. This checklist is diagnostic only.

## 1. Exact candidate + official upstream

- [ ] tracked working tree is clean;
- [ ] current SHA is the intended PR head;
- [ ] exact-head CI is green;
- [ ] `tests/upstream-lock.json` contains only Hermes as runtime upstream;
- [ ] baseline pinned-upstream verification passes;
- [ ] `dashboard_route_scoped_exclusive_shell.required_for_seal=true` remains pinned;
- [ ] `scripts/verify_required_upstream_contracts.py` passes against that exact official Hermes commit;
- [ ] upstream issue `NousResearch/hermes-agent#100149` is resolved by the pinned official contract (or superseded by an equivalent documented contract reviewed with the pin bump).

If the exclusive-shell verifier is red, status is **ARCHIVE CANDIDATE**, never SEALED.

## 2. One-command closure

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

The command must produce:

- `.seal/upstream.json`
- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json`

There is no upstream-contract skip flag.

## 3. upstream.json

- [ ] schema is `hermes-worker-studio.upstream-gate.v1`;
- [ ] `ok=true`;
- [ ] repository is `NousResearch/hermes-agent`;
- [ ] commit equals `tests/upstream-lock.json`;
- [ ] `dashboard_route_scoped_exclusive_shell.verified=true`.

## 4. target.json

- [ ] running Product 3 reports exact candidate SHA;
- [ ] execution plane is Hermes `official_runs`;
- [ ] Worker plane is `PluginContext.subagent_lifecycle`;
- [ ] model catalog is `/api/model/options`;
- [ ] Session create -> rename -> archive -> unarchive -> delete completes;
- [ ] real model Run completes and marker verifies;
- [ ] canonical todo has >=3 monotonic persisted revisions, an in-progress phase and all-final-completed state;
- [ ] Studio projection contains canonical todo evidence.

## 5. ui-report.json — product takeover

On `/`:

- [ ] only Worker Studio product navigation is visible normally;
- [ ] `HERMES_PRIMARY` release navigation is empty;
- [ ] Sessions / Cron / Skills / Plugins / MCP / Profiles / Analytics / Logs / Config are only under `高级 · Hermes Dashboard`;
- [ ] total native-route link counts equal the counts inside Advanced — no second Hermes shell navigation exists anywhere else in the DOM;
- [ ] composer is usable, arbitrary-file picker is installed and there is no horizontal overflow;
- [ ] Gateway marker reports arbitrary attachments, durable resume and no-wait input responders;
- [ ] desktop Chromium and Pixel 7 projects pass.

On native `/sessions`:

- [ ] normal Hermes shell/navigation returns;
- [ ] at least one `← Worker Studio` official slot is visible and works back to `/`.

## 6. Runtime closure

- [ ] WebSocket is transport only; durable Session is authoritative;
- [ ] `session.resume(close_on_disconnect=false)`;
- [ ] disconnect -> reconnecting -> fresh authenticated socket -> resume/rebind;
- [ ] image -> `image.attach_bytes`;
- [ ] PDF -> `pdf.attach`;
- [ ] generic file -> `file.attach` + returned `@file:` ref;
- [ ] picker / paste / drag-drop use one file path;
- [ ] Full Access sets Hermes `approvals.mode=off`, headless approval modes to approve and subagent auto-approval;
- [ ] approval auto-resolves, Clarify skips, MCP setup declines, unavailable sudo/secret/terminal input cancels immediately;
- [ ] missing credentials/MFA may fail the task but never leave Studio waiting indefinitely;
- [ ] Hermes Hardline Blocklist remains authoritative.

## 7. Architecture/security

- [ ] no second runtime/model/planner/tokenizer;
- [ ] no private `AIAgent`/delegation implementation import;
- [ ] no direct Hermes database access;
- [ ] no browser bearer secret;
- [ ] no Hermes core patch or DOM/CSS navigation monkey-hack;
- [ ] official Hermes favicon is reused.

## 8. Final decision

```bash
python scripts/verify_seal_evidence.py
```

`SEALED.json` must be `eligible=true`, name the exact Worker Studio candidate, and record the exact verified Hermes upstream commit. Only then may PR #4 become Ready and merge.
