# Seal Status

Status: **ARCHIVE CANDIDATE**

Product: **Hermes Worker Studio 3.0** — Hermes-native single-runtime product shell.

This file intentionally does **not** hard-code a current PR number or treat an older target capture as proof for newer code. Development changes are merged first; the only final seal identity is the exact current **`main` HEAD** supplied to the real-target workflow / `seal_close.py`.

Repository branch policy is equally strict: **`main` is the only long-lived source of truth**. Feature, seal and upstream-contribution branches are temporary transport only; once their evidence or code is preserved on `main`, they carry no authoritative state and should be deleted. A Git tag or GitHub Release is optional distribution metadata and is not part of seal eligibility.

## Current repository engineering state

The repository has reached code-level archive-candidate closure around these invariants:

- Hermes is the only runtime upstream, pinned in `tests/upstream-lock.json`;
- product chat uses the official Hermes TUI Gateway WebSocket (`session.resume`, `prompt.submit`, Gateway context/todo/tool/subagent events);
- official `/v1/runs` remains the probe/acceptance/unattended rail, not a second product chat runtime;
- Worker uses `PluginContext.subagent_lifecycle`; native `delegate_task` remains Hermes-owned;
- Main / Worker / Verifier / MOA share Hermes model inventory and the same per-model execution-route resolver;
- mixed custom endpoints can contain Chat Completions and Responses-only models without a provider-global guess;
- first unresolved model use performs real Hermes Chat/Responses probes, caches exactly verified routing, deduplicates concurrent first-use probes, and fails closed on ambiguous/both-failed outcomes;
- reasoning effort is emitted only from explicit upstream capability metadata;
- Session/history/search/archive, config, Custom Endpoints, MOA, Skills/Plugins/MCP ownership remain on official Hermes surfaces;
- there is no second model registry, planner, tokenizer, worker daemon, queue or persistence database;
- candidate installation is candidate-SHA stamped and transactionally rollback-safe; existing installs prefer `renameat2(RENAME_EXCHANGE)`, while the portable fallback retains the previous tree until post-swap validation commits;
- the exact installed path must pass Plugin Doctor before official enable, and post-swap Doctor/enable failure restores the previous plugin/theme without transaction residue;
- deterministic release transforms are exact-count/fail-closed and independently built/syntax-checked in CI;
- staged private protocol/projection state uses exclusive/no-follow mode-`0600` temporary files before rename; malformed JSON mutation bodies fail closed as HTTP 400;
- npm is a private test-only harness boundary: production dependency fields are forbidden, devDependencies are exact-pinned, package/lock roots must match, and CI installs with lifecycle scripts disabled; canonical seal CI does not depend on a live npm advisory endpoint;
- final UI stylesheet is `product-closure.css`, layered over sealed/base CSS without changing the existing visual language;
- desktop, phone portrait and compact landscape real-target UI projects cover every existing first-level Studio page;
- keyboard focus, dialog Escape/focus lifecycle, disclosure/menu state, touch-only action discoverability and reduced-motion behavior are contract-tested;
- target evidence is `hermes-worker-studio.seal-evidence.v2` and includes the actual resolved execution route;
- final verdict is `hermes-worker-studio.seal-verdict.v2`;
- each browser project independently reads the running candidate SHA rather than relying on post-test report stamping;
- final GitHub verification is exact-main and read-only; it cannot merge a PR, create a tag/Release or mutate repository contents;
- production security gates reject bearer-secret leaks, second-runtime residue, staged-security drift and mutation-capable real-target workflow drift;
- the route-scoped exclusive-shell upstream candidate is preserved on `main` under `upstream/hermes-exclusive-shell/`; GitHub Actions run `33796062929` proved the candidate against Hermes `63279301bcbdc185c1b07b98a9312eb0c862f26d` with backend, typecheck, focused DOM/cache tests, lint, full Web tests and production build all green.

Repository CI can prove these code and integration contracts, but **CI success alone never changes this status to SEALED**.

## Historical target evidence — 2026-09-01

A real Hermes target was previously exercised on host `xwz-MS-7D90` against Hermes `0.20.6` at exact upstream commit:

`9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea`

The functional Studio source at that historical capture was:

`a63cf83154ce2e627b76d6d7504946e1fc38f685`

That capture established useful environmental facts, including:

- staged/installed Plugin Doctor success with exactly 3 Studio tools + 1 hook;
- no Studio sidecar / no `:8788` runtime;
- official Sessions, history/search/archive, model locks, Runs controls, approvals, Skills/Plugins/MCP and unattended configuration paths worked on the target;
- OFFICIAL/AUTO/WORKER/MAIN delegation semantics were exercised against real Hermes children;
- browser HTML did not expose the API Server bearer credential;
- New API custom endpoint discovery returned **13 models** from a `/v1` API root;
- ordinary dialogue models were verified through Chat Completions;
- three `gpt-5.6-*` models failed Hermes Chat Completions but direct credentialed New API `/v1/responses` calls returned HTTP 200 and terminal `response.completed`;
- this proved the pinned Hermes limitation: generic custom-provider transport is provider-global and cannot safely be switched to Responses for the whole mixed provider.

Those observations motivated the current per-model compatibility bridge. They are **historical evidence only**. Their old evidence schema/candidate cannot satisfy the current v2 exact-main verifier.

## Current mixed-protocol behavior

The Product 3 compatibility bridge does not infer protocol from `gpt-*`, another model name, or a pasted `/responses` URL.

For one source Provider/Model:

1. Hermes model/provider protocol metadata is authoritative when present;
2. a previously verified route is reused;
3. otherwise first real use invokes the official Hermes Chat/Responses probe path;
4. exactly one successful transport becomes a narrow managed alias written through `/api/config`;
5. both-success => ambiguous / explicit operator choice;
6. both-failed => fail closed with real results;
7. the source Provider/Model remains what the UI displays.

The Models **官方探测** action remains available for diagnostics and active retry; it is not required before normal first use. Probe work is never triggered merely by rendering the model catalog.

## Exact-main release lifecycle

A PR head is never the final sealed identity:

```text
PR CI green
  -> merge code/evidence into main
  -> delete temporary branch
  -> main push CI green
  -> ARCHIVE CANDIDATE
  -> seal exact current main on real target
  -> read-only GitHub exact-main verification
```

The manual `Seal Real Hermes Target` workflow verifies `origin/main == candidate_sha` before running, has only `actions: read` / `contents: read`, and performs no PR merge or branch update after evidence capture.

## What remains before SEALED

After local engineering closure, `SEALED` still requires **fresh evidence for the exact current `main` SHA**, not reuse of the 2026-09-01 capture:

- all intended code and retained contribution evidence already merged to `main`;
- exact-main push CI green;
- deterministic candidate install and loaded SHA read-back;
- target evidence v2 with `installed_candidate_verified=true`;
- current real Hermes target health + Plugin Doctor;
- real Run with canonical todo and a final execution route matching the requested Provider/Model;
- automatic Responses route evidence where a selected dialogue model requires Responses;
- Session cleanup with post-delete 404;
- Playwright desktop + phone portrait + compact landscape, with each product-shell test explicitly passed and candidate identity read in-browser;
- desktop native `/sessions` return-path pass;
- seal-verdict v2 `eligible=true`;
- read-only finalizer confirms current main has not moved and canonical exact-main push CI is green;
- required upstream route-scoped exclusive-shell contract (`NousResearch/hermes-agent#100149`, or an equivalent documented replacement in the pinned Hermes revision) is merged into official Hermes and passes the upstream gate after Worker Studio repins to that official revision.

The canonical command is:

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

Only when all of those checks close on the same exact current `main` SHA may this project be called `SEALED`. No Git tag or GitHub Release is required.
