# Real Target Seal Workflow

Product 3 can close the final seal from the real Hermes machine without copying evidence by hand.

## Target runner

Register the Hermes target machine as a GitHub self-hosted runner for this repository and add the custom label:

```text
hermes-seal
```

The workflow deliberately requires both `self-hosted` and `hermes-seal`, so it cannot land on an unrelated self-hosted machine.

The target runner must have the configured Hermes installation available on `PATH`, the Hermes Dashboard/API running, and access to the provider/model that will be used for the real Run. Node/Python toolchains are normalized by Actions; Playwright Chromium is installed by `scripts/seal_close.py` unless already present.

If the Dashboard requires authentication, configure the repository Actions secret:

```text
HERMES_SEAL_API_SERVER_KEY
```

Do not commit that key and do not expose it to the browser bundle.

## One workflow

Use **Actions → Seal Real Hermes Target → Run workflow** only after the current PR head CI is green.

Inputs:

- `pr_number`: PR to finalize (Product 3 is currently PR `4`).
- `candidate_sha`: full 40-character current PR head SHA.
- `dashboard_url`: normally `http://127.0.0.1:19119` on the target runner.
- `provider` / `model`: optional explicit Hermes route for the real Run.
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
  ├─ atomic plugin install + candidate stamp
  ├─ running Dashboard candidate read-back
  ├─ real Hermes /v1/runs turn
  ├─ canonical todo revision proof
  ├─ session CRUD cleanup
  ├─ desktop Chromium + Pixel 7 Playwright
  └─ independent .seal/SEALED.json verdict
  ↓
upload .seal evidence artifact
  ↓
scripts/github_finalize_seal.py
  ├─ require eligible=true for the exact SHA
  ├─ require open PR head still equals the exact SHA
  ├─ require latest exact-head pull_request CI named CI is success
  ├─ mark Draft PR Ready
  ├─ re-read PR head again
  └─ merge with the candidate SHA precondition
```

If the PR head changes at any point, if CI is no longer green, if the running Dashboard reports a different installed candidate, or if real Hermes/Playwright evidence fails, finalization stops and the PR remains unmerged.

## Evidence

The workflow uploads the `.seal/` directory as a GitHub Actions artifact even when a later finalization step fails. A successful seal contains at minimum:

- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json` with `eligible: true`

These artifacts are evidence only. They do not replace the exact-head CI and real-target gates enforced again by the GitHub finalizer.
