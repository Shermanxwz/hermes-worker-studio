# Final Seal Checklist — Product 3

`SEAL_ACCEPTANCE.md` is canonical. This checklist is diagnostic only. It must describe the **current exact candidate**, never a historical PR number or an older target capture.

## 1. Exact candidate + official upstream

- [ ] tracked working tree is clean;
- [ ] current SHA is the intended seal candidate;
- [ ] CI for that exact SHA is green;
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
- [ ] candidate SHA stamping is the only candidate-specific mutation.

## 3. One-command real-target closure

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

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

- [ ] running Product 3 reports the exact candidate SHA;
- [ ] product chat Gateway contract reports `tui_gateway_jsonrpc_websocket` + `prompt.submit`;
- [ ] official Runs probe/CI plane remains available;
- [ ] Worker plane is `PluginContext.subagent_lifecycle`;
- [ ] model catalog is `/api/model/options`;
- [ ] Session create -> rename -> archive -> unarchive -> delete completes;
- [ ] real model Run completes and marker verifies;
- [ ] canonical todo has >=3 monotonic persisted revisions, an in-progress phase and all-final-completed state;
- [ ] Studio projection contains canonical todo evidence;
- [ ] a mixed custom endpoint never selects Chat/Responses from a model name or pasted URL;
- [ ] unresolved per-model transport resolves through a real first-use/explicit Hermes probe, with ambiguous/both-failed outcomes remaining fail-closed.

## 6. ui-report.json — product takeover and viewport closure

On `/`:

- [ ] only Worker Studio product navigation is visible normally;
- [ ] Studio contains no copied Hermes navigation list; Advanced links directly to native `/sessions`;
- [ ] native Hermes routes remain under `高级 · Hermes Dashboard`, not duplicated in the Studio rail;
- [ ] composer is usable, arbitrary-file picker is installed, and controls have explicit accessible names;
- [ ] no first-level Studio page has horizontal overflow;
- [ ] the Studio product root stays inside the viewport on desktop, phone portrait and compact landscape;
- [ ] **对话 / Worker / 模型 / MOA / 完全访问 / 完整历史** all render successfully in every product viewport project;
- [ ] touch-only projects do not require hover to discover session actions;
- [ ] Gateway marker reports arbitrary attachments, durable resume and no-wait input responders;
- [ ] `desktop-chromium`, `mobile-chromium`, and `mobile-landscape-chromium` pass.

On native `/sessions` (desktop upstream shell contract):

- [ ] normal Hermes shell/navigation returns;
- [ ] at least one `← Worker Studio` official slot is visible and works back to `/`.

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
- [ ] the project mark is served through Hermes' official plugin static-asset route;
- [ ] release transforms have no network/process/runtime ownership.

## 10. Final decision

```bash
python scripts/verify_seal_evidence.py
```

`.seal/SEALED.json` must have `eligible=true`, name the **exact current Worker Studio candidate**, and record the exact verified Hermes upstream commit. Only then may that exact candidate be called `SEALED` or finalized as a sealed release.
