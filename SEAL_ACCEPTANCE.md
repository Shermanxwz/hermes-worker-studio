# Hermes Worker Studio 3 — Seal Acceptance

`SEALED` is a release state, not a design claim. Product 3 may be merged only after repository CI and the real configured Hermes target both prove the **same git candidate**.

## Repository gate

The exact pull-request head must be green for all CI jobs:

- Studio static + unit + Product 3 mounted UI runtime
- Hermes pinned public-contract verification
- Hermes upstream subagent lifecycle / Runs / approvals regression tests
- Hermes Plugin Doctor
- Production security / secret / second-runtime rejection
- Official Hermes Web branding asset provenance
- Final seal verifier/unit contracts

Hermes must remain the only execution, session, model, approval, Skills/MCP and Worker source of truth.

## One-command real-target closure

Run this from the exact candidate checkout **on the Hermes target machine**:

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

Equivalent npm entry point:

```bash
npm run seal:close -- --url http://127.0.0.1:19119
```

If the Dashboard/API is protected, export `API_SERVER_KEY` first. `--provider` and `--model` can pin a configured route. The command intentionally refuses a dirty tracked working tree.

`seal_close.py` performs the whole local evidence loop:

1. resolves the exact current 40-character git commit;
2. atomically installs Product 3 with `HWS_CANDIDATE_SHA=<that commit>`;
3. the installer stamps the staged `plugin_api_v3.py` and rewrites the release favicon to official Hermes `/favicon.ico`;
4. runs the real Hermes execution/session/official-plan acceptance and writes `.seal/target.json`;
5. reads `/product-capabilities` back from the **running Dashboard** and refuses to continue unless `candidate_sha` equals the current checkout (restart/refresh is therefore observable rather than assumed);
6. installs pinned Node/Playwright prerequisites when needed;
7. runs the real desktop Chromium + Pixel 7 browser matrix and writes `.seal/ui-report.json` plus screenshots;
8. stamps browser evidence with the same candidate commit;
9. runs the independent `verify_seal_evidence.py` verifier;
10. writes `.seal/SEALED.json` only when both evidence planes satisfy every release invariant.

Useful escape hatches exist for already-prepared machines: `--skip-install`, `--skip-node-install`, and `--skip-browser-install`. `--skip-install` does **not** weaken candidate identity: the loaded Dashboard must still report the exact current candidate or closure fails.

## Real execution + official-plan evidence

The target acceptance checks health, execution/Worker ownership, Product 3 capabilities, model catalog and a temporary session create → rename → archive → unarchive → delete lifecycle.

Its real model gate starts a Hermes `/v1/runs` turn and requires Hermes' own `todo` tool to evolve a harmless three-step task. Seal evidence must show:

- at least three persisted, monotonic, unique canonical todo revisions;
- a real `in_progress` phase;
- at least three final todo items and all of them `completed`;
- a Studio-visible `todo.updated` or `todo.snapshot` event;
- a verified final model marker;
- successful session cleanup;
- Product 3 `candidate_sha` matching the installed checkout.

Worker Studio never invents a planner. If public `/v1/runs` exposes canonical `todo.updated`, it is used directly. On the pinned Hermes release where Runs does not expose that snapshot, Studio reads only persisted results of Hermes' own `todo` tool through the documented Session API and projects them as `todo.snapshot` with `source=hermes_session_api`. The pre-run revision is baselined and only later monotonic revisions project.

Upstream direct Runs-event enhancement remains tracked at NousResearch/hermes-agent#99686; it is not a seal blocker because the fallback is also canonical Hermes-owned public state rather than inferred Studio state.

## Real-browser evidence

The pinned Playwright matrix targets the real running Dashboard in:

- desktop Chromium at 1440×900;
- Pixel 7 mobile emulation.

It verifies Product 3 owns `/`, the composer remains inside the viewport, no horizontal overflow appears, the mobile drawer/touch shell works, and native `/sessions` retains the official `← Worker Studio` return path. Success screenshots are stored under `.seal/playwright-artifacts` and the machine-readable report is `.seal/ui-report.json`.

Mounted JSDOM runtime tests separately cover behavior-heavy paths that should not mutate a real target during layout acceptance: lazy session creation, session CRUD, image clipboard/multimodal transport, plan rendering, Stop/Steer/approval wiring, Full Access enable/restore + unattended probe, Custom Endpoint validate/edit/activate/delete, and model probes.

## Branding evidence

The supported installer does not ship an independent Worker Studio favicon. During atomic staging it rewrites the Product 3 favicon assignment to `baseHref('/favicon.ico')`, reusing the exact same-origin favicon served by official Hermes Web.

Pinned-upstream CI proves `NousResearch/hermes-agent@HERMES_PIN` contains non-empty `web/public/favicon.ico`. Installer and product-contract tests prove no custom favicon is copied, and the installed bridge is stamped with the exact candidate SHA.

## Independent final verifier

Evidence can be rechecked at any time without rerunning the tests:

```bash
python scripts/verify_seal_evidence.py
# or
npm run seal:verify
```

The verifier requires `.seal/target.json` and `.seal/ui-report.json` to name the exact current git commit. It checks execution/Worker ownership, session CRUD cleanup, Product 3 capabilities, real Run completion, marker verification, canonical todo revision/final-state invariants, projected todo events, desktop/mobile Playwright projects, expected pass counts and absence of failed/timed-out/interrupted browser results.

It writes `.seal/SEALED.json` with `eligible: true` only when the cross-evidence closure is valid.

## Release rule

Do **not** mark PR #4 ready, merge it, tag a release, or call the repository sealed until both conditions hold for the same candidate:

1. exact PR-head CI is fully green;
2. real-target `seal_close.py` exits 0 and `.seal/SEALED.json` says `eligible: true` for that exact head SHA.

At that point the technical seal is closed. No separate upstream-plan exception, subjective favicon exception, or unrecorded browser gate remains.
