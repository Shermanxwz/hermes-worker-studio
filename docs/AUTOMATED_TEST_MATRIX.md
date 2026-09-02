# Automated Test Matrix — Product 3

A green GitHub workflow proves the exact PR head is an **ARCHIVE CANDIDATE** against the pinned Hermes snapshot. Real target credentials/services and browser layout are closed separately by `scripts/seal_close.py`.

## Job: Studio static + unit + UI runtime

| Gate | Evidence |
|---|---|
| Python syntax | `compileall` over plugin/backend/scripts/tests |
| JS syntax | v2 compatibility bundle, Product 3 bundle, mounted runtime harnesses, Playwright config/spec |
| Shell syntax | `scripts/install.sh` |
| Architecture | `scripts/verify_contract.py` |
| Unit / HTTP / installer | `python -m unittest discover` |
| Mounted Product 3 behavior | `npm run test:frontend` |
| Seal CLIs | `seal_acceptance.py`, `verify_seal_evidence.py`, `seal_close.py` help gates |
| Manifest | JSON parser |
| Frontend dependencies | high-severity `npm audit` |

Mounted Product 3 tests cover:

- official Dashboard plugin registration and `/` product ownership;
- `header-left` native return slot;
- recent/session/history contracts;
- lazy new-session creation + Session CRUD;
- clipboard image → structured multimodal Run input;
- Run polling, canonical plan rendering and completion;
- Stop / Steer / approval control wiring;
- Full Access config enable/readback/real-probe wiring/restore;
- Custom Endpoint validate/edit/activate/delete and URL normalization;
- real model-probe route wiring;
- Worker / Verifier route persistence;
- project mark through the official Hermes plugin static-asset route and installed candidate-SHA contract.

## Job: Pinned Hermes public contracts

Checks exact Hermes checkout SHA from `tests/upstream-lock.json` and verifies required documented/plugin surfaces. The lock contains Hermes only.

Contract families:

- Dashboard Plugin SDK and slots;
- `PluginContext` lifecycle/hooks/tools;
- Runs submission/status/events/controls;
- model/options/custom endpoints;
- sessions/search/archive/messages;
- approvals/config;
- Skills/Plugins/MCP;
- pinned Hermes `web/public/favicon.ico` provenance for the upstream baseline (the Product 3 install uses its own plugin static project mark).

## Job: Hermes lifecycle + Runs + approvals + Plugin Doctor

Installs the exact pinned Hermes snapshot and runs Hermes-owned regression suites:

- `tests/agent/test_subagent_lifecycle.py`
- `tests/gateway/test_api_server_runs.py`
- `tests/tools/test_approval.py`

Then Hermes Plugin Doctor validates Studio manifest/tool registration and requires exactly `worker_delegate`, `worker_status`, `worker_catalog`.

## Job: Production security + dependency boundary

- Bandit on production Python;
- committed-secret rejection;
- second-runtime sentinel rejection in production/install files.

`verify_contract.py` additionally rejects private Hermes delegation imports, direct SQLite persistence, duplicate model-registry behavior, browser bearer-secret use, hard-coded reasoning ladders, obsolete sidecar launchers and independent installed branding.

## Real-target machine gate

`python scripts/seal_close.py --url <Dashboard>` produces the evidence CI cannot manufacture on GitHub-hosted runners:

1. exact candidate installation and running `/product-capabilities.candidate_sha` read-back;
2. real Hermes session CRUD lifecycle;
3. real model `/v1/runs` turn;
4. three-step Hermes canonical todo with >=3 monotonic persisted revisions and fully completed final state;
5. real Studio todo projection event;
6. desktop Chromium real-target acceptance;
7. Pixel 7 mobile-emulation real-target acceptance;
8. independent cross-evidence verdict.

Machine outputs:

- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json`

## Failure policy

No flaky bypass, `continue-on-error`, static-only seal, or “known failure” exemption is accepted. A failing selected Hermes upstream test blocks the candidate. A target candidate mismatch blocks before final evidence closure. A failed/timed-out/interrupted Playwright result blocks the final verifier.

## Definition

- exact PR-head CI all green: **ARCHIVE CANDIDATE**;
- exact same SHA + real-target `seal_close.py` exit 0 + `.seal/SEALED.json eligible=true`: **technically SEALED / eligible for Ready+merge**.

`SEAL_ACCEPTANCE.md` is the canonical release contract.
