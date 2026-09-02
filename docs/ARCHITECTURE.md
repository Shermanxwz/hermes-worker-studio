# Architecture — Hermes Worker Studio 3.0

## 1. Invariant

Studio is a **thin product layer over public Hermes contracts**. Hermes owns execution, child-agent lifecycle, model/provider resolution, persistence, approvals, Skills, Plugins and MCP. Studio owns navigation, product workflow, bounded UI projection and archive/seal evidence.

Forbidden architecture:

- private Hermes `AIAgent` construction/imports;
- direct Hermes SQLite/state access;
- independent Worker daemon or second agent runtime;
- second provider/model registry;
- guessed model capability or reasoning ladders;
- browser exposure of API Server bearer credentials.

## 2. Product 3 topology

```text
Official Hermes Web Dashboard
  └─ Dashboard Plugin SDK
      └─ Hermes Worker Studio 3
          ├─ tab.override = /                 product home
          ├─ header-left slot                 native-page return
          ├─ Sessions/history/search/archive  Hermes /api/sessions/*
          ├─ Models/Custom Endpoints          Hermes model/options + custom-endpoints
          ├─ MOA                            Hermes model/options + /api/model/moa
          ├─ Config/Full Access               Hermes /api/config
          └─ Conversation execution           Hermes /v1/runs
                                               ├─ status/events
                                               ├─ stop / approval / steer
                                               └─ canonical todo projection

Hermes Main Agent
  ├─ native delegate_task
  ├─ worker_delegate -> PluginContext.subagent_lifecycle
  └─ verifier route -> auxiliary.review.*
```

There is no execution hop outside Hermes.

## 3. Dashboard ownership

Product 3 owns only `/`. The Studio Advanced entry links directly to native `/sessions`; Hermes owns the native shell/sidebar and therefore future Hermes navigation additions. On the Studio root, a narrow, reversible host-shell compatibility layer suppresses the official outer sidebar/header because Hermes 0.20.6 has no public exclusive-shell contract; entering `/sessions` unmounts Studio and restores the native shell. Native pages render the official `header-left` slot with `← Worker Studio`.

The plugin never patches Hermes Web source files. Product home ownership is declared in `dashboard/manifest.json`.

## 4. Worker tools and modes

`__init__.py` receives Hermes `PluginContext`, binds it to `tools.py`, and registers exactly:

- `worker_delegate`
- `worker_status`
- `worker_catalog`

`worker_delegate` constructs public `SubagentLaunchRequest` and calls `ctx.subagent_lifecycle.launch()`. Studio retains only bounded convenience state; Hermes owns lifecycle truth.

Modes:

- `OFFICIAL`: Studio-managed `worker_delegate` sleeps; native Hermes behavior remains authoritative.
- `AUTO`: Studio worker delegation is allowed.
- `WORKER` (`DELEGATE` wire value): same Hermes runtime with orchestration-emphasized UX.
- `MAIN`: Hermes `pre_tool_call` blocks both new `worker_delegate` and native `delegate_task` launches.

Unknown configuration fails closed.

## 5. Models / endpoints

Canonical inventory is Hermes `/api/model/options`. Custom endpoint credentials/discovery use `/api/providers/custom-endpoints`.

Custom endpoint route suffixes are normalized at the Studio form boundary and
stored through Hermes' official Custom Endpoint contract. An explicit Hermes
provider/model capability is used as-is. Hermes 0.20.6 keeps generic-provider
transport at provider scope, so a mixed endpoint is handled only after the
operator explicitly starts the Studio “official probe” or chooses a mode: the
bridge makes up to two real Hermes `/v1/runs` calls, stores only bounded private
routing state, and writes a hidden per-model compatibility Provider through
Hermes `/api/config`. The source Provider remains unchanged. Unresolved or
ambiguous models fail closed; Studio never guesses from a model name or URL and
never probes while merely rendering the catalog.

- Main: Session model lock / Run request provider+model.
- Worker: Hermes `delegation.*`.
- Verifier: Hermes `auxiliary.review.*`.
- Connectivity: minimal real Hermes Run.
- Reasoning controls: explicit upstream metadata only; missing metadata => `Auto`.

Studio never keeps a parallel model registry.

MOA is a separate Studio sidebar surface rather than a section embedded in the
Models page. Its provider/model selectors are populated from the same official
`/api/model/options` response, so Hermes-discovered New API Custom Endpoint
models and other configured models stay in one source of truth. Preset edits
and native execution use Hermes' public `/api/model/moa`; immediately before a
MOA Run, the bridge resolves any already-probed per-model compatibility aliases
through the same official route. Studio does not implement a second
aggregator, model registry, or credential store.

## 6. Sessions and bounded UI state

Daily surface limits:

- recent rail: 20 sessions;
- current transcript: latest 80 messages;
- full history: 30 sessions/page;
- full-history messages: 100/page.

Search/archive/session CRUD stay server-side through Hermes APIs. Full-history
FTS search is deliberately kept out of the bounded chat surface: a clicked
Hermes search result loads the official message pages until the matching
message is found, then highlights and scrolls to that message. The chat view
continues to load only its latest 10 messages.

Studio's Run event ring, UI projections and retained lifecycle handles are bounded/disposable. Authoritative state remains Hermes.

## 7. Canonical official plan

Studio has no planner.

If Hermes `/v1/runs` emits `todo.updated`, Product 3 uses it directly. On the pinned Hermes revision where Runs does not expose the snapshot, `plugin_api_v3.py` reads only persisted results of Hermes' own `todo` tool from the documented Session API and projects them as `todo.snapshot` with `source=hermes_session_api`.

The pre-run todo revision is baselined; only newer revisions project. This preserves Hermes ownership while allowing Product 3 to show the same canonical plan without private state access.

## 8. Full Access

Full Access writes Hermes official approval/delegation settings, reads them back, performs a real authenticated Hermes marker Run, and restores the previous configuration on disable.

Hermes Hardline Blocklist remains authoritative and non-bypassable.

## 9. Multimodal / controls

`plugin_api_v3.py` preserves structured Run `input` verbatim, including image data URL parts. Stop, Steer and Approval forward to official Run control endpoints. No legacy chat execution fallback exists.

## 10. Installed candidate identity and branding

The source bridge contains `BUILD_CANDIDATE_SHA = "source-tree"`. The supported atomic installer rewrites the **staged copy only** to the exact candidate SHA (`HWS_CANDIDATE_SHA` or current git HEAD). `/product-capabilities` exposes that loaded identity.

The installer copies the project mark through Hermes' official plugin static-asset route. No independent favicon or copied native navigation list ships in the installed runtime.

This lets real-target evidence prove it is testing the same commit whose CI is green.

## 11. Seal closure

`tests/upstream-lock.json` contains exactly one runtime upstream: Hermes. Repository gates reject second-runtime/private-state/model-registry drift.

On the real target, `scripts/seal_close.py` closes the remaining evidence loop:

```text
exact clean git SHA
  -> atomic install + SHA stamp
  -> running Dashboard SHA read-back
  -> real Hermes Run + canonical todo evolution
  -> Session cleanup
  -> desktop/mobile Playwright
  -> independent evidence verifier
  -> .seal/SEALED.json
```

Only exact-head CI green + real-target `eligible: true` for the same SHA qualifies Product 3 for `SEALED`.
