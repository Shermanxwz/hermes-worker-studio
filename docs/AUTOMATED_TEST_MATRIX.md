# Automated Test Matrix — Product 3

A green GitHub workflow proves an exact commit is a repository-level **ARCHIVE CANDIDATE** against the pinned Hermes snapshot. Final `SEALED` evidence is captured only after the intended changes are merged and the exact current `main` HEAD has a green push CI.

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

The staged-artifact gate is intentional: checked-in review source is not accepted as proof of the installed candidate. CI reproduces the installer build path (`stage_product_bundle.py` then `stage_mixed_protocol.py`) and validates the resulting JS/Python.

Mounted/unit coverage includes:

- official Dashboard plugin registration and `/` product ownership;
- Gateway durable resume/input/attachment behavior;
- Session CRUD/search/history boundaries;
- structured arbitrary attachment input;
- canonical todo/context projection;
- Stop / Steer / approval wiring;
- Full Access config round-trip/restore;
- Custom Endpoint lifecycle and API-root normalization;
- Worker / Verifier route persistence;
- mixed Chat/Responses first-use resolution, non-heuristic behavior, ambiguity fail-closed and concurrent-probe de-duplication;
- candidate-SHA installation contract;
- final CSS/a11y/touch/short-viewport contract;
- target evidence v2 and seal verdict v2 schema compatibility;
- provider/model pair requirement for a specific real-target route;
- browser evidence requiring three actual passed viewport projects;
- exact-main read-only GitHub finalization and canonical workflow-path verification.

## Job: Pinned Hermes public contracts

Checks the exact Hermes checkout SHA from `tests/upstream-lock.json` and verifies required documented/plugin surfaces. The lock contains Hermes only.

Contract families include Dashboard Plugin SDK/slots, `PluginContext`, subagent lifecycle/hooks/tools, Runs, model/options/custom endpoints, Sessions, approvals/config, Skills/Plugins/MCP and the pinned Dashboard branding baseline.

## Job: Hermes lifecycle + Gateway attachments + Runs + approvals + Plugin Doctor

Installs the exact pinned Hermes snapshot and runs Hermes-owned regression suites covering public subagent lifecycle, API Server Runs, approvals, Gateway todo/attachments and context. Hermes Plugin Doctor must discover exactly the three Studio tools plus one `pre_tool_call` hook.

## Job: Production security + dependency boundary

- Bandit over production Python plus deterministic release transforms;
- committed-secret rejection;
- second-runtime sentinel rejection across runtime, CSS, installer and transform files.

`verify_contract.py` additionally locks the sole-Hermes architecture, final CSS chain, deterministic transforms, exact installed artifact, evidence schemas and read-only exact-main target workflow.

## Real-target machine gate

`python scripts/seal_close.py --url <Dashboard>` runs only for the exact current `main` candidate and produces evidence GitHub-hosted runners cannot manufacture:

1. upstream required-contract evidence;
2. target evidence schema `hermes-worker-studio.seal-evidence.v2`;
3. exact candidate installation and running `product-capabilities.candidate_sha` read-back;
4. real Hermes Session create/rename/archive/unarchive/delete + post-delete 404;
5. real Hermes Run, canonical todo evolution and marker proof;
6. final resolved execution route evidence, including the actual execution Provider and protocol mode where applicable;
7. desktop Chromium product acceptance;
8. Pixel 7 portrait acceptance;
9. compact 667×375 landscape/touch acceptance;
10. each product viewport independently reads and verifies the running candidate SHA;
11. every existing first-level Studio page is checked for overflow/viewport bounds;
12. desktop native `/sessions` return path;
13. seal verdict schema `hermes-worker-studio.seal-verdict.v2`.

Machine outputs:

- `.seal/upstream.json`
- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json`

## GitHub exact-main gate

The manual self-hosted workflow is read-only (`actions: read`, `contents: read`). Before running the target seal it fetches `origin/main` and requires that `origin/main` equals the requested candidate SHA.

After real-target evidence closes, `github_finalize_seal.py` performs no mutation. It requires:

- repository default branch is `main`;
- current `main` commit still equals the sealed candidate;
- the latest exact-candidate `push` run named `CI` comes from `.github/workflows/ci.yml` and is completed/success;
- `.seal/SEALED.json` is verdict v2, eligible and names the same SHA.

A PR-head CI, a same-name workflow at another path, a skipped viewport test, or a post-evidence branch change cannot satisfy the final gate.

## Failure policy

No flaky bypass, `continue-on-error`, static-only seal or “known failure” exemption is accepted. A staged-transform anchor drift, schema mismatch, target candidate mismatch, unresolved execution route, cleanup failure, missing/skipped required browser pass, non-main candidate, or non-green exact-main push CI blocks sealing.

HTTPS certificate errors are not ignored by default. `HWS_SEAL_IGNORE_HTTPS_ERRORS=1` is an explicit trusted local/test override only.

## Definition

- PR/exact commit CI green: candidate is healthy enough to merge as **ARCHIVE CANDIDATE**;
- exact current `main` push CI green: canonical repository remains **ARCHIVE CANDIDATE**;
- exact same `main` SHA + required upstream gate + real-target v2 evidence + three passed browser projects + verdict v2 + read-only exact-main GitHub verification: **SEALED**.

`SEAL_ACCEPTANCE.md` remains the canonical release contract.
