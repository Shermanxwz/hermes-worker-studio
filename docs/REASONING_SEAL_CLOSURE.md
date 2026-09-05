# Reasoning capability seal closure

Status: **code-level reasoning closure candidate**. This document does not change the repository-wide release state in `SEAL_ACCEPTANCE.md` / `docs/SEAL_STATUS.md`.

## Product boundary

All user models may sit behind one New API provider. Worker Studio therefore does **not** maintain a GPT/Claude/Gemini/Qwen/DeepSeek model registry and does not infer capabilities from model names.

The supported chain is:

1. Hermes `/api/model/options` owns model inventory.
2. Rich Hermes model capability metadata is authoritative when present.
3. Exact `providers.<provider>.models.<model>.hws_reasoning` metadata fills missing capability detail.
4. Provider `hws_reasoning_defaults` is only a fill-only fallback and must only describe a vocabulary genuinely shared by all inheriting models.
5. Missing capability detail fails closed; Studio never invents off states or effort ladders.
6. A concrete editable reasoning value is validated before the Hermes Gateway `config.set(reasoning=...)` write.
7. The execution route is resolved for the exact Provider + Model + requested reasoning state before the model lock / Run is submitted.
8. The Run `source_route` records both the resolved control and its `reasoning_source` provenance.

## Native MiniMax M3 binary invariant

`hws_native_reasoning: minimax_openai` is an explicit operator-selected native-wire contract. It is not inferred from a model name.

For the supported staged product it means:

- Chat Completions transport only.
- thinking on -> `thinking.type = adaptive`.
- thinking off -> `thinking.type = disabled`.
- `reasoning_split = true` remains an output-shape request in both states.
- there is a real binary toggle, but no fabricated MiniMax effort ladder.

The staged capability is therefore:

- `supported = true`
- `control = toggle`
- `canDisable = true`
- enabled token = Hermes canonical `medium` (semantic **on**, not a MiniMax strength)
- disabled token = Hermes canonical `none`
- source `hermes.provider_config.model+native.minimax_openai.binary`

The checked-in source capability keeps the older fixed-on fail-safe until release staging proves that the matching binary execution router is present. `scripts/stage_mixed_protocol.py` upgrades the capability and the execution path together in the **same staged artifact**; the installer never ships one without the other.

## Concurrency closure

The product never flips a shared provider alias between adaptive and disabled.

The adaptive Chat alias remains the normal immutable protocol alias. The disabled state gets a second deterministic managed alias ending in `-reasoning-off` with its own `extra_body.thinking.type = disabled`. Each Run selects one alias:

- `auto` or binary-on token -> adaptive alias
- `none` -> disabled alias

Creating or reconciling the disabled alias does not modify the adaptive alias. Concurrent on/off Runs can therefore execute without last-writer-wins provider state.

The disabled alias carries the normal `hws_protocol_bridge` source route plus `native_reasoning=minimax_openai` and `reasoning_state=disabled`, so capability validation can reverse it to the source New API Provider + Model.

A newly materialised managed alias may appear after the browser cached `/api/config`. The capability bridge therefore performs one authoritative config refresh only when an unknown `hws-protocol-*` execution provider is about to be validated. This is generic HWS alias reconciliation, not vendor/model inference.

## Validation closure

For an explicit `minimax_openai` native route:

- `auto` -> adaptive
- canonical binary-on `medium` -> adaptive
- canonical off `none` -> disabled
- fake strength values such as `high` / `xhigh` -> fail closed
- a non-Chat execution route -> fail closed

Other models do **not** inherit these rules. Their `canDisable`, control type, and effort vocabulary remain entirely capability-driven.

## Audit closure

`source_route.reasoning_source` distinguishes the declaration that authorized the Run control, including:

- `hermes.model.options`
- `hermes.provider_config.model`
- `hermes.provider_config.defaults`
- `hermes.provider_config.model+native.minimax_openai.binary` in the supported staged product

The existing `source_route.source` continues to describe the execution chain (`model_options + provider_config + gateway.config.set`). The two fields intentionally answer different questions: **where the capability truth came from** versus **which execution planes were used**.

## Regression gates

The seal is locked by focused tests rather than a vendor matrix:

- `tests/frontend_reasoning_seal.mjs`
  - preserves the source-tree fixed-on fail-safe when binary routing has not been staged;
  - ordinary New API per-model effort metadata remains generic;
  - Run provenance records the exact capability source.
- `tests/test_minimax_reasoning_seal.py`
  - the base managed Chat alias preserves exact model metadata and adaptive native wire;
  - the official `/v1/runs` submission uses the reconciled execution provider.
- `tests/test_stage_mixed_protocol.py`
  - the staged gateway upgrades the explicit native marker to a real binary toggle;
  - the frontend sends the selected reasoning state into execution-route resolution;
  - adaptive and disabled use distinct deterministic aliases;
  - creating disabled never mutates adaptive;
  - concurrent on/off route selection cannot cross-mutate state;
  - fake MiniMax effort values and non-Chat native routes fail closed.
- `tests/test_install.py`
  - the exact installed artifact contains the binary capability, reasoning-aware route resolver, and disabled alias implementation together.

## Deliberate non-features

These are not missing seal work:

- guessing reasoning support from model names;
- probing every vendor-specific reasoning parameter combination;
- maintaining an embedded model-family capability database;
- adding Claude/Gemini/Qwen/DeepSeek adapters without a demonstrated native-wire gap;
- pretending a binary thinking switch is an effort ladder.

If New API or Hermes later publishes richer machine-readable capabilities, the generic capability normalizer can consume them without adding model-name logic.

## Repository-wide seal

This closes the reasoning/capability subsystem at the code/product-contract level once the exact staged artifact and exact-main CI are green. Repository-wide `SEALED` still requires the independent acceptance conditions already documented by the project, including fresh exact-current-main evidence and any required upstream Hermes contract. Do not add more reasoning architecture to compensate for those non-reasoning release blockers.
