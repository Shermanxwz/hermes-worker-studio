# Hermes Worker Studio · Project Introduction

Hermes Worker Studio is a product-grade Web workspace for Hermes. It is an official Hermes Dashboard Plugin product shell: Studio owns navigation, interaction, and presentation; Hermes continues to own execution, models, sessions, approvals, Skills, Plugins, MCP, and persistence.

> Current status: **ARCHIVE CANDIDATE**. Code/product engineering and ordinary CI are designed to close cleanly, but the project must not be called `SEALED` until exact-current real-target evidence and the required upstream contract close on the same candidate.

## Positioning

Studio provides one product experience over Hermes' documented Dashboard, Gateway, Runs, Session, Model, Approval, and `PluginContext.subagent_lifecycle` contracts. It does not maintain a second agent core.

The governing rules are:

- Hermes is the sole upstream for execution, models, context, plans, policy, and persistence.
- Public Hermes capabilities are called through public Hermes contracts.
- No Hermes fork, core patch, or private database access.
- No second Worker runtime, planner, tokenizer, model catalog, or Provider client.
- Hermes API bearer secrets never enter the browser.
- Protocol and reasoning choices require official metadata or real execution evidence; model names are not capability evidence.

## Product surface

Worker Studio owns the product home route `/` and keeps six first-level product surfaces:

- **Chat** — Hermes Gateway sessions, send, stop, steer, approvals, and live lifecycle.
- **Worker** — official child-agent behavior through Hermes public `subagent_lifecycle`.
- **Models** — Hermes `/api/model/options` plus official Custom Endpoint management.
- **MOA** — a dedicated page/session list backed by Hermes `/api/model/moa`, or Hermes' official `/api/config` store when the pinned API Server does not expose the Dashboard-only route.
- **Full Access** — official approval/delegation configuration with authenticated Run verification.
- **Full History** — server-side full-text search, pagination, archive/restore/rename/delete.

**Advanced · Hermes Dashboard** goes directly to native `/sessions`. Hermes renders its own complete native navigation, so future Hermes routes do not require a copied Studio submenu. Native pages restore the official shell and expose `← Worker Studio` through official plugin slots.

## Official runtime map

| Product behavior | Hermes official source |
| --- | --- |
| Open/resume a session | Gateway WebSocket `session.resume` |
| Send a prompt | Gateway JSON-RPC `prompt.submit` |
| Steer/stop | `session.steer` / `session.interrupt` |
| Approvals/input requests | official `approval.respond`, `clarify.respond`, `mcp.setup.respond`, etc. |
| Context / Compact | `session.usage`, `session.context_breakdown`, `status.update` |
| Official plan | Hermes `todo.updated` or official Session API todo results |
| Tool/Skill/subagent activity | Gateway lifecycle + public `subagent_lifecycle` |
| Sessions/history | Hermes `/api/sessions/*` + official full-text search |
| Models/Providers | Hermes `/api/model/options`, `/api/providers/custom-endpoints` |
| MOA | Hermes `/api/model/moa` or official `/api/config` store + native `moa` provider |
| Attachments | `image.attach_bytes`, `pdf.attach`, `file.attach` |

Browser chat uses the official Hermes Gateway. `/v1/runs` remains a probe, CI, and unattended-verification surface, not a second chat runtime.

## New API and per-model protocol routing

Hermes 0.20.6 gives a generic Custom Endpoint a provider-scoped transport, while one New API inventory can legitimately contain both Chat Completions and Responses-only models. Studio closes that pinned-core gap with a narrow per-model compatibility bridge:

1. Explicit Hermes Provider/model protocol metadata wins.
2. A previously verified route is reused.
3. First real use of an unresolved model automatically performs real Hermes Chat/Responses probes.
4. Exactly one successful transport is cached per model and materialized as an isolated compatibility Provider through official `/api/config`.
5. Both-success remains ambiguous and requires explicit choice.
6. Both-failed remains fail-closed with the real results.
7. Studio never chooses transport from a URL, model name, or `gpt-*` label.

Concurrent first use shares one probe lock, and recent failures have a short cooldown to avoid duplicate billable/error storms. **Official probe** remains a diagnostic/retry action rather than a prerequisite for normal use. The original Provider/Model stays user-facing; managed aliases never become a second catalog.

Product Chat, independent Worker, Verifier, and MOA all use the same execution-route resolver.

## Conversation/data boundaries

- Normal Chat loads only the latest 10 messages.
- The ordinary recent rail excludes explicitly classified MOA sessions; the MOA page owns its separate MOA session list.
- Full History uses official Hermes full-text search and pages official messages until a hit is located; it never pretends the latest-10 window is a complete search index.
- Full History pages 30 sessions at a time and details 100 messages at a time.
- Slash commands use the official Hermes command catalog/execution path.
- Timing, tools, plan, Compact, and Skill changes are shown only from actual Hermes events or official persisted results.
- WebSocket loss keeps the durable Hermes Session alive and resumes over a fresh authenticated socket; a disconnect is never fabricated as terminal success/failure.
- Context occupancy comes only from Hermes context telemetry, never cumulative billing/input counters.

## Attachments and unattended operation

Picker, clipboard paste, and drag/drop share one attachment pipeline: images -> `image.attach_bytes`, PDFs -> `pdf.attach`, other files -> `file.attach` and the returned Hermes `@file:` reference.

Full Access changes only official Hermes approval/delegation settings, retains a restore snapshot, and verifies them with a real marker Run. It means Studio/Hermes will not wait on its own approval UI; it does not bypass passwords, MFA, CAPTCHA, OAuth, third-party authorization, or the Hermes Hardline Blocklist.

## Engineering and UI closure

The supported installer builds an exact candidate in a temporary tree, stamps its candidate SHA, then applies two deterministic exact-count/fail-closed transforms:

- `stage_product_bundle.py` — existing attachment family plus interaction/accessibility closure;
- `stage_mixed_protocol.py` — pinned-Hermes per-model mixed-protocol compatibility.

CI independently builds the same staged JS/Python and runs `node --check` / Python compile; installer tests assert the final installed file set and transformed behavior. This prevents a green review source from hiding a divergent installed artifact.

Final CSS layering is:

```text
product.css -> product-sealed.css -> product-closure.css
```

The closure layer changes no product capability or visual language. It hardens focus visibility, touch-only discoverability, dialog Escape/focus lifecycle, safe areas, short viewports, and reduced-motion behavior.

Real-target Playwright covers:

- desktop 1440×900;
- Pixel 7 portrait;
- compact touch landscape 667×375.

All six first-level Studio pages are visited in every product viewport and checked for horizontal overflow and product-root viewport bounds.

## Archive status

The only runtime upstream is the pinned Hermes revision:

```text
NousResearch/hermes-agent
9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea
```

Final sealing requires exact-current evidence:

```text
.seal/upstream.json
.seal/target.json
.seal/ui-report.json
        ↓
.seal/SEALED.json
```

The current required upstream blocker is the route-scoped exclusive-shell public contract tracked at `NousResearch/hermes-agent#100149` (or a verified equivalent formal contract in the pinned revision). Green ordinary CI means **ARCHIVE CANDIDATE**, never a substitute for that upstream gate or real-target evidence.

## Getting started

```bash
bash scripts/install.sh
python scripts/seal_close.py --url http://127.0.0.1:19119
```

If an exact Hermes source checkout already exists, add `--hermes-root /path/to/hermes-agent`.

## Related documentation

- [Architecture](ARCHITECTURE.md)
- [Product engineering closure](PRODUCT_CLOSURE.md)
- [Official upstream contracts](UPSTREAM_CONTRACTS.md)
- [Full acceptance rules](../SEAL_ACCEPTANCE.md)
- [Automated test matrix](AUTOMATED_TEST_MATRIX.md)
- [Dashboard exclusive-shell contract](HERMES_DASHBOARD_EXCLUSIVE_SHELL.md)
- [Security boundary](SECURITY.md)
