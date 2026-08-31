# Automated Test Matrix

A green GitHub workflow proves the repository is an **ARCHIVE CANDIDATE** against the pinned Hermes snapshot. It does not prove target-machine credentials/services.

## Job: Studio static + unit + UI runtime

| Gate | Evidence |
|---|---|
| Python syntax | `compileall` over plugin/backend/scripts/tests |
| JS syntax | shipped `dashboard/dist/index.js` + jsdom harness |
| Shell syntax | installer `bash -n` |
| Architecture | `scripts/verify_contract.py` |
| Unit/integration | `python -m unittest discover` |
| Product UI | `tests/frontend_runtime.mjs` |
| Manifest | JSON parser |
| Frontend dependencies | high-severity `npm audit` |

Product-flow test covers: recent 10, current 40, full-history pagination/search/archive, first-level navigation, four modes, Hermes model catalog, New API endpoint save, real model-probe route, unattended config/read-back/probe, Run timeline/todo/approval/steer/stop and Skills change rendering.

## Job: Pinned Hermes public contracts

Checks exact checkout SHA from `tests/upstream-lock.json` and verifies the required documented/plugin surfaces exist. The lock contains Hermes only.

Contract families: Dashboard Plugin SDK, PluginContext lifecycle/hooks/tools, Runs API, model/options/custom endpoints, sessions/search/archive, approvals/config, Skills/Plugins/MCP.

## Job: Hermes lifecycle + Runs + approvals + Plugin Doctor

Installs the pinned Hermes snapshot and runs selected Hermes-owned regression suites:

- `tests/agent/test_subagent_lifecycle.py`
- `tests/gateway/test_api_server_runs.py`
- `tests/tools/test_approval.py`

Then Hermes Plugin Doctor dynamically validates the Studio manifest/tool registration.

This protects against a snapshot whose files still exist but semantics are broken.

## Job: Production security + dependency boundary

- Bandit on production Python;
- obvious committed-secret rejection;
- second-runtime sentinel rejection in production/install files.

`verify_contract.py` additionally rejects private Hermes delegation imports, direct SQLite persistence, duplicate model registry behavior, browser bearer-secret use and hard-coded reasoning ladders.

## Failure policy

No flaky bypass, `continue-on-error`, or “known failure” exemption is accepted for archive gates. A failing selected Hermes upstream test blocks the seal until the pin or Studio contract is deliberately updated.

## Definition

- PR CI all green: mergeable archive candidate.
- `main` post-merge CI all green: repository archive candidate.
- target-machine `SEAL_CHECKLIST.md` all green with captured evidence: **SEALED**.
