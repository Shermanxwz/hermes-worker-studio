# Final Seal Checklist — Product 3

`SEAL_ACCEPTANCE.md` is canonical. This checklist is diagnostic only. It must describe the **exact current `main` commit**, never a historical PR head or older target capture.

## 1. Canonical candidate + official upstream

- [ ] all intended development/closure changes are already merged into `main`;
- [ ] current `main` HEAD is the intended seal candidate;
- [ ] push CI from `.github/workflows/ci.yml` for that exact `main` SHA is green;
- [ ] tracked working tree on the target checkout is clean;
- [ ] `tests/upstream-lock.json` contains only Hermes as runtime upstream;
- [ ] pinned-upstream verification passes;
- [ ] `dashboard_route_scoped_exclusive_shell.required_for_seal=true` remains pinned;
- [ ] `scripts/verify_required_upstream_contracts.py` passes against that exact official Hermes commit;
- [ ] upstream issue `NousResearch/hermes-agent#100149` is resolved by the pinned official contract, or superseded by an equivalent documented contract reviewed with the pin bump.

If the exclusive-shell verifier is red, status is **ARCHIVE CANDIDATE**, never `SEALED`.

## 2. Supported artifact before target execution

Repository gates must prove the same build path that the target installer uses:

- [ ] `dashboard/manifest.json` loads `dist/gateway-native.js` + `dist/product-closure.css`;
- [ ] CSS layering is `product.css -> product-sealed.css -> product-closure.css`;
- [ ] `stage_product_bundle.py` is exact-count/fail-closed and adds only the supported attachment + interaction/accessibility closure;
- [ ] `stage_mixed_protocol.py` is exact-count/fail-closed and adds only the pinned-Hermes per-model protocol bridge;
- [ ] staged `index-v3.js` passes `node --check`;
- [ ] staged `plugin_api_v3.py` passes Python compile;
- [ ] installer tests verify the exact installed file set and staged behavior;
- [ ] candidate SHA stamping is the only candidate-specific runtime mutation.

## 3. One-command real-target closure

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

When selecting a specific real-Run route, provide `--provider` and `--model` together. The command must never silently substitute a different route.

The command must produce:

- `.seal/upstream.json`
- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json`

There is no upstream-contract skip flag.

## 4. upstream.json

- [ ] schema is `hermes-worker-studio.upstream-gate.v1`;
- [ ] `ok=true`;
- [ ] repository is `NousResearch/hermes-agent`;
- [ ] commit equals `tests/upstream-lock.json`;
- [ ] `dashboard_route_scoped_exclusive_shell.verified=true`.

## 5. target.json

- [ ] schema is `hermes-worker-studio.seal-evidence.v2`;
- [ ] `candidate_sha` equals exact current `main` HEAD;
- [ ] `installed_candidate_verified=true`;
- [ ] running Product 3 reports that exact candidate SHA through `product-capabilities`;
- [ ] official Runs probe/acceptance plane is available;
- [ ] Worker plane is `PluginContext.subagent_lifecycle`;
- [ ] model catalog is `/api/model/options`;
- [ ] installed product reports per-model protocol routing, first-use real-Run resolution and fail-closed unresolved behavior;
- [ ] Session create -> rename -> archive -> unarchive -> delete completes and post-delete read returns 404;
- [ ] real model Run completes and marker verifies;
- [ ] `real_run.execution_route` names the requested source Provider/Model, a final executable status and nonempty execution Provider;
- [ ] a Responses-resolved model records `codex_responses`/the corresponding managed execution Provider rather than silently falling back to Chat;
- [ ] unresolved/ambiguous routes cannot satisfy target evidence;
- [ ] canonical todo has >=3 monotonic persisted revisions, an in-progress phase and all-final-completed state;
- [ ] Studio projection contains canonical todo evidence.

## 6. ui-report.json — product takeover and viewport closure

On `/`:

- [ ] every browser project reads running `product-capabilities.candidate_sha` and requires exact candidate equality;
- [ ] only Worker Studio product navigation is visible normally;
- [ ] Studio contains no copied Hermes navigation list; Advanced links directly to native `/sessions`;
- [ ] native Hermes routes remain under `高级 · Hermes Dashboard`, not duplicated in the Studio rail;
- [ ] composer is usable, arbitrary-file picker is installed, and controls have explicit accessible names;
- [ ] no first-level Studio page has horizontal overflow;
- [ ] the Studio product root stays inside the viewport on desktop, phone portrait and compact landscape;
- [ ] **对话 / Worker / 模型 / MOA / 完全访问 / 完整历史** all render successfully in every product viewport project;
- [ ] touch-only projects do not require hover to discover session actions;
- [ ] Gateway marker reports arbitrary attachments, durable resume and no-wait input responders;
- [ ] `desktop-chromium`, `mobile-chromium`, and `mobile-landscape-chromium` each have a `passed` product-shell result; configured/skipped is not enough.

On native `/sessions` (desktop upstream shell contract):

- [ ] normal Hermes shell/navigation returns;
- [ ] at least one `← Worker Studio` official slot is visible and works back to `/`;
- [ ] desktop native-return result is explicitly `passed`.

## 7. Runtime closure

- [ ] WebSocket is transport only; durable Hermes Session is authoritative;
- [ ] `session.resume(close_on_disconnect=false)`;
- [ ] disconnect -> reconnecting -> fresh authenticated socket -> resume/rebind;
- [ ] image -> `image.attach_bytes`;
- [ ] PDF -> `pdf.attach`;
- [ ] generic file -> `file.attach` + returned `@file:` ref;
- [ ] picker / paste / drag-drop share one attachment path;
- [ ] Main/Worker/Verifier/MOA resolve the same source Provider/Model to the same verified execution route;
- [ ] concurrent first use of one unresolved model does not duplicate protocol probes;
- [ ] Full Access sets/restores only Hermes official approval/delegation config;
- [ ] approval auto-resolves, Clarify skips, MCP setup declines, unavailable sudo/secret/terminal input cancels immediately;
- [ ] missing credentials/MFA may fail the task but never leave Studio waiting indefinitely;
- [ ] Hermes Hardline Blocklist remains authoritative.

## 8. Product/accessibility closure

- [ ] keyboard focus is visible on interactive Studio controls;
- [ ] Modal supports Escape, traps focus while open and returns focus when closed;
- [ ] menus/disclosures expose `aria-expanded`/menu semantics;
- [ ] mobile navigation exposes an accessible name and expanded state;
- [ ] error feedback is an assertive live alert;
- [ ] reduced-motion preference disables remaining Studio animations/transitions;
- [ ] modal and product surfaces respect safe-area and short-view-height bounds.

## 9. Architecture/security

- [ ] no second runtime/model/planner/tokenizer;
- [ ] no private `AIAgent`/delegation implementation import;
- [ ] no direct Hermes database access;
- [ ] no browser bearer secret;
- [ ] no Hermes core patch, copied native navigation, or fork;
- [ ] local host-shell compatibility selectors remain narrow/reversible; the official exclusive-shell contract is still required for final sealing;
- [ ] project mark is served through Hermes' official plugin static-asset route;
- [ ] release transforms have no network/process/runtime ownership;
- [ ] real-target workflow is manual-only with `actions: read` + `contents: read` and no PR/repository write permission.

## 10. Final decision

```bash
python scripts/verify_seal_evidence.py
python scripts/github_finalize_seal.py --repo Shermanxwz/hermes-worker-studio --candidate <exact-main-sha>
```

`.seal/SEALED.json` must use `hermes-worker-studio.seal-verdict.v2`, have `eligible=true`, name the exact current `main` SHA, and record the exact verified Hermes upstream commit.

The GitHub finalizer is read-only and must confirm:

- repository default branch is `main`;
- current `main` HEAD still equals that exact SHA;
- the latest exact-main **push** CI from `.github/workflows/ci.yml` is completed/success.

No code merge or branch mutation is permitted after target/browser evidence capture. Only then may that exact `main` commit be called `SEALED`.
