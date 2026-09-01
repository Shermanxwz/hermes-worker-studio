# Hermes Dashboard route-scoped exclusive shell — Product 3 seal contract

Worker Studio's final product requirement is stricter than replacing the `/` page: while `/` is owned by Worker Studio, Hermes' built-in Dashboard navigation/chrome must not be rendered. Native Hermes Dashboard routes must remain untouched and regain the normal Hermes shell as soon as the user enters them through Worker Studio's **Advanced** navigation.

This must be implemented through a **public Hermes Dashboard Plugin contract**, never through DOM/CSS hiding, patched Hermes bundles, or a forked Dashboard.

Upstream tracking: https://github.com/NousResearch/hermes-agent/issues/100149

## Required UX

```text
Hermes Web /
  └─ Worker Studio exclusive product shell
       ├─ Chat
       ├─ Worker
       ├─ Models
       ├─ Full Access
       ├─ History
       └─ Advanced
            ├─ /sessions
            ├─ /cron
            ├─ /skills
            ├─ /plugins
            ├─ /mcp
            ├─ /profiles
            ├─ /analytics
            ├─ /logs
            └─ /config

Any native route
  └─ normal Hermes Dashboard shell restored
       └─ official Plugin SDK return slot → Worker Studio
```

## Proposed minimal public manifest contract

```json
{
  "tab": {
    "path": "/worker-studio",
    "override": "/",
    "shell": "exclusive"
  }
}
```

The exact upstream spelling may differ. When Hermes lands an equivalent documented public contract, Worker Studio must update the pinned Hermes revision and this verifier in the same reviewed change.

Required semantics:

1. Exclusive shell applies only while the overridden plugin route is active.
2. Hermes' built-in sidebar/header navigation is not mounted/rendered on that route.
3. Navigating to any native route automatically restores the normal Hermes shell.
4. Disabling the plugin restores ordinary Hermes routing and shell behavior.
5. Existing plugins without the field retain current behavior.
6. Desktop/mobile shell states must not flash or leak onto the exclusive route while plugin manifests load.
7. Auth, profile, theme, routing and Plugin SDK providers remain available to the plugin page.

## Seal enforcement

Product 3 is **ARCHIVE CANDIDATE**, not `SEALED`, until all of these are true:

- `tests/upstream-lock.json` pins an official `NousResearch/hermes-agent` commit containing the contract;
- `scripts/verify_required_upstream_contracts.py` verifies typed API, runtime enforcement, public docs and upstream behavior tests;
- CI's `Pinned Hermes public contracts + Product shell blocker` job is green for the exact PR head;
- `scripts/seal_upstream_gate.py` produces `.seal/upstream.json` with `dashboard_route_scoped_exclusive_shell.verified=true`;
- real-target Playwright proves `/` is the Worker Studio product shell and native routes restore Hermes navigation;
- `scripts/verify_seal_evidence.py` combines upstream + target + browser evidence and writes `SEALED.json` only when all three planes pass.

There is intentionally no `--skip-upstream-contract` or CSS fallback. If the official contract is missing, seal closure fails.
