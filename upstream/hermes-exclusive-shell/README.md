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
- The server validates and forwards only `"standard"` / `"exclusive"`, and
  only when a valid `tab.override` has already been accepted. Unknown or
  standalone shell declarations fail closed and are not exposed to the UI.
- While plugin manifests are loading, Dashboard chrome is not painted, so an
  exclusive override cannot flash the native sidebar/header before discovery
  completes.
- The existing sessionStorage manifest cache participates in the same loading
  gate. A background refresh that discovers a new `/chat` override or an
  exclusive-shell override raises the gate in the same React batch as the new
  manifests, preventing stale cache state from briefly painting native UI.
- On an exclusive route, Hermes keeps the Dashboard React/provider/router
  lifecycle but omits built-in chrome and renders the routed plugin at full
  viewport.
- Navigating to any other route deterministically restores the standard shell.
- No DOM/CSS monkey-patching and no plugin-side imperative hide/show API.

## Change surface

The contribution applies upstream-ready changes to:

- `hermes_cli/web_server.py`
- `web/src/plugins/types.ts`
- `web/src/plugins/shell-mode.ts` (new)
- `web/src/plugins/shell-mode.test.ts` (new)
- `web/src/plugins/usePlugins.ts`
- `web/src/plugins/usePlugins.test.ts`
- `web/src/App.tsx`
- `web/src/App.exclusive-shell.test.tsx` (new)
- `tests/hermes_cli/test_web_server.py`
- `website/docs/user-guide/features/extending-the-dashboard.md`

`_discover_dashboard_plugins()` currently rebuilds `tab_info` from an explicit
allow-list (`path`, `position`, `override`, `hidden`). The backend contribution
extends that public boundary with the validated route-scoped `shell` field and
adds positive + fail-closed tests for standard, exclusive, unknown, and
standalone declarations.

`usePlugins()` already has a load-bearing cache gate for `/chat` overrides. The
contribution generalizes that ownership gate to exclusive-shell overrides and
to background manifest refreshes so no stale cache path can flash native
Dashboard chrome before the active plugin route is resolved.

The focused jsdom App test verifies the actual rendered contract, not only the
resolver: pending discovery has no native chrome, `/` exclusive renders the
plugin without shell slots/sidebar, and a standard `/sessions` override renders
inside the normal Hermes shell again.

## Validation

`.github/workflows/upstream-exclusive-shell.yml` checks out the exact Hermes
revision, applies every contribution stage, rejects patch drift with
`git diff --check`, runs the complete Dashboard manifest-extension backend test
class, TypeScript typecheck, focused resolver/cache/jsdom DOM tests, ESLint on
all changed Web sources, the full Hermes Web Vitest regression suite, and a
production Web build.

This branch is staging evidence only. It does **not** make Worker Studio
globally SEALED until an equivalent typed, documented, runtime-enforced and
upstream-tested contract is merged into official Hermes and Worker Studio pins
that official revision.
