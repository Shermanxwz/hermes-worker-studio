# Hermes Worker Studio 3 — Seal Acceptance

`SEALED` is a release state, not a design claim. Product 3 may be merged only after repository CI and the real configured Hermes target both prove the **same git candidate**.

## Repository gate

The exact pull-request head must be green for all CI jobs:

- Studio static + unit + Product 3 mounted UI runtime;
- Gateway-native durable reconnect, no-wait input and arbitrary-file attachment contract tests;
- Hermes pinned public-contract verification;
- Hermes upstream subagent lifecycle / Runs / approvals / attachment regression tests;
- Hermes Plugin Doctor;
- Production security / secret / second-runtime rejection;
- Official Hermes Web branding asset provenance;
- Final seal verifier/unit contracts.

Hermes must remain the only execution, session, model, approval, input-request, Skills/MCP and Worker source of truth.

The pinned upstream gate must prove the exact Hermes release still exposes the contracts Product 3 consumes: `session.resume`, `close_on_disconnect`, `image.attach_bytes`, `pdf.attach`, `file.attach`, `approval.respond`, `clarify.respond`, the official cancel/skip semantics for interactive requests, Dashboard WebSocket auth helpers, and the `header-left` / `sidebar` plugin slots. If any contract drifts, CI fails closed before release.

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
3. the installer stamps the staged `plugin_api_v3.py`, rewrites the release favicon to official Hermes `/favicon.ico`, and applies the exact-count-checked Product 3 release transform;
4. the installed composer accepts arbitrary files and routes them through the pinned Hermes attachment family (`image.attach_bytes`, `pdf.attach`, `file.attach`);
5. runs the real Hermes execution/session/official-plan acceptance and writes `.seal/target.json`;
6. reads `/product-capabilities` back from the **running Dashboard** and refuses to continue unless `candidate_sha` equals the current checkout (restart/refresh is therefore observable rather than assumed);
7. installs pinned Node/Playwright prerequisites when needed;
8. runs the real desktop Chromium + Pixel 7 browser matrix and writes `.seal/ui-report.json` plus screenshots;
9. stamps browser evidence with the same candidate commit;
10. runs the independent `verify_seal_evidence.py` verifier;
11. writes `.seal/SEALED.json` only when both evidence planes satisfy every release invariant.

Useful escape hatches exist for already-prepared machines: `--skip-install`, `--skip-node-install`, and `--skip-browser-install`. `--skip-install` does **not** weaken candidate identity: the loaded Dashboard must still report the exact current candidate or closure fails.

## Product runtime invariants

The browser product uses the official Hermes TUI Gateway JSON-RPC WebSocket through `SDK.buildWsUrl('/api/ws')`.

The seal requires all of these invariants:

- a durable stored Hermes Session is authoritative; a browser WebSocket is only a transport;
- `session.resume` is issued with `close_on_disconnect=false`;
- WebSocket loss produces a transient `reconnecting` state, not a terminal Run result;
- reconnect obtains a fresh Dashboard-authenticated WebSocket URL, resumes by durable stored Session id, rebinds the runtime id, and reconciles running/inflight/todo/pending-input state;
- an image is staged with `image.attach_bytes`;
- a PDF is staged with `pdf.attach`;
- every other attachment is staged with `file.attach`, and Hermes' returned workspace-relative `@file:` reference is supplied back to the prompt;
- picker, clipboard paste and drag/drop use the same arbitrary-file product path;
- Full Access sets only Hermes-supported approval/delegation configuration and never weakens the Hardline Blocklist;
- while Full Access is active, Hermes interactive requests use official response contracts to avoid indefinite human waits: approvals auto-resolve, Clarify is skipped, MCP setup is declined, and unavailable sudo/secret/terminal input is cancelled with Hermes' official empty-response semantics;
- missing passwords, MFA, CAPTCHA or third-party authorization may still make a task fail, but Worker Studio must not park forever waiting for its own approval/input UI.

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

It verifies the **installed release bundle**, not merely the source draft. Required browser evidence includes:

- Product 3 owns `/` and the composer remains inside the viewport;
- no horizontal overflow appears;
- the file picker is not image-only and is presented as `添加文件`;
- the Gateway capability surface reports `image.attach_bytes`, `pdf.attach`, `file.attach` and durable `session.resume(close_on_disconnect=false)`;
- the Full Access capability surface exposes the official no-wait input responders;
- Hermes Sessions, Skills, Plugins, MCP and Automation are visible first-class native destinations while lower-frequency operations remain under Advanced;
- the Full Access page explains Clarify Skip/Decline behavior and preserves the Hardline boundary;
- the mobile drawer/touch shell works;
- native `/sessions` retains at least one official `← Worker Studio` return path;
- success screenshots are stored under `.seal/playwright-artifacts` and the machine-readable report is `.seal/ui-report.json`.

Mounted JSDOM/Node runtime tests separately exercise behavior-heavy paths: lazy session creation, session CRUD, mixed image/PDF/file staging, returned `@file:` propagation, clipboard/drag-drop plumbing, durable WebSocket reconnect and runtime rebinding, plan rendering, Stop/Steer/approval wiring, Full Access auto-input handling, Custom Endpoint validate/edit/activate/delete, and model probes.

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

At that point the technical seal is closed. No separate attachment, reconnect, input-wait, upstream-plan, subjective favicon, or unrecorded browser exception remains.
