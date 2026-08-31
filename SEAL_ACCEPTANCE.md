# Hermes Worker Studio 3 — Seal Acceptance

`SEALED` is a release state, not a design claim. Product 3 may be merged only after the repository gates **and** a real configured Hermes target pass.

## Automated repository gate

The pull request must be green for all CI jobs:

- Studio static + unit + Product 3 UI contract
- Hermes pinned public-contract verification
- Hermes upstream subagent lifecycle / Runs / approvals regression tests
- Hermes Plugin Doctor
- Production security / secret / second-runtime rejection

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

The harness is intentionally conservative. Its default checks are health, ownership/integration contracts, model catalog and a temporary session create → rename → archive → unarchive → delete lifecycle. `--run` additionally performs a real Hermes `/v1/runs` model turn and records event names.

## Product UI gate

The following paths must be exercised in a real desktop browser and a real mobile browser (or device emulator with touch + virtual keyboard behavior):

- `/` opens Worker Studio; `/sessions` remains the native Hermes Dashboard page.
- `高级 → 原生 Dashboard` works and the official `header-left` slot always exposes `← Worker Studio` on native pages.
- New conversation does not create a server session until first send and repeated new conversations never collide on title.
- Session rename, archive, unarchive and delete all round-trip after refresh.
- Composer: Enter send, Shift+Enter newline, growing textarea, Stop, run-time steer, image picker, drag/drop, clipboard paste, preview/remove, unsupported-file feedback.
- Auto-scroll follows live output, pauses when the user scrolls upward, shows jump-to-bottom, and preserves the user's auto-scroll preference.
- Official Hermes approvals render actionable choices and resolve against the active Run.
- Worker modes and Worker/Verifier routing persist through Hermes config and remain Hermes-native.
- Full Access clearly reports controlled/on state, verifies the real unattended marker when enabled, restores the previous approval configuration when disabled, and never bypasses Hermes hardline blocks.
- Custom endpoints can validate, add/edit, activate and delete; model discovery remains Hermes-owned.
- Mobile: drawer navigation, `100dvh`, safe-area composer, virtual keyboard, touch targets, long code/tool output, plan expansion and modal actions remain usable.

## Official plan gate

Worker Studio must never invent a planner or label inferred tool activity as an "official plan".

Hermes already owns canonical todo state and emits `todo.updated` on its TUI/Desktop gateway. The pinned public `/v1/runs` event bridge currently does **not** expose that snapshot. Upstream request:

- NousResearch/hermes-agent#99686 — `API Server Runs: expose official todo.updated snapshots on /v1/runs event stream`

Until the public Runs contract emits canonical todo snapshots (or Hermes provides an equivalent documented public contract), the Product 3 plan card is capability-driven: it renders only real `todo` events and otherwise stays absent. Closing this upstream contract is required before declaring the **official-plan portion** sealed.

## Branding gate

The shipped favicon/title must identify the product as Hermes Worker Studio and remain recognizably in the Hermes/NOUS family. The final icon should be derived from the official Hermes visual language rather than introducing an unrelated brand.

## Release rule

Do not mark the PR ready, merge it, tag a release, or write `SEALED` until:

1. all PR CI checks are green;
2. real-target `seal_acceptance.py --run` produces green evidence;
3. desktop + mobile product paths above are checked;
4. the official-plan public-contract gate is closed or explicitly version-gated to a Hermes release that provides it;
5. the final Hermes-family favicon is accepted.
