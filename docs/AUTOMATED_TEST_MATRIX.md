# Automated Test Matrix — Product 3

A green GitHub workflow proves an exact commit is a repository-level **ARCHIVE CANDIDATE** against the pinned Hermes snapshot. Real target credentials/services, exact installed identity and browser layout are closed separately by `scripts/seal_close.py`.

## Job: Studio static + unit + UI runtime

| Gate | Evidence |
|---|---|
| Python syntax | `compileall` over plugin/backend/scripts/tests |
| JS syntax | compatibility bundle, Gateway entry, Product 3 source, mounted runtime harnesses, Playwright config/spec |
| Shell syntax | `scripts/install.sh` |
| Architecture | `scripts/verify_contract.py` |
| Unit / HTTP / installer | `python -m unittest discover` |
| Exact staged artifact | run both release transforms, then `node --check` + Python compile + closure assertions |
| Mounted Product 3 behavior | `npm run test:frontend` |
| Seal CLIs | acceptance/evidence/upstream/close/finalize help gates |
| Manifest | JSON parser |
| Frontend dependencies | high-severity `npm audit` |

The exact staged-artifact gate is intentional: checked-in review source is not accepted as proof of the installed candidate. CI reproduces the installer build path (`stage_product_bundle.py` then `stage_mixed_protocol.py`) and validates the resulting JS/Python.

Mounted Product 3 tests cover, among other existing behavior:

- official Dashboard plugin registration and `/` product ownership;
- official native return slots;
- recent/session/history/search contracts;
- lazy new-session creation + Session CRUD;
- arbitrary attachment conversion and structured Run input;
- Run polling, canonical plan/context projection and completion;
- Stop / Steer / approval control wiring;
- Full Access enable/readback/real-probe wiring/restore;
- Custom Endpoint validate/edit/activate/delete and API-root normalization;
- real model-probe route wiring;
- Worker / Verifier route persistence;
- mixed Chat/Responses first-use resolution, non-heuristic behavior, ambiguity fail-closed and concurrent-probe de-duplication;
- project mark through official Hermes plugin static assets;
- candidate-SHA installation contract;
- staged dialog/menu/disclosure/composer/mobile accessibility semantics and JS syntax.

## Job: Pinned Hermes public contracts

Checks the exact Hermes checkout SHA from `tests/upstream-lock.json` and verifies required documented/plugin surfaces. The lock contains Hermes only.

Contract families include Dashboard Plugin SDK/slots, `PluginContext`, subagent lifecycle/hooks/tools, Runs, model/options/custom endpoints, Sessions, approvals/config, Skills/Plugins/MCP and the pinned Dashboard branding baseline.

## Job: Hermes lifecycle + Gateway attachments + Runs + approvals + Plugin Doctor

Installs the exact pinned Hermes snapshot and runs Hermes-owned regression suites covering public subagent lifecycle, API Server Runs, approvals, Gateway todo/attachments and context. Hermes Plugin Doctor must then discover exactly:

- `worker_delegate`
- `worker_status`
- `worker_catalog`
- one `pre_tool_call` hook

## Job: Production security + dependency boundary

- Bandit over production Python plus deterministic release transforms;
- committed-secret rejection;
- second-runtime sentinel rejection across runtime, CSS, installer and transform files.

`verify_contract.py` additionally rejects private Hermes delegation imports, direct SQLite persistence, browser bearer-secret use, hard-coded reasoning ladders, obsolete sidecar launchers and independent installed branding. It also locks the final CSS chain, bounded Worker convenience state, mixed-protocol transform and installer staging contract.

## Real-target machine gate

`python scripts/seal_close.py --url <Dashboard>` produces evidence GitHub-hosted runners cannot manufacture:

1. exact candidate installation and running `/product-capabilities.candidate_sha` read-back;
2. real Hermes Session lifecycle;
3. real Gateway/product context and official Runs probe evidence;
4. canonical todo evolution and Studio projection evidence;
5. real mixed-provider protocol evidence where applicable;
6. desktop Chromium product acceptance;
7. phone portrait Chromium acceptance;
8. compact 667×375 landscape/touch acceptance;
9. every existing first-level Studio page checked in every product viewport for horizontal overflow and viewport-bound layout;
10. desktop native `/sessions` return path;
11. independent cross-evidence verdict.

Machine outputs:

- `.seal/upstream.json`
- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json`

## Failure policy

No flaky bypass, `continue-on-error`, static-only seal or “known failure” exemption is accepted. A failed selected Hermes upstream test blocks the candidate. A staged-transform source-anchor drift blocks before install. A target candidate mismatch blocks evidence closure. A failed/timed-out/interrupted Playwright project blocks the final verifier.

HTTPS certificate errors are **not ignored by default** in the seal browser. An operator may opt in only with `HWS_SEAL_IGNORE_HTTPS_ERRORS=1` for a deliberately trusted local/test certificate environment; that choice is explicit rather than silently weakening every run.

## Definition

- exact candidate CI all green: **ARCHIVE CANDIDATE**;
- exact same SHA + real-target `seal_close.py` exit 0 + `.seal/SEALED.json eligible=true` + required upstream exclusive-shell gate: **technically SEALED**.

`SEAL_ACCEPTANCE.md` remains the canonical release contract.
