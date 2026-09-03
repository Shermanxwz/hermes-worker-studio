# Model Capability Seal

This document seals the **model capability subsystem** of Hermes Worker Studio. It does not change the repository-wide seal blocker documented for the missing Hermes route-scoped exclusive Dashboard shell contract.

## Invariants

1. **Hermes is authoritative.** Provider inventory, model inventory, protocol declarations, reasoning support and execution all come from documented Hermes surfaces. Studio must not ship a second model registry and must not infer capability from provider/model names.
2. **Capability is route-scoped.** A capability belongs to the effective Provider + Model + Hermes route/protocol, not to a model string in isolation.
3. **UI equals executable truth.** Studio must not render an editable control unless the selected execution plane can persist or apply it through an official Hermes contract.
4. **Missing metadata never becomes a guessed control.** Bare `reasoning: true` proves support only. It does not prove that reasoning can be disabled, and it does not prove an effort vocabulary. A toggle requires explicit `can_disable_reasoning=true` or an equivalent explicit public control; an effort selector requires an explicit upstream effort list.
5. **Execution fails closed.** Every non-Auto reasoning override is validated against the current Hermes capability descriptor and then applied to the Hermes runtime before prompt submission. Unsupported values are rejected before any Gateway write or prompt submission.
6. **Refresh is authoritative.** `/api/model/options?refresh=1` is re-normalized through the same capability layer, so provider/model changes and future upstream capability fields propagate without Studio registry edits.
7. **Gateway-native remains the product entry.** `dashboard/manifest.json` continues to enter through `dist/gateway-native.js`. The entry is a deterministic loader that installs the generic capability layers before the byte-stable native Gateway core; it does not create a second execution engine.

## Capability descriptor

Studio normalizes the public Hermes model capability into one generic descriptor:

| Control | Meaning | Product control |
| --- | --- | --- |
| `none` | Hermes says reasoning is unsupported | no editable reasoning control |
| `toggle` | upstream explicitly proves reasoning can be enabled/disabled, no proven effort vocabulary | Thinking switch only |
| `effort` | upstream publishes selectable efforts, disable is unavailable/unknown | Effort selector |
| `toggle_effort` | upstream publishes both disable and effort vocabulary | Thinking switch + effort selector |
| `fixed` | reasoning is explicitly mandatory/non-disableable | read-only “always on” state |
| `auto` | upstream proves support at most, but gives no safely editable control | Auto/read-only state |

The compatibility reader accepts additive public shapes such as `reasoning.control`, `reasoning.can_disable`, `reasoning.options`, `reasoning.efforts`, `can_disable_reasoning`, and the existing effort aliases. This is deliberately forward-compatible: when Hermes publishes a richer descriptor, Studio consumes it without model-name branches.

`none` is the Hermes canonical **thinking-disabled state**, not a reasoning strength. Any concrete effort value is treated as a selectable strength only when the upstream capability explicitly supplies that value. Studio does not carry its own list of which models accept which efforts.

## Browser/runtime topology

The sealed browser load chain is:

```text
dashboard/manifest.json
  -> gateway-native.js                 # manifest-owned deterministic loader
     -> model-capability-core.js        # generic descriptor + validator
     -> model-capability-bridge.js      # model/options, Run, MOA, Gateway config bridge
     -> model-capability-dom.js         # Worker/MOA/Verifier/Models presentation closure
     -> gateway-native-core.js          # byte-stable Hermes Gateway-native product runtime
        -> index-v3.js                  # existing Product 3 UI
```

The historical Gateway-native implementation is not forked into a new execution path. The structural verifier projects `gateway-native-core.js` onto the historical entry path while running every pre-existing Product 3 architecture assertion, then restores the loader and runs the new capability-layer assertions.

## Execution-plane closure

### Main conversation

- Provider/model selection remains Hermes model/session assignment.
- A non-Auto reasoning request must first pass `validateReasoning()` against the latest cached/fetched `/api/model/options` descriptor for the exact Provider + Model route.
- Only a validated request is applied through Hermes Gateway JSON-RPC:
  1. `session.resume` on the durable Studio session;
  2. `config.set { key: "reasoning", session_id: <runtime>, value: <none|explicit effort|explicit toggle-on token> }`;
  3. only then does the existing native Gateway path apply the model and call `prompt.submit`.
- Hermes `session.resume` owns live-runtime reuse; Studio does not construct an agent or a parallel conversation runtime.
- Run snapshots are annotated with bounded `source_route` metadata: Provider, Model, validated reasoning value, semantic (`auto`/`off`/`on`/`effort`), normalized control, and contract source.

### Worker / delegation

- Provider/model continue to persist in Hermes `delegation.*`.
- Reasoning uses Hermes `delegation.reasoning_effort`.
- `none` means thinking off only when the selected model capability explicitly allows disable; concrete effort values are selectable only when the capability publishes them; Auto removes the override and inherits Hermes defaults.
- The same normalized descriptor renderer is used as Main. Bare support metadata cannot create a Worker toggle or strength slider.

### Verifier / review

- Provider/model continue to persist in Hermes `auxiliary.review.*`.
- On the pinned Hermes revision, the public `/review` resolver consumes provider/model/base URL/API key/API mode but does **not** expose an independent reasoning write contract.
- Studio therefore renders the selected model’s reasoning capability as read-only and disables reasoning editing for Verifier. This is intentional fail-closed behavior, not a missing UI implementation.
- When Hermes adds a public `auxiliary.review` reasoning field, it can be enabled through the same descriptor without adding model-specific rules.

### MOA

- Provider/model inventory still comes exclusively from `/api/model/options`.
- Each Reference and Aggregator slot is capability-normalized independently.
- Official MoA `reasoning_effort` is preserved and round-tripped per slot.
- A locally changed slot override must pass the same `validateReasoning()` used by Main before PUT. Auto removes that local override; an invalid off/effort value fails the save rather than being silently persisted.
- Existing official preset values are not rewritten merely because Studio lacks enough metadata to edit them.
- Changing a slot’s provider/model resets the local reasoning override to Auto before save.

### Models page

- Protocol discovery remains Hermes-declared / real-Run-probed behavior.
- Reasoning status text is rewritten from the normalized descriptor (`不支持`, `开关`, `强度`, `开关 + 强度`, `始终开启`, `Auto`) instead of dumping a guessed scale.
- The DOM carries a source tooltip so an operator can distinguish explicit upstream control metadata from generic Hermes support metadata.

## Current Hermes capability boundary

The pinned Hermes inventory exposes `reasoning: true/false` and, for catalog routes that publish the detail, `can_disable_reasoning`. Hermes intentionally omits `can_disable_reasoning` when its catalog does not know whether disable is accepted.

Therefore Studio follows the same distinction:

- `reasoning: false` -> unsupported;
- `reasoning: true` alone -> support is known, editable control is **Auto/read-only**;
- `reasoning: true` + explicit `can_disable_reasoning: true` -> toggle-only unless an effort vocabulary is also published;
- explicit effort vocabulary -> effort control, optionally combined with a toggle if disable is also explicit;
- explicit mandatory/non-disableable metadata -> fixed/always-on.

This matters for routes serving models such as MiniMax M3. Hermes' provider runtime may know how to map an enabled/disabled reasoning state, but Studio does not infer that fact from the model name. A MiniMax M3 route shows a Thinking switch only when that route's public Hermes capability explicitly proves disable; otherwise it remains Auto until upstream publishes the missing capability.

## Seal tests

`tests/frontend_model_capabilities.mjs` locks the following behavior:

- descriptor normalization for unsupported, explicit toggle-only, explicit effort, fixed, and support-only/unknown reasoning;
- negative invariant: bare `reasoning: true` cannot fabricate a toggle or `none/default` effort list;
- `/api/model/options` enrichment without a second model registry;
- deterministic manifest-owned loader ordering before the native Gateway core;
- composition with the existing Gateway-native `SDK.fetchJSON` wrapper;
- Main Run validation plus official Gateway `session.resume` + session-scoped `config.set`;
- negative invariant: invalid off/effort values fail before Gateway `config.set`;
- bounded Run `source_route` audit metadata on started and subsequent snapshots;
- official MoA per-slot reasoning round-trip plus the same fail-closed validation for changed overrides;
- Verifier reasoning controls are read-only while the upstream contract is absent.

The historical `tests/frontend_gateway_native.mjs` is still executed against the byte-stable `gateway-native-core.js` through `tests/frontend_gateway_native_core_runner.mjs`, so none of the pre-existing Gateway reconnect/attachment/approval/usage assertions are discarded.

The model test is part of `npm run test:frontend` and also has a focused `npm run test:model-capabilities` entry.

## Upstream pin acceptance

A Hermes pin change affecting model inventory, Gateway session config, delegation, review, MoA, or provider reasoning is not accepted until this subsystem test passes. Any upstream capability shape change must be handled as a public-contract compatibility change; adding provider/model-name heuristics in Studio is not an acceptable workaround.
