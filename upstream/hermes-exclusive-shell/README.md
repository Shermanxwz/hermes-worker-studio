# Hermes Dashboard route-scoped exclusive shell contribution

This directory is a sealed upstream-contribution harness for
NousResearch/hermes-agent issue #100149.

## Exact upstream baseline

`63279301bcbdc185c1b07b98a9312eb0c862f26d`

The harness intentionally applies only to that exact source shape. Every
replacement is cardinality-checked; upstream drift fails closed instead of
silently producing a partial patch.

## Contract

A Dashboard plugin may declare:

```json
{
  "tab": {
    "path": "/worker-studio",
    "override": "/",
    "shell": "exclusive"
  }
}
```

Semantics:

- `shell` omitted or `"standard"` preserves the current Dashboard shell.
- `"exclusive"` is valid as a route-ownership signal only when `tab.override`
  identifies the active route.
- While plugin manifests are loading, Dashboard chrome is not painted, so an
  exclusive override cannot flash the native sidebar/header before discovery
  completes.
- On an exclusive route, Hermes keeps the Dashboard React/provider/router
  lifecycle but omits built-in chrome and renders the routed plugin at full
  viewport.
- Navigating to any other route deterministically restores the standard shell.
- No DOM/CSS monkey-patching and no plugin-side imperative hide/show API.

## Change surface

`apply.py` makes the upstream-ready changes to:

- `web/src/plugins/types.ts`
- `web/src/plugins/shell-mode.ts` (new)
- `web/src/plugins/shell-mode.test.ts` (new)
- `web/src/App.tsx`
- `tests/hermes_cli/test_web_server.py`
- `website/docs/user-guide/features/extending-the-dashboard.md`

The backend already passes the complete `tab` object through discovery, so no
runtime server implementation change is required; the existing manifest test
is extended to seal the `tab.shell` pass-through contract.

## Validation

`.github/workflows/upstream-exclusive-shell.yml` checks out the exact Hermes
revision, applies the contribution, rejects patch drift with `git diff --check`,
runs the backend manifest contract test, TypeScript typecheck, focused Vitest
coverage, and ESLint on every changed Web source.

This branch is staging evidence only. It does **not** make Worker Studio
globally SEALED until an equivalent typed, documented, runtime-enforced and
upstream-tested contract is merged into official Hermes and Worker Studio pins
that official revision.
