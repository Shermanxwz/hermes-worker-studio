# Hermes Worker Studio 3 — Seal Acceptance

`SEALED` is a release state, not a design claim. Product 3 may be merged only after the repository gates **and** a real configured Hermes target pass.

## Automated repository gate

The pull request must be green for all CI jobs:

- Studio static + unit + Product 3 mounted UI runtime
- Hermes pinned public-contract verification
- Hermes upstream subagent lifecycle / Runs / approvals regression tests
- Hermes Plugin Doctor
- Production security / secret / second-runtime rejection
- Official Hermes Web branding asset provenance

The architecture gate must continue to prove that Hermes is the only execution, session, model, approval, Skills/MCP and Worker source of truth.

## Real-target gate

Install the candidate on the target Hermes machine, restart/refresh the official Dashboard, then run:

```bash
python scripts/seal_acceptance.py \
  --url http://127.0.0.1:19119 \
  --run \
  --evidence .seal/target.json
```

If the Dashboard/API is protected, export `API_SERVER_KEY` first. `--provider` and `--model` can pin a specific configured route; otherwise the harness chooses a usable Hermes model from `/api/model/options`.

The default pass checks health, execution/Worker ownership, Product 3 capabilities, model catalog and a temporary session create → rename → archive → unarchive → delete lifecycle. `--run` is the **real model + official plan seal gate**: it starts a real Hermes `/v1/runs` turn, requires Hermes' own `todo` tool to produce at least three persisted monotonic revisions for a three-step task, requires a visible `todo.updated` or `todo.snapshot` in the Studio Run projection, requires the final canonical list to be fully completed, and verifies the final model marker from Run output or the persisted assistant transcript.

This means the plan gate is no longer a separate manual assertion: `.seal/target.json` contains the canonical revision list, final todo statuses and the exact projected todo event evidence.

## Real-browser gate

The repository includes a pinned Playwright matrix using the same Playwright version as the pinned Hermes desktop app. On the target machine run:

```bash
npm install --ignore-scripts --no-fund
npx playwright install chromium
HWS_DASHBOARD_URL=http://127.0.0.1:19119 npm run seal:ui
```

If the Dashboard is protected, export `API_SERVER_KEY` before running it. The matrix produces `.seal/ui-report.json` plus success screenshots under `.seal/playwright-artifacts` and exercises both desktop Chromium and Pixel 7 mobile emulation against the **real running Dashboard**. It verifies Product 3 owns `/`, the composer remains inside the viewport, the page has no horizontal overflow, the mobile drawer/touch shell is functional, and native `/sessions` retains the official `← Worker Studio` return path.

The mounted JSDOM product tests separately exercise the behavior-heavy paths that should not mutate a real target during layout acceptance: lazy session creation, session CRUD, image clipboard transport, structured multimodal Runs, plan rendering, run completion, Full Access enable/restore semantics, unattended probe wiring, Custom Endpoint validate/edit/activate/delete, and model probes.

A physical-phone spot check of virtual-keyboard and clipboard/drag behavior is still useful when available, but it is not an unrecorded release gate: the mandatory browser evidence is the reproducible Playwright matrix plus the mounted behavior tests and responsive CSS contract.

## Product UI contract

The combined mounted-runtime + real-browser gates cover these product paths:

- `/` opens Worker Studio; `/sessions` remains the native Hermes Dashboard page.
- `高级 → 原生 Dashboard` works and the official `header-left` slot exposes `← Worker Studio` on native pages.
- New conversation does not create a server session until first send and repeated new conversations never collide on title.
- Session rename, archive, unarchive and delete round-trip through Hermes APIs.
- Composer supports Enter send, Shift+Enter newline, growing textarea, Stop, run-time steer, image picker, drag/drop, clipboard paste, preview/remove and unsupported-file feedback.
- Auto-scroll follows live output, pauses when the user scrolls upward, shows jump-to-bottom and preserves the user's preference.
- Official Hermes approvals render actionable choices and resolve against the active Run.
- Worker modes and Worker/Verifier routing persist through Hermes config and remain Hermes-native.
- Full Access reports controlled/on state, verifies the real unattended marker when enabled, restores the previous approval configuration when disabled and never bypasses Hermes hardline blocks.
- Custom endpoints validate, add/edit, activate and delete; model discovery remains Hermes-owned.
- Mobile drawer navigation, `100dvh`, safe-area composer, touch targets, long output, plan expansion and modal actions remain usable without horizontal overflow.

## Official plan gate

Worker Studio must never invent a planner or label inferred tool activity as an "official plan".

Hermes owns the canonical revisioned todo store. Hermes TUI/Desktop already emits `todo.updated`; the pinned public `/v1/runs` event bridge currently does not. Product 3 therefore uses a two-level **official-only** source strategy:

1. if `/v1/runs` exposes a canonical `todo.updated`, use it directly;
2. otherwise poll the documented Session API and project only persisted results of Hermes' own `todo` tool as `todo.snapshot` with `source=hermes_session_api`.

The fallback is not a Studio planner and does not infer steps from tool calls: it parses the same `{todos, revision}` payload returned by Hermes `tools/todo_tool.py`, through `/api/sessions/{id}/messages`. The pre-run revision is captured first so an old plan is not announced as a new-turn update, and every later monotonic revision can project.

Upstream request remains open because direct Runs events are cleaner and lower-latency:

- NousResearch/hermes-agent#99686 — `API Server Runs: expose official todo.updated snapshots on /v1/runs event stream`

The real-target `--run` gate proves this automatically from both sides: persisted Hermes todo history proves the canonical source evolved, while the Studio Run snapshot proves that official state reached the product UI transport.

## Branding gate

Branding is now deterministic rather than subjective. The supported installer does **not** ship the earlier independent Worker Studio SVG favicon. During the atomic staging step it rewrites only the favicon assignment in the Product 3 bundle to `baseHref('/favicon.ico')`, so the installed product reuses the exact same-origin favicon served by the official Hermes Web Dashboard.

The pinned-upstream CI checks that `NousResearch/hermes-agent@HERMES_PIN` contains a non-empty `web/public/favicon.ico`, and installer tests prove the staged/installed Product 3 bundle uses `/favicon.ico` and no independent favicon asset is copied. The title remains `Hermes Worker Studio`. Therefore the Hermes-family branding gate closes automatically when CI is green.

## Release rule

Do not mark the PR ready, merge it, tag a release, or write `SEALED` until all three machine-verifiable evidence groups are green:

1. all PR CI checks pass on the exact PR head;
2. real-target `seal_acceptance.py --run` produces green `.seal/target.json`, including canonical todo revision history and a projected todo event;
3. real-target `npm run seal:ui` passes desktop + mobile projects and produces `.seal/ui-report.json` plus screenshots.

When those three evidence groups are green on the same candidate, Product 3 is eligible to be marked `SEALED` and merged. No separate upstream-plan or subjective favicon exception remains.
