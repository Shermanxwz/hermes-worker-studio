# Hermes Worker Studio 3 — Seal Acceptance

`SEALED` is a release state, not a design claim. Product 3 may be merged only when **three independent evidence planes** close on the exact candidate and exact official Hermes pin:

1. pinned Hermes public-contract evidence;
2. real Hermes target/runtime evidence;
3. real desktop/mobile browser evidence.

## 1. Repository gate

The exact pull-request head must be green for all CI jobs:

- Studio static + unit + Product 3 mounted UI runtime;
- Gateway-native durable reconnect, no-wait input and arbitrary-file attachment tests;
- Hermes pinned public-contract verification;
- **official route-scoped exclusive Dashboard shell verification**;
- Hermes upstream subagent lifecycle / Runs / approvals / attachment regression tests;
- Hermes Plugin Doctor;
- production security / secret / second-runtime rejection;
- official Hermes Web branding provenance;
- final seal verifier/unit contracts.

Hermes remains the only execution, session, model, approval, input-request, Skills/MCP and Worker source of truth.

### Current hard upstream blocker

Worker Studio's final UX is:

```text
Hermes Web /
  -> Worker Studio only
       Chat / Worker / Models / Full Access / History
       Advanced -> native Hermes Dashboard routes

Native Hermes route
  -> normal Hermes Dashboard shell
       -> official return slot -> Worker Studio
```

This requires a route-scoped **exclusive plugin shell** public contract. `tab.override` alone replaces page content but does not officially suppress Hermes' built-in navigation shell. DOM/CSS hiding, patched Hermes bundles and forks are forbidden.

The contract is tracked upstream at `NousResearch/hermes-agent#100149` and specified in `docs/HERMES_DASHBOARD_EXCLUSIVE_SHELL.md`.

`tests/upstream-lock.json` marks `dashboard_route_scoped_exclusive_shell` as `required_for_seal`. `scripts/verify_required_upstream_contracts.py` must prove the pinned official Hermes revision contains a typed API, runtime enforcement, public documentation and upstream behavior tests. Until that passes, Product 3 is **ARCHIVE CANDIDATE**, never `SEALED`.

## 2. One-command real-target closure

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
4. atomic Product 3 install with exact candidate stamp;
5. real Hermes execution/session/todo acceptance -> `.seal/target.json`;
6. running Dashboard candidate readback;
7. desktop Chromium + Pixel 7 real-browser acceptance -> `.seal/ui-report.json` and screenshots;
8. independent three-plane verification;
9. `.seal/SEALED.json` only when all three evidence planes pass.

There is intentionally **no** `--skip-upstream-contract` escape hatch.

## 3. Product-home takeover invariant

The supported installer transforms the release bundle so normal Worker Studio navigation contains only Worker Studio product surfaces:

- 对话 / Chat
- Worker
- 模型 / Models
- 完全访问 / Full Access
- 完整历史 / History

Every native Hermes destination is behind **`高级 · Hermes Dashboard`**:

- Sessions
- Cron / Automation
- Skills
- Plugins
- MCP
- Profiles
- Analytics
- Logs
- Config
- official Hermes docs

The real-browser seal does not merely check that the outer Hermes navigation is visually hidden. On `/`, it counts native route links and requires the only native links to be those inside Worker Studio's Advanced menu. A second `/sessions`, `/skills`, `/plugins`, `/mcp` or `/config` navigation link anywhere else in the DOM fails the seal. This prevents CSS/DOM monkey-hiding from masquerading as an official shell takeover.

On `/sessions` and other native routes, the normal Hermes shell must return and at least one official `← Worker Studio` slot must work back to `/`.

## 4. Product runtime invariants

Product chat uses the official Hermes TUI Gateway JSON-RPC WebSocket through `SDK.buildWsUrl('/api/ws')`.

Required invariants:

- durable stored Hermes Session is authoritative; WebSocket is transport only;
- `session.resume(close_on_disconnect=false)`;
- WebSocket loss -> `reconnecting`, not terminal interruption;
- fresh authenticated WebSocket URL on reconnect;
- resume by durable stored Session id, runtime-id rebind and state reconciliation;
- image -> `image.attach_bytes`;
- PDF -> `pdf.attach`;
- other file -> `file.attach` and returned `@file:` ref returned to the prompt;
- picker, clipboard and drag/drop share the arbitrary-file pipeline;
- Full Access modifies only Hermes-supported approvals/delegation settings;
- Hermes Hardline Blocklist remains authoritative;
- approvals auto-resolve in Full Access;
- Clarify uses official empty-answer Skip;
- MCP setup is declined rather than waiting;
- unavailable sudo/secret input uses Hermes' official empty cancellation semantics;
- terminal read has an immediate no-pane/EOF response;
- missing password, MFA, CAPTCHA or third-party authorization may make a task fail, but Worker Studio must not park indefinitely awaiting its own human interaction UI.

Thus **unattended means never waiting for a Studio/Hermes approval interaction**, not pretending unavailable credentials can be invented or Hardline can be bypassed.

## 5. Real execution + official-plan evidence

The target acceptance proves health, Hermes execution/Worker ownership, model catalog ownership and temporary Session create -> rename -> archive -> unarchive -> delete.

A real Hermes `/v1/runs` turn must show:

- completed Run and verified marker;
- at least three persisted monotonic canonical todo revisions;
- an `in_progress` phase;
- at least three final todo items, all `completed`;
- Studio-visible `todo.updated` or canonical `todo.snapshot` projection;
- successful cleanup.

Worker Studio never invents a planner. Where the pinned Runs API does not expose canonical todo snapshots directly, only persisted Hermes todo-tool state from the public Session API may be projected.

## 6. Real-browser evidence

The pinned Playwright matrix targets the real installed Dashboard in:

- desktop Chromium 1440×900;
- Pixel 7 emulation.

It proves:

- `/` is the exclusive Worker Studio product home;
- no outer native Dashboard navigation leaks into `/`;
- all native destinations live behind Advanced inside Studio;
- native routes restore the Hermes shell;
- return-to-Studio works;
- composer is in viewport and no horizontal overflow exists;
- installed picker is arbitrary-file, not image-only;
- Gateway capability marker reports attachment, reconnect and unattended contracts;
- mobile drawer/touch shell works;
- screenshots and machine-readable report are produced.

## 7. Branding evidence

The supported installer ships no independent favicon. Installed Product 3 reuses official Hermes Web `/favicon.ico`; CI proves the pinned upstream asset exists.

## 8. Independent final verifier

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

`eligible=true` is possible only when the upstream evidence names the exact Hermes pin and verifies `dashboard_route_scoped_exclusive_shell`, while target/browser evidence names the exact Worker Studio candidate.

## 9. Release rule

Do **not** mark PR #4 Ready, merge, tag, or call Product 3 sealed until:

1. exact-head CI is fully green, including the Product shell upstream blocker;
2. `seal_close.py` exits 0 on the real target;
3. `.seal/SEALED.json` says `eligible: true` for that exact candidate and records the exact verified Hermes upstream commit.

Until Hermes upstream lands the exclusive-shell public contract and Worker Studio updates its pin to that official revision, the correct state is **ARCHIVE CANDIDATE / DRAFT**.
