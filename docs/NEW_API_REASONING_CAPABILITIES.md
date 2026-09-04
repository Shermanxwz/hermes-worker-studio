# New API Reasoning Capability Closure

This document seals the compatibility path for OpenAI-compatible aggregators such as **New API** when Hermes can execute reasoning values but its public `/api/model/options` payload exposes only `reasoning: true` and does not publish the model-specific effort vocabulary.

## Problem boundary

The transport and the capability-discovery plane are separate:

- New API can forward OpenAI reasoning parameters such as `reasoning_effort` or Responses `reasoning.effort`.
- New API's OpenAI-compatible `/v1/models` surface does not reliably publish a machine-readable per-model effort vocabulary.
- Pinned Hermes may therefore publish a model as `reasoning: true` without `reasoning_efforts` / `can_disable_reasoning`.
- Worker Studio deliberately refuses to invent controls from model names, so a bare support boolean remains `Auto/read-only`.

The closure implemented here fixes the missing metadata **without** adding a built-in GPT/Claude/Gemini model table and without changing the execution engine.

## Authoritative sources and precedence

Worker Studio resolves reasoning capability for the exact Hermes Provider + Model route in this order:

1. Rich capability metadata already present in Hermes `/api/model/options`.
2. Exact per-model reasoning metadata explicitly declared in the matching provider entry in Hermes `/api/config`.
3. An explicit provider-wide `hws_reasoning_defaults` declaration in that same Hermes provider entry.
4. No metadata: remain fail-closed (`reasoning: true` means support only; no effort selector is fabricated).

Higher-priority fields are fill-protected. The config overlay can only fill fields that the higher-priority source omitted. It cannot replace a reasoning effort list, disable contract, control kind, or default that `/api/model/options` already published.

Provider config is not a second model inventory. Worker Studio only enriches models that Hermes already returned in the provider's `models`/`capabilities` inventory. Config-only model names never create selectable models.

## Recommended New API provider declaration

When one New API endpoint has one verified reasoning vocabulary for all of its exposed models, declare that vocabulary once:

```yaml
providers:
  newapi:
    name: New API
    base_url: https://newapi.example.com/v1

    # Explicit operator assertion used only when Hermes model/options is missing
    # the corresponding detail. `none` is converted to can-disable semantics and
    # is not treated as a reasoning strength.
    hws_reasoning_defaults:
      supports_reasoning: true
      reasoning_efforts:
        - none
        - low
        - medium
        - high
        - xhigh
        - max
      default_reasoning_effort: medium
```

Only use a provider-wide default when the endpoint contract really guarantees the same vocabulary for every model that will inherit it.

## Per-model override

For heterogeneous New API catalogs, prefer exact model metadata. An exact model declaration wins over the provider default:

```yaml
providers:
  newapi:
    base_url: https://newapi.example.com/v1

    hws_reasoning_defaults:
      supports_reasoning: true
      reasoning_efforts: [none, low, medium, high, xhigh, max]

    models:
      model-with-no-off:
        hws_reasoning:
          supports_reasoning: true
          can_disable_reasoning: false
          reasoning_efforts: [low, high]
          default_reasoning_effort: high
```

Worker Studio also accepts future/native Hermes-style explicit fields directly on a model entry, including:

- `reasoning` object fields such as `supported`, `control`, `can_disable`, `options`, `efforts`, `supported_efforts`, and `default_effort`;
- `supports_reasoning`;
- `can_disable_reasoning`;
- `reasoning_efforts` / `supported_reasoning_efforts`;
- `default_reasoning_effort`.

The `hws_reasoning` wrapper exists to make operator intent unambiguous and avoid collisions with unrelated provider settings.

## Runtime closure

The overlay changes capability discovery only. A selected non-Auto value still uses the existing sealed execution plane:

```text
Hermes /api/model/options
        +
Hermes /api/config explicit metadata
        |
        v
normalized route capability
        |
        v
validateReasoning(provider, model, value)
        |
        +-- invalid -> fail before any runtime write
        |
        v
Gateway session.resume
        |
        v
Gateway config.set { key: "reasoning", value: <validated value> }
        |
        v
existing native prompt.submit / Runs path
```

Main, Worker/delegation and MoA continue to share the same normalized descriptor and validator. Verifier remains read-only until Hermes exposes an independent verifier/review reasoning write contract.

## Refresh and cache closure

The capability bridge reads the official Dashboard `/api/config` contract in addition to `/api/model/options`.

- Normal picker opens cache the config snapshot for the page lifetime.
- `/api/model/options?refresh=1` invalidates and reloads both model inventory and config metadata.
- A Dashboard `/api/config` write invalidates the cached model capability snapshot.
- If `/api/config` is unavailable, the bridge falls back to `/api/model/options` only and does **not** invent a vocabulary.

No API key, base URL, or config payload is persisted by Worker Studio's capability layer. It reuses the Dashboard's existing authenticated config surface in memory.

## `none` semantics

`none` is the canonical reasoning-disabled state. It is never displayed as a strength level.

If an explicit effort list contains `none`, Worker Studio normalizes it to:

- `can_disable_reasoning: true`;
- effort selector values containing only the actual strengths;
- an independent Thinking on/off control when the resulting descriptor supports both disable and strengths.

## Upstream takeover

This compatibility layer is intentionally self-retiring.

When a future Hermes build begins publishing exact per-model reasoning controls directly in `/api/model/options`, those fields win automatically and the config overlay fills nothing. No Worker Studio model table or migration is required.

Likewise, if an upstream OpenAI-compatible gateway eventually exposes explicit capability metadata and Hermes propagates it, Worker Studio consumes the richer Hermes descriptor through the same normalized path.

## Negative guarantees

The seal requires all of the following:

- no `model.startsWith("gpt")`, provider-name heuristic, or fixed vendor effort table;
- no model is added to inventory from config metadata alone;
- bare `reasoning: true` without explicit metadata stays Auto/read-only;
- a config overlay cannot override richer `/api/model/options` metadata;
- per-model config overrides provider defaults;
- unsupported/off values fail before Gateway `config.set`;
- refresh reloads both authoritative model options and config metadata;
- config unavailability degrades to the previous fail-closed behavior.

These invariants are covered by `tests/frontend_model_capabilities.mjs` and run under `npm run test:model-capabilities` and the repository-wide `npm run test:frontend` seal suite.
