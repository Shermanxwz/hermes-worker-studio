# Hermes Worker Studio · Project Introduction

Hermes Worker Studio is a product-grade Web workspace for Hermes. It is a product shell implemented as an official Hermes Dashboard Plugin: Studio owns navigation, interaction, and presentation; Hermes continues to own execution, models, sessions, approvals, Skills, Plugins, MCP, and persistence.

> Current status: **ARCHIVE CANDIDATE**. Repository engineering acceptance and ordinary CI are closed, but the project must not be called `SEALED` until the missing upstream contract is implemented and pinned.

## Positioning

Studio provides one product experience over Hermes' documented Dashboard, Gateway, Runs, Session, Model, Approval, and `PluginContext.subagent_lifecycle` contracts. It does not maintain a second agent core.

The governing rules are:

- Hermes is the sole upstream for execution, models, context, plans, policy, and persistence.
- Capabilities that Hermes exposes publicly are called through those public contracts.
- No Hermes fork, core patch, or private database access.
- No second Worker runtime, planner, tokenizer, model catalog, or Provider client.
- Hermes API bearer secrets never enter the browser.

## Product surface

Worker Studio owns the product home route `/` and provides:

- **Chat** — Hermes Gateway sessions, send, stop, steer, approvals, and live lifecycle.
- **Worker** — official child-agent behavior through Hermes public `subagent_lifecycle`.
- **Models** — the Hermes `/api/model/options` inventory and official Custom Endpoint management.
- **MOA** — a dedicated MOA page and session list backed by Hermes `/api/model/moa`.
- **Full Access** — Hermes approval/delegation configuration with an authenticated official Run read-back check.
- **Full History** — server-side search, pagination, message pagination, archive, restore, rename, and delete.

The **Advanced · Hermes Dashboard** entry goes directly to Hermes' native `/sessions` route. Hermes renders the complete native navigation itself, so future Hermes navigation additions appear there without a copied Studio submenu. Once a native route is entered, the official Dashboard shell is restored and the official plugin slot provides a return path to Studio.

## Official interface map

| Product behavior | Hermes official source |
| --- | --- |
| Open/resume a session | Gateway WebSocket `session.resume` |
| Send a prompt | Gateway JSON-RPC `prompt.submit` |
| Steer/stop a running task | `session.steer` / `session.interrupt` |
| Approvals and interactive requests | Official responses such as `approval.respond`, `clarify.respond`, and `mcp.setup.respond` |
| Context and Compact | `session.usage`, `session.context_breakdown`, and `status.update` |
| Official plan | Hermes `todo.updated` events or official Session API todo results |
| Tool, Skill, and subagent activity | Hermes Gateway lifecycle events and public `subagent_lifecycle` |
| Sessions and history | Hermes `/api/sessions/*` and official message full-text search |
| Models and Providers | Hermes `/api/model/options` and `/api/providers/custom-endpoints` |
| MOA | Hermes `/api/model/moa` and the native `moa` provider |
| File attachments | `image.attach_bytes`, `pdf.attach`, and `file.attach` |

The browser chat surface uses the official Hermes Gateway. `/v1/runs` remains a probe, CI, and unattended-verification surface, not a second chat execution core.

## Conversation behavior and data boundaries

- The normal conversation view loads only the latest 10 messages for fast startup.
- Full History uses Hermes official full-text search. Selecting a result pages through official messages, then locates and scrolls to the matching message instead of pretending that the recent-message window is a complete search index.
- Full History is paginated at 30 sessions per page; conversation details load up to 100 messages per page.
- Typing `/` exposes the Hermes command catalog with Chinese explanations. Selecting a command inserts the real command token and sends it through Hermes' official command execution path; it is not emitted as an ordinary chat sentence.
- Live elapsed time, tool activity, official plans, Compact, and Skill changes are shown only from actual Hermes events or official persisted results. Studio does not invent them when upstream data is absent.
- When the WebSocket drops, the durable Hermes Session is kept alive. Studio reconnects with `session.resume` and rebinds to official messages and state rather than reporting a disconnect as success or failure.
- Session titles are derived from the user's prompt and no longer receive a random `· xxxxx` suffix.

## What MOA means

MOA (Mixture of Agents) is Hermes' official aggregation mode: several Reference models analyze a prompt, an Aggregator combines their analyses into the final answer, and Hermes still owns the final Run. It is not a second Studio chat model or an independent aggregator runtime.

The MOA page reads available Provider/Model entries from Hermes' official inventory and saves the preset back through Hermes `/api/model/moa`. If a Reference or Aggregator lacks official Hermes credentials, the UI shows the specific configuration state instead of claiming that the run is ready. Credentials remain the responsibility of Hermes' official setup/provider configuration.

## New API and protocol selection

Hermes 0.20.6 resolves a generic Custom Endpoint's protocol at Provider scope; it cannot automatically infer Chat Completions versus Responses per model from a model name. Studio therefore follows these rules:

1. A protocol explicitly declared by Hermes for a Provider/model is authoritative.
2. For a mixed New API, a real Hermes Run probe happens only after the user explicitly selects a mode or clicks **Official probe**.
3. The result is stored as bounded per-model route state and an isolated compatibility Provider is materialized through Hermes' official configuration API.
4. Unresolved or conflicting results fail closed; Studio never guesses from a URL, model name, or GPT-like label.

The source Provider is not silently rewritten, and page load never triggers a hidden probe.

## Security and unattended operation

Full Access changes only Hermes' official approval/delegation settings, keeps a restore snapshot, and verifies the result with a real marker Run. It means that Studio/Hermes will not wait for an approval UI; it does not conjure passwords, MFA, CAPTCHA, OAuth, third-party authorization, or bypass Hermes' Hardline Blocklist.

Worker modes use Hermes' public `PluginContext.subagent_lifecycle`. Studio does not start an external Worker service or reproduce Hermes execution logic.

## Archive status

The only runtime upstream is the pinned Hermes revision:

```text
NousResearch/hermes-agent
9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea
```

Ordinary repository CI verifies code, dependency boundaries, product runtime, the pinned Hermes public baseline, and security contracts. Final sealing additionally requires three target-machine evidence planes:

```text
.seal/upstream.json
.seal/target.json
.seal/ui-report.json
.seal/SEALED.json
```

Until the route-scoped exclusive-shell contract tracked in Hermes upstream issue #100149 is implemented and included in the pinned revision, `seal_close.py` must stop at Gate 0 and must not produce a `SEALED.json` with `eligible: true`.

## Getting started

On a host with Hermes installed, use the repository's atomic installer:

```bash
bash scripts/install.sh
```

The installer enables the plugin through Hermes' official Plugin command and runs Plugin Doctor. The target-machine seal loop is:

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

If a Hermes source checkout already exists, add `--hermes-root /path/to/hermes-agent`. The seal process never skips the upstream gate and never fabricates target or browser evidence.

## Related documentation

- [Architecture](ARCHITECTURE.md)
- [Official upstream contracts](UPSTREAM_CONTRACTS.md)
- [Full acceptance rules](../SEAL_ACCEPTANCE.md)
- [Automated test matrix](AUTOMATED_TEST_MATRIX.md)
- [Dashboard exclusive-shell contract](HERMES_DASHBOARD_EXCLUSIVE_SHELL.md)
- [Security boundary](SECURITY.md)

