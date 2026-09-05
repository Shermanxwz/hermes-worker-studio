# Architecture — Hermes Worker Studio 3.0

## 1. Invariant

Studio is a **thin product layer over public Hermes contracts**. Hermes owns execution, child-agent lifecycle, model/provider resolution, persistence, approvals, Skills, Plugins and MCP. Studio owns navigation, product workflow, bounded UI projection and archive/seal evidence.

Forbidden architecture:

- private Hermes `AIAgent` construction/imports;
- direct Hermes SQLite/state access;
- independent Worker daemon or second agent runtime;
- second provider/model registry;
- guessed model capability, protocol or reasoning ladders;
- browser exposure of API Server bearer credentials.

## 2. Product 3 topology

```text
Official Hermes Web Dashboard
  └─ Dashboard Plugin SDK
      └─ Hermes Worker Studio 3
          ├─ tab.override = /                 product home
          ├─ header-left/sidebar slots        native-page return
          ├─ Sessions/history/search/archive  Hermes /api/sessions/*
          ├─ Models/Custom Endpoints          Hermes model/options + custom-endpoints
          ├─ MOA                              Hermes model/options + /api/model/moa
          ├─ Config/Full Access               Hermes /api/config
          └─ Product conversation             Hermes TUI Gateway WebSocket /api/ws
                                               ├─ session.resume
                                               ├─ config.set (session model lock)
                                               ├─ prompt.submit
                                               ├─ session.usage/context_breakdown
                                               ├─ todo/status/tool/subagent events
                                               ├─ session.steer / interrupt
                                               └─ approval / unattended input replies

Hermes probe / acceptance surface
  └─ Hermes official /v1/runs
      └─ protocol probes, marker probes and compatibility verification

Hermes Main Agent
  ├─ native delegate_task
  ├─ worker_delegate -> PluginContext.subagent_lifecycle
  └─ verifier route -> auxiliary.review.*
```

There is no execution hop outside Hermes. Product chat does **not** use a second REST runtime: its live transport is the official Hermes Gateway; `/v1/runs` remains an official Hermes probe/acceptance/unattended rail.

## 3. Dashboard ownership

Product 3 owns only `/`. The Studio Advanced entry links directly to native `/sessions`; Hermes owns the native shell/sidebar and therefore future Hermes navigation additions. On the Studio root, a narrow, reversible host-shell compatibility layer suppresses the official outer sidebar/header because Hermes 0.20.6 has no public exclusive-shell contract; entering `/sessions` unmounts Studio and restores the native shell. Native pages render official return slots with `← Worker Studio`.

The plugin never patches Hermes Web source files. Product home ownership is declared in `dashboard/manifest.json`.

The stylesheet chain is deliberately layered:

```text
product.css
  -> product-sealed.css
      -> product-closure.css   (manifest-loaded final layer)
```

The closure layer does not introduce a new visual language. It only hardens focus visibility, pointer-less touch discoverability, safe-area/dialog bounds, short mobile viewports and reduced-motion behavior.

## 4. Worker tools and modes

`__init__.py` receives Hermes `PluginContext`, binds it to `tools.py`, and registers exactly `worker_delegate`, `worker_status`, and `worker_catalog` plus the `pre_tool_call` policy hook.

`worker_delegate` constructs public `SubagentLaunchRequest` and calls `ctx.subagent_lifecycle.launch()`. Studio retains only a bounded convenience handle map; Hermes owns lifecycle truth.

Modes:

- `OFFICIAL`: Studio-managed `worker_delegate` sleeps; native Hermes behavior remains authoritative.
- `AUTO`: Studio worker delegation is allowed.
- `WORKER` (`DELEGATE` wire value): same Hermes runtime with orchestration-emphasized UX.
- `MAIN`: Hermes `pre_tool_call` blocks both new `worker_delegate` and native `delegate_task` launches.

Unknown configuration fails closed. Convenience handles are bounded to 256 entries and tool-level waits are bounded; neither is an execution store.

## 5. Models / endpoints / mixed protocol routing

Canonical inventory is Hermes `/api/model/options`. Custom endpoint credentials/discovery use `/api/providers/custom-endpoints`. Studio never keeps a parallel model registry.

A pasted terminal path such as `/v1/responses` is normalized to the provider API root. Model discovery still comes from the endpoint's standard model inventory; the pasted URL is **not** treated as proof that every model uses Responses.

Hermes 0.20.6 keeps transport at generic-provider scope, while one compatible endpoint can legitimately expose both Chat Completions and Responses-only models. Product 3 therefore resolves transport **per model**:

1. explicit Hermes model/provider protocol metadata wins immediately;
2. a previously verified per-model route is reused;
3. otherwise the first real use performs the same real Hermes Chat/Responses probe used by the Models diagnostic;
4. exactly one successful transport is cached and materialized as a narrow managed provider alias through official `/api/config`;
5. if both transports work the route remains ambiguous and requires explicit operator choice;
6. if neither works the request fails with the real probe result;
7. model names and URL suffixes are never protocol evidence.

Concurrent first use of one provider/model shares one probe lock, and a recent failed probe has a short retry cooldown. The **官方探测** button remains a diagnostic/manual-retry action, not a prerequisite for normal use.

The same execution-route resolver is used by Product Chat, Worker `delegation.*` pins, Verifier `auxiliary.review.*` pins, native Hermes MOA slots and real model/protocol diagnostics. Managed compatibility aliases remain implementation details and are reversed to the original source Provider/Model for normal UI display.

Reasoning controls consume explicit upstream metadata only; missing metadata => `Auto` and the request/config omits a guessed effort.

## 6. MOA

MOA is a separate Studio sidebar surface rather than a duplicate section in Models. Its provider/model selectors use the same official `/api/model/options` response.

Preset edits and execution use Hermes `/api/model/moa`; when the pinned API Server does not expose that Dashboard-only route, the bridge uses Hermes' own official `/api/config`/`save_config` boundary in-process. Immediately before native MOA execution, every source slot passes through the same per-model route resolver. Studio does not implement a second aggregator, model registry, model client or credential store.

## 7. Sessions and bounded UI state

Daily surface limits:

- recent rail: latest 10 sessions;
- current transcript: latest 10 messages;
- full history: 30 sessions/page;
- full-history messages: 100/page.

Search/archive/session CRUD stay server-side through Hermes APIs. Full-history FTS search is deliberately outside the bounded chat surface: a clicked Hermes search result loads official message pages until the matching row is found, then highlights and scrolls to it. Chat continues to load only its latest 10 messages.

The ordinary recent rail reads Hermes session rows through the Studio's bounded
classification projection and excludes rows explicitly marked as MOA. The
dedicated MOA page reads the same official session rows (accepting both
Dashboard `sessions` and API Server `data` list envelopes) and shows only rows
with an official `moa` identity or a durable Studio MOA marker.

Studio's browser Run projection, UI event rings and retained lifecycle convenience handles are bounded/disposable. Authoritative state remains Hermes.

## 8. Canonical plan and context

Studio has no planner and no second tokenizer.

Live product chat consumes Hermes Gateway `todo.updated`, status and context events. The REST probe bridge may project persisted results of Hermes' own `todo` tool as `todo.snapshot` when an official Runs stream does not expose that snapshot. The pre-run revision is baselined so stale plans are not announced as new work.

Current context occupancy comes only from explicit Hermes context telemetry (`session.usage`, `session.context_breakdown`, or the public session-context contract when available). Cumulative billing/input token totals are never presented as current context usage.

## 9. Full Access

Full Access writes Hermes official approval/delegation settings, reads them back, performs a real authenticated Hermes marker Run, and restores the previous configuration on disable.

Hermes Hardline Blocklist remains authoritative and non-bypassable. No browser setting can grant authority beyond Hermes policy.

## 10. Attachments / controls / accessibility

The product composer stages images, PDFs and ordinary files only through official Gateway attachment methods: `image.attach_bytes`, `pdf.attach`, and `file.attach`. Ordinary files use the `@file:` reference returned by Hermes. The browser has no independent file runtime.

Stop, Steer, Approval and unattended input responses are Gateway-native. Dialogs, menus, disclosures, composer controls and mobile navigation have explicit accessible names/state; dialogs close on Escape, trap focus while open and return focus when closed. Touch-only devices never depend on hover to discover session actions.

## 11. Deterministic supported artifact

The checked-in browser/backend source remains reviewable. The supported installer creates a temporary candidate, stamps the exact `BUILD_CANDIDATE_SHA`, then applies three exact-count build transforms:

- `stage_product_bundle.py` — existing attachment family plus interaction/accessibility closure;
- `stage_mixed_protocol.py` — pinned-Hermes per-model mixed-protocol compatibility;
- `stage_security_closure.py` — staged private-state write hardening plus explicit malformed-JSON HTTP 400 handling.

The security transform creates projection/protocol temporary files with `O_CREAT|O_EXCL`, adds `O_NOFOLLOW` when available, assigns mode `0600` at creation time, fsyncs the payload and then replaces the destination. It does not become a persistence authority: these remain bounded Studio projections/route hints while Hermes owns execution/session/model truth.

These transforms have no network/process/runtime ownership and fail closed if their source anchors drift. CI independently builds this same staged JS/Python, syntax-checks it, runs a high-severity audit against the exact npm lockfile and asserts the security closure tokens. Installer tests assert the exact installed file set, final behavior and post-swap rollback.

Installation is a transaction. The staged tree passes Plugin Doctor before replacement. Existing installs prefer Linux `renameat2(RENAME_EXCHANGE)` so old/new names exchange atomically; the portable fallback moves the old tree to a rollback location before replacement. The old plugin and theme remain recoverable until the exact installed path passes Plugin Doctor and official `hermes plugins enable` succeeds. Failure restores previous state and removes transaction residue. Only then is the rollback copy discarded.

The only intentional candidate-specific mutation is the exact SHA stamp. `/product-capabilities` exposes the loaded candidate identity so target/browser evidence can prove the running product is the same code whose canonical CI is green.

## 12. Seal identity and evidence topology

The final sealed identity is the exact current **`main` HEAD**, never a PR head that will later be merged. Code lifecycle and evidence lifecycle are therefore separated:

```text
PR CI green
  -> merge changes into main
  -> exact-main push CI green
  -> ARCHIVE CANDIDATE
  -> manual real-target seal of that exact main SHA
```

`seal_close.py` produces three evidence planes plus the final verdict:

```text
exact clean main SHA
  -> upstream required-contract evidence
  -> deterministic staged artifact + transactional install + SHA stamp
  -> running Dashboard SHA read-back
  -> target evidence v2
       -> real Hermes Run
       -> requested source Provider/Model
       -> final resolved execution route / execution Provider
       -> canonical todo
       -> Session cleanup + post-delete 404
  -> browser evidence
       -> desktop 1440×900
       -> Pixel 7 portrait
       -> compact touch landscape 667×375
       -> each project reads running candidate SHA
       -> every first-level page viewport/overflow closure
       -> desktop native return
  -> seal-verdict v2
```

The manual target workflow fetches `origin/main` and refuses to proceed unless it equals the candidate. It has only `actions: read` and `contents: read`; no repository mutation occurs after evidence capture.

`github_finalize_seal.py` is a read-only final identity gate. It requires repository default branch `main`, current main SHA equal to the candidate, and an exact-candidate `push` CI named `CI` from `.github/workflows/ci.yml` with `completed/success`.

Only exact-current **main** push CI green + required upstream contract + target evidence v2 + three required browser passes + seal-verdict v2 + read-only exact-main verification qualify Product 3 for `SEALED`. Repository CI alone never upgrades `ARCHIVE CANDIDATE`, and the official exclusive-shell issue remains a hard gate while absent from the pinned Hermes revision. Git tags and GitHub Releases are optional distribution metadata, not seal identity.
