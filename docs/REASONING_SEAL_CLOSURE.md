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
7. The Run `source_route` records both the resolved control and its `reasoning_source` provenance.

## Native MiniMax invariant

`hws_native_reasoning: minimax_openai` currently means one narrow execution policy:

- Chat Completions transport only.
- Alias wire contains `thinking.type = adaptive`.
- `reasoning_split = true` is an output-shape request.
- Worker Studio does not expose a per-Run MiniMax off switch or effort ladder.

Because the actual native wire is fixed adaptive-on, the enriched capability is constrained to:

- `supported = true`
- `control = fixed`
- `canDisable = false`
- no executable effort vocabulary
- source `hermes.provider_config.model+native.minimax_openai`

This constraint is applied after normal metadata enrichment so stale or contradictory editable metadata cannot make the UI promise a state that the native request path cannot execute.

## Audit closure

`source_route.reasoning_source` distinguishes the declaration that authorized the Run control, including:

- `hermes.model.options`
- `hermes.provider_config.model`
- `hermes.provider_config.defaults`
- `hermes.provider_config.model+native.minimax_openai`

The existing `source_route.source` continues to describe the execution chain (`model_options + provider_config + gateway.config.set`). The two fields intentionally answer different questions: **where the capability truth came from** versus **which execution planes were used**.

## Regression gates

The seal is locked by focused tests rather than a vendor matrix:

- `tests/frontend_reasoning_seal.mjs`
  - contradictory MiniMax editable metadata is reduced to fixed-on execution truth;
  - `none` and fake effort values are rejected;
  - ordinary New API per-model effort metadata remains generic;
  - Run provenance records the exact capability source.
- `tests/test_minimax_reasoning_seal.py`
  - a resolved MiniMax source route reconciles the managed Chat alias;
  - the alias preserves exact model metadata and native adaptive wire;
  - the official `/v1/runs` submission uses the reconciled execution provider.

## Deliberate non-features

These are not missing seal work:

- guessing reasoning support from model names;
- probing every vendor-specific reasoning parameter combination;
- maintaining an embedded model-family capability database;
- adding Claude/Gemini/Qwen/DeepSeek adapters without a demonstrated native-wire gap;
- adding MiniMax per-Run disabled/adaptive control while the execution path is static adaptive-on.

If New API or Hermes later publishes richer machine-readable capabilities, the generic capability normalizer can consume them without adding model-name logic.

## Repository-wide seal

This closes the reasoning/capability subsystem at the code/product-contract level. Repository-wide `SEALED` still requires the independent acceptance conditions already documented by the project, including fresh exact-current-main evidence and any required upstream Hermes contract. Do not add more reasoning architecture to compensate for those non-reasoning release blockers.
