# Real Target Seal Workflow

Product 3 can close the final seal from the real Hermes machine without copying evidence by hand.

## Target runner

Register the Hermes target machine as a GitHub self-hosted runner for this repository and add the custom label:

```text
hermes-seal
```

The workflow deliberately requires both `self-hosted` and `hermes-seal`, so it cannot land on an unrelated self-hosted machine.

The target runner must have the intended Hermes installation available, the Hermes Dashboard/API running, and access to the provider/model used for the real Run/protocol evidence. Node/Python toolchains are normalized by Actions; Playwright Chromium is installed by `scripts/seal_close.py` unless already present.

If the Dashboard requires authentication, configure the repository Actions secret:

```text
HERMES_SEAL_API_SERVER_KEY
```

Do not commit that key and do not expose it to the browser bundle.

## One workflow

Use **Actions → Seal Real Hermes Target → Run workflow** only after the **exact current candidate** CI is green.

Inputs:

- `pr_number`: the current PR to finalize; never reuse a historical PR number from documentation.
- `candidate_sha`: full 40-character current PR head SHA.
- `dashboard_url`: normally `http://127.0.0.1:19119` on the target runner.
- `provider` / `model`: optional explicit Hermes route for real target execution evidence.
- `merge_method`: `merge`, `squash`, or `rebase`.
- `finalize`: when true, mark Ready and merge only after every seal gate passes.

The workflow is **manual-only**. It is intentionally not triggered by `push`, `pull_request`, or `pull_request_target`, because arbitrary branch code must never execute automatically on the Hermes target host.

## Closure order

```text
manual workflow_dispatch
  ↓
self-hosted + hermes-seal target
  ↓
checkout exact candidate SHA
  ↓
reject wrong/dirty tracked checkout
  ↓
scripts/seal_close.py
  ├─ upstream required-contract gate
  ├─ deterministic staged artifact + atomic install + candidate stamp
  ├─ running Dashboard candidate read-back
  ├─ real Hermes Gateway / official Runs / Session / todo evidence
  ├─ mixed-provider protocol evidence when applicable
  ├─ session CRUD cleanup
  ├─ desktop 1440×900 Chromium
  ├─ Pixel 7 portrait Chromium
  ├─ compact touch landscape 667×375 Chromium
  ├─ every first-level Studio page viewport/overflow checks
  └─ independent .seal/SEALED.json verdict
  ↓
upload .seal evidence artifact
  ↓
scripts/github_finalize_seal.py
  ├─ require eligible=true for the exact SHA
  ├─ require open PR head still equals the exact SHA
  ├─ require latest exact-head pull_request CI named CI is success
  ├─ mark Draft PR Ready when applicable
  ├─ re-read PR head again
  └─ merge with the candidate SHA precondition
```

If the PR head changes, CI is no longer green, the running Dashboard reports a different installed candidate, the required upstream contract is absent, or real Hermes/Playwright evidence fails, finalization stops and the candidate remains unsealed.

## Browser security

TLS certificate errors are rejected by default. Only a deliberately trusted local/test certificate environment may opt in with:

```text
HWS_SEAL_IGNORE_HTTPS_ERRORS=1
```

This is explicit so a seal run never silently weakens transport validation.

## Evidence

The workflow uploads the `.seal/` directory as a GitHub Actions artifact even when a later finalization step fails. A successful seal contains at minimum:

- `.seal/upstream.json`
- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json` with `eligible: true`

These artifacts are evidence only. They do not replace the exact-head CI, required upstream gate, exact installed identity, or real-target gates enforced by the final verifier/finalizer.
