# Model Capability Seal

This document seals the **model capability subsystem** of Hermes Worker Studio. It does not change the repository-wide seal blocker documented for the missing Hermes route-scoped exclusive Dashboard shell contract.

## Invariants

1. **Hermes is authoritative.** Provider inventory, model inventory, protocol declarations, reasoning support and execution all come from documented Hermes surfaces. Studio must not ship a second model registry and must not infer capability from provider/model names.
2. **Capability is route-scoped.** A capability belongs to the effective Provider + Model + Hermes route/protocol, not to a model string in isolation.
3. **UI equals executable truth.** Studio must not render an editable control unless the selected execution plane can persist or apply it through an official Hermes contract.
4. **Missing metadata never becomes guessed strength.** If Hermes declares reasoning support but does not publish an effort vocabulary, Studio exposes only the control it can prove (for the current Hermes picker contract, the canonical on/off state) and does not invent `low`/`medium`/`high` options.
5. **Execution fails closed.** A requested reasoning override must be applied to the Hermes runtime before prompt submission. If that official write fails, Studio must not silently submit the prompt with a different reasoning state.
6. **Refresh is authoritative.** `/api/model/options?refresh=1` is re-normalized through the same capability layer, so provider/model changes and future upstream capability fields propagate without Studio registry edits.

## Capability descriptor

Studio normalizes the public Hermes model capability into one generic descriptor:

| Control | Meaning | Product control |
| --- | --- | --- |
| `none` | Hermes says reasoning is unsupported | no editable reasoning control |
| `toggle` | reasoning can be enabled/disabled, no proven effort vocabulary | Thinking switch only |
| `effort` | upstream publishes selectable efforts, disable is unavailable/unknown | Effort selector |
| `toggle_effort` | upstream publishes both disable and effort vocabulary | Thinking switch + effort selector |
| `fixed` | reasoning is mandatory | read-only “always on” state |
| `auto` | upstream gives no usable reasoning capability metadata | Auto/read-only state |

The compatibility reader accepts additive public shapes such as `reasoning.control`, `reasoning.can_disable`, `reasoning.options`, `reasoning.efforts`, and the existing effort aliases. This is deliberately forward-compatible: when Hermes publishes a richer descriptor, Studio consumes it without model-name branches.

`none` is the Hermes canonical **thinking-disabled state**, not a reasoning strength. `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, or future values are strengths only when the upstream capability explicitly supplies an effort vocabulary.

## Execution-plane closure

### Main conversation

- Provider/model selection remains Hermes model/session assignment.
- Before `/hermes/runs-v3` reaches the native Gateway submit path, a non-Auto reasoning choice is applied through Hermes Gateway JSON-RPC:
  1. `session.resume` on the durable Studio session;
  2. `config.set { key: "reasoning", session_id: <runtime>, value: <none|effort> }`;
  3. only then does the existing native Gateway path apply the model and call `prompt.submit`.
- The reasoning preflight is fail-closed.
- Run snapshots are annotated with bounded `source_route` metadata (`provider`, `model`, `reasoning`, contract source) so the existing projection can preserve the effective model route for audit/history.

### Worker / delegation

- Provider/model continue to persist in Hermes `delegation.*`.
- Reasoning uses Hermes `delegation.reasoning_effort`.
- `none` means thinking off; concrete effort means thinking on at that effort; empty/Auto removes the override and inherits Hermes defaults.
- The same capability renderer is used as Main, so toggle-only models do not grow a fake strength slider.

### Verifier / review

- Provider/model continue to persist in Hermes `auxiliary.review.*`.
- On the pinned Hermes revision, the public `/review` resolver consumes provider/model/base URL/API key/API mode but does **not** expose an independent reasoning write contract.
- Studio therefore renders the selected model’s reasoning capability as read-only and disables reasoning editing for Verifier. This is intentional fail-closed behavior, not a missing UI implementation.
- When Hermes adds a public `auxiliary.review` reasoning field, it can be enabled through the same descriptor without adding model-specific rules.

### MOA

- Provider/model inventory still comes exclusively from `/api/model/options`.
- Each Reference and Aggregator slot is capability-normalized independently.
- Official MoA `reasoning_effort` is preserved and round-tripped per slot.
- `none` persists the official off state; explicit strengths persist only from an upstream effort vocabulary; Auto removes the slot override.
- Changing a slot’s provider/model invalidates a stale local reasoning choice before save.

### Models page

- Protocol discovery remains Hermes-declared / real-Run-probed behavior.
- Reasoning status text is rewritten from the normalized descriptor (`不支持`, `开关`, `强度`, `开关 + 强度`, `始终开启`, `Auto`) instead of dumping a guessed scale.
- The DOM carries a source tooltip so an operator can distinguish explicit upstream control metadata from the current Hermes picker fallback.

## Current Hermes capability boundary

The pinned Hermes revision exposes `reasoning: true/false` and, for some routes, `can_disable_reasoning`, but deliberately does not forward provider catalog `supported_efforts` into `/api/model/options` because those catalogs can under-report real accepted values.

Therefore Studio does **not** manufacture a strength vocabulary. Generic `reasoning: true` is normalized to a Thinking toggle using Hermes' canonical `none`/enabled semantics. A richer effort UI appears only when Hermes returns an explicit effort list through a public additive field.

This matters for models such as MiniMax M3: Hermes' MiniMax provider maps disabled reasoning to MiniMax `thinking.type=disabled` and an enabled reasoning config to adaptive thinking; Hermes effort labels are not a MiniMax depth knob on that route. Studio must represent that as a switch until the upstream public capability says otherwise.

## Seal tests

`tests/frontend_model_capabilities.mjs` locks the following behavior:

- descriptor normalization for unsupported, toggle-only, explicit effort and fixed reasoning;
- `/api/model/options` enrichment without a second model registry;
- composition with the existing `gateway-native.js` `SDK.fetchJSON` wrapper;
- Main Run reasoning preflight through official Gateway `session.resume` + session-scoped `config.set`;
- fail-closed route metadata on started and subsequent Run snapshots;
- official MoA per-slot reasoning round-trip;
- Verifier reasoning controls are read-only while the upstream contract is absent.

The test is part of `npm run test:frontend` and also has a focused `npm run test:model-capabilities` entry.

## Upstream pin acceptance

A Hermes pin change affecting model inventory, Gateway session config, delegation, review, MoA, or provider reasoning is not accepted until this subsystem test passes. Any upstream capability shape change must be handled as a public-contract compatibility change; adding provider/model-name heuristics in Studio is not an acceptable workaround.
