# Real Target Seal Workflow

Product 3 closes its final seal only against the **exact current `main` commit**. Development PRs are merged first while the repository is still an `ARCHIVE CANDIDATE`; real-target evidence is captured afterward so the commit installed, executed, rendered in browsers, verified on GitHub, and ultimately named `SEALED` is one immutable SHA.

## Target runner

Register the Hermes target machine as a GitHub self-hosted runner for this repository and add the custom label:

```text
hermes-seal
```

The workflow deliberately requires both `self-hosted` and `hermes-seal`, so it cannot land on an unrelated self-hosted machine. It is manual-only and has GitHub permissions `actions: read` plus `contents: read`; the target host cannot merge a PR or write repository contents.

The runner must have the intended Hermes installation available, the Hermes Dashboard/API running, and access to the provider/model used for the real Run/protocol evidence. Node/Python toolchains are normalized by Actions; Playwright Chromium is installed by `scripts/seal_close.py` unless already present.

If the Dashboard requires authentication, configure the repository Actions secret:

```text
HERMES_SEAL_API_SERVER_KEY
```

Do not commit that key and do not expose it to the browser bundle.

## Release order

A feature/closure PR is **not** the seal identity. The order is:

```text
PR exact-head CI green
  ↓
merge PR into main
  ↓
main push CI green
  ↓
repository is ARCHIVE CANDIDATE
  ↓
manual real-target seal of exact current main HEAD
```

This ordering is intentional. Sealing a PR head and then merging would create a different `main` SHA for merge/squash/rebase workflows, invalidating the claim that the sealed evidence belongs to the canonical repository commit.

## Manual workflow inputs

Use **Actions → Seal Real Hermes Target → Run workflow** only after the exact current `main` HEAD has a green push CI.

Inputs:

- `candidate_sha`: full 40-character **current `main` HEAD** SHA.
- `dashboard_url`: normally `http://127.0.0.1:19119` on the target runner.
- `provider` / `model`: optional explicit Hermes route for the real Run. They must be provided together or both omitted; the seal must never silently test a different route.
- `reasoning_effort`: optional concrete reasoning level such as `high`, `xhigh`, or `max`. It is accepted only when `provider` and `model` are explicit. `auto` is rejected because an exact reasoning seal must prove one concrete value.

When `reasoning_effort` is supplied, the target acceptance gate additionally requires the exact Provider + Model route to publish that value through one of the sealed authoritative sources:

1. rich Hermes `/api/model/options` capability metadata;
2. exact model metadata in Hermes `/api/config`;
3. provider-level `hws_reasoning_defaults` in Hermes `/api/config`.

A bare `reasoning: true` is insufficient. Missing or conflicting vocabulary fails closed before the real model Run.

There is no PR number, merge method, finalize switch, or repository-write step in the target workflow.

## Reasoning evidence boundary

For a reasoning-target seal, Worker Studio sends the concrete value through the documented Hermes Runs request contract:

```json
{
  "provider": "new-api",
  "model": "the-selected-model",
  "model_options": {
    "reasoning_effort": "xhigh"
  }
}
```

`target.json` records the requested effort, the explicit capability source that authorized it, the exact `model_options` value submitted to Hermes, the resolved execution route, and successful completion of the real Run.

Repository CI separately pins the exact Hermes revision's Runs and provider-transport reasoning contracts, including Chat Completions reasoning construction and Codex/Responses `reasoning.effort` construction. Together these prove the code boundary from Studio into Hermes and Hermes' pinned wire semantics without pretending that Worker Studio can observe a third-party gateway's private ingress logs.

A literal byte-for-byte proof of what a deployed New API instance received requires observability on that New API instance (or a controlled transparent capture proxy). The seal never fabricates such evidence. If that stronger deployment-specific evidence is required, capture it on the target infrastructure and retain it alongside `.seal/` as an external wire artifact.

## Closure order

```text
manual workflow_dispatch
  ↓
self-hosted + hermes-seal target
  ↓
checkout exact candidate SHA
  ↓
fetch origin/main and require origin/main == candidate SHA
  ↓
reject dirty tracked checkout
  ↓
scripts/seal_close.py
  ├─ required official upstream-contract gate
  ├─ deterministic staged artifact + atomic install + candidate stamp
  ├─ running Dashboard candidate read-back
  ├─ target evidence schema v2
  ├─ real Hermes Run + canonical todo evidence
  ├─ optional concrete reasoning-effort declaration + real-Run evidence
  ├─ actual resolved execution route evidence
  ├─ Session CRUD cleanup + post-delete 404
  ├─ desktop 1440×900 Chromium
  ├─ Pixel 7 portrait Chromium
  ├─ compact touch landscape 667×375 Chromium
  ├─ each browser project reads running product-capabilities.candidate_sha
  ├─ every first-level Studio page viewport/overflow checks
  └─ independent seal-verdict v2
  ↓
upload .seal evidence artifact
  ↓
scripts/github_finalize_seal.py (read-only)
  ├─ require eligible=true for exact candidate
  ├─ require repository default branch == main
  ├─ require current main HEAD == candidate
  └─ require exact-main push CI from .github/workflows/ci.yml == success
```

Nothing mutates repository code after evidence capture. If `main` moves at any time, if push CI is not green, if the running Dashboard reports another candidate, if the required upstream contract is absent, if the real execution route is unresolved, if a requested reasoning effort is not explicitly declared, or if any required browser project fails/skips its product-shell test, the candidate is not sealed.

## Browser security

TLS certificate errors are rejected by default. Only a deliberately trusted local/test certificate environment may opt in with:

```text
HWS_SEAL_IGNORE_HTTPS_ERRORS=1
```

This is explicit so a seal run never silently weakens transport validation.

## Evidence

The workflow uploads `.seal/` even if a later verification step fails. A successful seal contains at minimum:

- `.seal/upstream.json`
- `.seal/target.json` using `hermes-worker-studio.seal-evidence.v2`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json` using `hermes-worker-studio.seal-verdict.v2` with `eligible: true`

When a concrete reasoning effort is requested, `.seal/target.json` also contains `checks.real_run.reasoning` with the requested effort, declaration source, submitted Hermes `model_options`, and completed real-run result.

These artifacts do not replace the exact-main GitHub checks. The read-only finalizer verifies that the repository still points `main` at the exact candidate and that the canonical push CI is green.
