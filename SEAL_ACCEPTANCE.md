# Hermes Worker Studio 3 — Seal Acceptance

`SEALED` is a release state, not a design claim. The canonical repository state lives on **`main`**. Product 3 may be called sealed only when **three independent evidence planes** close on the exact current candidate and exact official Hermes pin:

1. pinned Hermes public-contract evidence;
2. real Hermes target/runtime evidence;
3. real desktop/mobile browser evidence.

Temporary development branches may exist while work is in progress, but a repository entering archive/seal state must converge back to `main` only.

## 1. Repository health gate

The exact candidate must be green for ordinary CI:

- Studio static + unit + Product 3 mounted UI runtime;
- exact staged release artifact syntax/closure gate;
- Gateway-native durable reconnect, no-wait input and arbitrary-file attachment tests;
- Hermes pinned archive-baseline public-contract verification;
- Hermes upstream subagent lifecycle / Runs / approvals / Gateway attachment/todo/context regression tests;
- Hermes Plugin Doctor;
- production security / secret / second-runtime rejection;
- official Hermes Web branding provenance;
- final seal verifier/unit contracts.

Ordinary CI answers **“is this exact repository candidate healthy?”**. It must not stay permanently red merely because a known future seal-required upstream contract has not landed yet.

Hermes remains the only execution, session, model, approval, input-request, Skills/MCP and Worker source of truth.

### Current hard upstream seal blocker

Worker Studio's final UX is:

```text
Hermes Web /
  -> Worker Studio only
       Chat / Worker / Models / MOA / Full Access / History
       Advanced -> native Hermes Dashboard routes

Native Hermes route
  -> normal Hermes Dashboard shell
       -> official return slot -> Worker Studio
```

This ideally requires a route-scoped **exclusive plugin shell** public contract. `tab.override` alone replaces page content but does not officially suppress Hermes' built-in navigation shell. The local preview therefore uses a narrow, reversible host-shell compatibility layer only while the Studio root is mounted; it does not copy navigation, patch Hermes bundles or fork Hermes. This compatibility layer is not sufficient for `SEALED` until the official contract lands.

The contract is tracked upstream at `NousResearch/hermes-agent#100149` and specified in `docs/HERMES_DASHBOARD_EXCLUSIVE_SHELL.md`.

`tests/upstream-lock.json` marks `dashboard_route_scoped_exclusive_shell` as `required_for_seal`. `scripts/verify_required_upstream_contracts.py` must prove the pinned official Hermes revision contains a typed API, runtime enforcement, public documentation and upstream behavior tests. Until that passes, a healthy exact candidate is **ARCHIVE CANDIDATE**, never `SEALED`.

## 2. Supported artifact invariant

The supported installer creates a temporary candidate and ships only documented Product 3 files. Before atomic replacement it:

1. stamps the exact candidate SHA into the staged Product 3 bridge;
2. applies `stage_product_bundle.py` for the existing attachment + interaction/accessibility closure;
3. applies `stage_mixed_protocol.py` for pinned-Hermes per-model Chat/Responses compatibility;
4. runs Hermes Plugin Doctor on the staged tree;
5. atomically swaps the install and runs final Plugin Doctor.

Both transforms are exact-count/fail-closed build steps. They may not own network/process execution or become a second runtime. CI independently reproduces these transforms, syntax-checks the resulting JS/Python and asserts the final closure tokens. Installer tests assert the exact installed file set.

The final stylesheet chain is:

```text
product.css -> product-sealed.css -> product-closure.css
```

The closure layer changes no product capability or visual language; it locks focus, touch, short-viewport, safe-area and reduced-motion behavior.

## 3. One-command real-target closure

Run from the exact candidate checkout on the Hermes target machine:

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

If an exact Hermes source checkout already exists it may be reused:

```bash
python scripts/seal_close.py --hermes-root /path/to/hermes-agent --url http://127.0.0.1:19119
```

If omitted, `seal_close.py` prepares the exact pinned Hermes revision beneath `.seal/upstream/hermes`.

The command intentionally refuses a dirty tracked working tree and performs, in order:

1. exact candidate SHA resolution;
2. `scripts/seal_upstream_gate.py` against the exact Hermes pin;
3. `.seal/upstream.json` creation only after baseline and seal-blocking public contracts pass;
4. deterministic atomic Product 3 install with exact candidate stamp;
5. real Hermes execution/session/todo acceptance -> `.seal/target.json`;
6. running Dashboard candidate readback;
7. desktop + phone portrait + compact landscape real-browser acceptance -> `.seal/ui-report.json` and screenshots;
8. independent three-plane verification;
9. `.seal/SEALED.json` only when all evidence planes pass.

There is intentionally **no** `--skip-upstream-contract` escape hatch.

## 4. Product-home takeover invariant

Normal Worker Studio navigation contains only existing Worker Studio product surfaces:

- 对话 / Chat
- Worker
- 模型 / Models
- MOA
- 完全访问 / Full Access
- 完整历史 / History

Every native Hermes destination is behind **`高级 · Hermes Dashboard`**. Studio must not maintain a copied native Hermes route list.

The real-browser seal checks that the outer Hermes navigation is absent from the visible Studio root. The direct hand-off enters `/sessions`; the native Hermes shell then owns every native destination and future addition. A duplicated `/sessions`, `/skills`, `/plugins`, `/mcp` or `/config` Studio navigation path fails the seal.

On desktop native `/sessions`, the normal Hermes shell must return and at least one official `← Worker Studio` slot must work back to `/`.

## 5. Product runtime invariants

Product chat uses the official Hermes TUI Gateway JSON-RPC WebSocket through `SDK.buildWsUrl('/api/ws')`.

Required invariants:

- durable stored Hermes Session is authoritative; WebSocket is transport only;
- `session.resume(close_on_disconnect=false)`;
- WebSocket loss -> `reconnecting`, not terminal interruption;
- fresh authenticated WebSocket URL on reconnect;
- resume by durable stored Session id, runtime-id rebind and event/state reconciliation;
- image -> `image.attach_bytes`;
- PDF -> `pdf.attach`;
- other file -> `file.attach` and returned `@file:` ref;
- picker, clipboard and drag/drop share the attachment pipeline;
- Full Access modifies only Hermes-supported approvals/delegation settings;
- Hermes Hardline Blocklist remains authoritative;
- approvals auto-resolve in Full Access;
- Clarify uses official empty-answer Skip;
- MCP setup is declined rather than waiting;
- unavailable sudo/secret input uses Hermes' official empty cancellation semantics;
- terminal read has an immediate no-pane/EOF response;
- missing password, MFA, CAPTCHA or third-party authorization may make a task fail, but Worker Studio must not park indefinitely awaiting its own human interaction UI.

Thus **unattended means never waiting for a Studio/Hermes approval interaction**, not pretending unavailable credentials can be invented or Hardline can be bypassed.

## 6. Model / mixed-protocol invariants

Canonical inventory is Hermes `/api/model/options`; Studio never creates a second model registry.

For custom endpoints containing both Chat and Responses-only dialogue models:

- a pasted terminal endpoint suffix is normalized to the API root but is not protocol evidence;
- explicit Hermes capability metadata is authoritative;
- otherwise first unresolved use performs real Hermes Chat/Responses probe Runs;
- exactly one successful transport may be cached and materialized as a managed Hermes config alias;
- both-success remains ambiguous until explicit operator choice;
- both-failed remains failed;
- no model-name (`gpt-*` or otherwise) or URL heuristic may select the transport;
- concurrent first use of one Provider/Model shares a probe lock;
- the same resolver feeds Product Chat, Worker, Verifier and MOA;
- managed aliases remain hidden implementation details; the UI displays the source Provider/Model.

The Models **官方探测** action is a diagnostic/retry action, not a prerequisite for first use.

Reasoning effort may be emitted only from explicit upstream capability metadata; absent metadata means `Auto`/omitted.

## 7. Real execution + official-plan/context evidence

The target acceptance proves health, Hermes execution/Worker ownership, model catalog ownership and temporary Session create -> rename -> archive -> unarchive -> delete.

A real Hermes official probe/acceptance turn must show:

- completed Run and verified marker;
- at least three persisted monotonic canonical todo revisions;
- an `in_progress` phase;
- at least three final todo items, all `completed`;
- Studio-visible `todo.updated` or canonical `todo.snapshot` projection;
- successful cleanup.

Live product context evidence must come from Hermes Gateway/session context telemetry. Cumulative billing/input token totals must never be presented as current context occupancy.

Worker Studio never invents a planner or tokenizer.

## 8. Real-browser evidence

The pinned Playwright matrix targets the real installed Dashboard in:

- desktop Chromium 1440×900;
- Pixel 7 portrait emulation;
- compact touch landscape 667×375.

For every product viewport, the seal walks each existing first-level page:

- 对话
- Worker
- 模型
- MOA
- 完全访问
- 完整历史

It proves:

- `/` is the exclusive Worker Studio product home;
- no outer native Dashboard navigation leaks into `/`;
- each first-level page renders without horizontal overflow;
- the product root remains inside the actual dynamic viewport;
- chat composer remains in viewport;
- installed picker is arbitrary-file, not image-only;
- mobile drawer exposes accessible expanded state and closes after navigation;
- key controls expose accessible names/state;
- Full Access disclosure remains visible without toggling authority during the UI seal;
- Gateway capability marker reports attachment, reconnect and unattended contracts;
- desktop native `/sessions` restores Hermes shell and provides return-to-Studio;
- screenshots and machine-readable report are produced.

Certificate errors are not ignored by default. `HWS_SEAL_IGNORE_HTTPS_ERRORS=1` is an explicit trusted test-environment override only.

## 9. Interaction/accessibility invariants

Existing controls must remain keyboard/touch usable without adding a parallel UI:

- visible `:focus-visible` state;
- Modal supports Escape, focus trap and focus return;
- menu/disclosure triggers expose state (`aria-expanded`, menu roles where applicable);
- composer/send/file/mobile-menu/Full-Access controls have explicit accessible names;
- errors use an assertive live alert;
- touch-only devices do not depend on hover to discover session actions;
- safe-area/short-height bounds prevent modal/root overflow;
- `prefers-reduced-motion` suppresses Studio-owned motion.

## 10. Independent final verifier

Final verification consumes:

```text
.seal/upstream.json
.seal/target.json
.seal/ui-report.json
```

and writes:

```text
.seal/SEALED.json
```

`eligible=true` is possible only when upstream evidence names the exact Hermes pin and verifies `dashboard_route_scoped_exclusive_shell`, while target/browser evidence names the exact Worker Studio candidate.

## 11. Release rule

Do **not** tag or call Product 3 sealed until:

1. the exact current candidate's ordinary CI is fully green;
2. `seal_close.py` exits 0 on the real target;
3. `.seal/SEALED.json` says `eligible: true` for that exact candidate and records the exact verified Hermes upstream commit;
4. no temporary development branch remains in the repository.

Until the required official exclusive-shell contract is present in the pinned Hermes revision and exact-current real-target evidence closes, the correct state is **ARCHIVE CANDIDATE**.
