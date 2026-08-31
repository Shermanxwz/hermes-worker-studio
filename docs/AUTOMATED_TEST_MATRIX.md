# Automated Test Matrix

This document separates **repository/hosted-runner proof** from **target-machine seal proof**. A green CI run proves an `ARCHIVE CANDIDATE`; it is intentionally forbidden to claim that a user's private Hermes installation/OAuth/provider/browser is `SEALED` without real-host evidence.

## Pinned upstream baseline

`tests/upstream-lock.json` is machine-readable and authoritative.

| Component | Pinned revision | Version/channel |
|---|---|---|
| Hermes Agent | `4f22543509d1b91dc45bcb369447126c5eb14fb7` | `0.20.6` post-release snapshot |
| Hermes official release lineage | `5fc308a70719a83cccdbba4c0e39c23f5a8239d5` | `v2026.8.27` |
| codex-worker-delegation | `e965517e5bddeda57f5bc2b015a817279ea8e6e5` | `3.2.0` |

The upstream-contract job fetches enough Hermes history to prove the release commit is an actual ancestor of the pinned snapshot.

## 1. Studio static + integration + UI runtime

This job verifies the shipped Studio itself:

- Python `compileall` over runtime/scripts/tests;
- JS syntax of the actual shipped IIFE and runtime harness;
- shell syntax of install/start scripts;
- static archive invariants in `scripts/verify_contract.py`;
- Python unit + real loopback HTTP integration + installer tests;
- actual shipped Dashboard bundle rendered through jsdom/React with Hermes SDK-shaped runtime;
- manifest JSON validation;
- npm high-severity audit.

### Python/runtime invariants

Coverage includes:

- native Hermes `/v1/runs` request translation (`message -> input`, session/model/provider/options whitelist);
- native Runs status is authoritative;
- native Runs events retain event names/data;
- stop/approval/steer exact forwarding;
- capability-gated legacy `chat/stream` fallback only when Runs is absent;
- native event EOF cannot invent success;
- legacy clean EOF -> `incomplete`;
- poll cursors, bounded event ring, oversized-event truncation, TTL cleanup;
- concurrent append monotonic sequence and snapshot isolation;
- real loopback HTTP bearer forwarding/error translation/invalid JSON/size rejection;
- Worker outage remains delegation-degraded while Hermes health stays independent;
- backend Worker start permitted only AUTO/DELEGATE;
- OFFICIAL/MAIN start blocked before Worker execution;
- native `worker_delegate` repeats the same mode read/fail-closed policy;
- unknown Worker mode fails closed;
- danger-full-access default remains explicit;
- atomic staged plugin install, doctor gate, idempotent reinstall, rollback.

### Shipped UI runtime invariants

The runtime harness verifies the real `dashboard/dist/index.js`, including:

- recent/session/history limits `10 / 40 / 20 / 100`;
- official FTS search and archived-only filter;
- native Skills / Plugins / MCP navigation;
- four mode tabs `OFFICIAL / AUTO / WORKER(DELEGATE) / MAIN`;
- actual Worker catalog route editing;
- only `Auto + upstream-advertised` reasoning values;
- Auto-only disabled slider when no reasoning capability is advertised;
- New API save, key clearing, Hermes Custom Endpoint synchronization;
- per-model connectivity request;
- real run-event rendering, Worker task-id discovery/polling, transcript reload;
- completed timeline collapse and preserved final duration;
- OFFICIAL skips custom Session model lock/routing writes.

## 2. Pinned Hermes + Worker public contracts

`scripts/verify_upstreams.py` checks exact checkout SHA, version and semantics rather than trusting version labels.

### Hermes semantic gates

- Dashboard Plugin SDK globals, `fetchJSON`, `authedFetch`, registration;
- documented `tab.override`/plugin API contract;
- `/api/model/options`, `/v1/capabilities`, `/health/detailed`;
- native Runs create/status/events/stop/approval;
- upstream own Runs tests also contain steer semantics;
- official `/api/skills` surface;
- API-server unattended config/tests;
- release -> snapshot Git ancestry.

### Worker semantic gates

CI locks the README promises, not just endpoint strings:

- OFFICIAL true native-default mode and `:8788` failure isolation;
- active ChatGPT OAuth observed with `account/read` locks Worker/Codex Main Official;
- no OAuth required for third-party standalone Main;
- `WORKER` maps to `DELEGATE`;
- OFFICIAL/AUTO/DELEGATE/MAIN semantics;
- live capability registry from official App Server + New API;
- no guessed reasoning ladder;
- explicit third-party App Server provenance;
- no third-party-native-subagent masquerade;
- production/release/archive seal commands remain present.

## 3. Worker upstream tests + four-mode live control plane

This job uses the **real pinned Worker**, not a mock:

1. Worker full `npm test`;
2. Worker `npm run check`;
3. `seal:production` must fail with `NOT_SEALED` on Hosted CI lacking target evidence;
4. `seal:archive` must fail with `NOT_ARCHIVE_READY` for the same reason;
5. start real Worker HTTP server on loopback;
6. compare direct health/state/catalog to Studio proxy/native tool semantics;
7. cycle real mode through:

```text
OFFICIAL -> AUTO -> DELEGATE(WORKER) -> MAIN
```

For every mode, native `worker_catalog.studio_policy` must match real `/api/state`, and `delegation_allowed` must be true only for AUTO/DELEGATE. The original mode is restored in `finally`.

## 4. Hermes native Runs + approvals + skills + Plugin Doctor

CI installs the exact pinned Hermes checkout and runs Hermes' **own test files**:

```text
tests/gateway/test_api_server_runs.py
tests/tools/test_approval.py
tests/hermes_cli/test_web_server_skill_editor.py
```

This gives upstream-backed coverage for native run create/status/events/approval/steer/stop, approval security/unattended behavior, and Skills HTTP/editor contracts.

The same job then invokes Hermes' real Plugin Doctor against Studio. Dynamic registration must succeed and the exact tool set must be:

```text
worker_delegate
worker_status
worker_catalog
```

## 5. Production security static analysis

- Bandit scans production Python.
- `B310` is excluded only because every URL target is independently validated by loopback/http(s)/embedded-credential policy and covered by unit/integration tests.
- repository scan rejects common accidentally committed bearer/key patterns outside explicit examples/tests.

## Repository proof boundary

When all five jobs are green for the **exact commit**:

- Studio code/runtime/installer contracts are archive-candidate proven;
- pinned Hermes native contracts are upstream-test proven;
- pinned Worker project tests/check are proven;
- a real pinned Worker server has passed four-mode Studio integration;
- Hermes real Plugin Doctor has loaded the plugin;
- static security gates are green.

That still does **not** prove:

- private ChatGPT/Hermes OAuth/account state;
- a real provider API key and provider availability;
- real historical account scale;
- browser/cookie/session behavior on the intended deployment;
- unattended execution with the intended host's actual security/config state;
- service restart/recovery and upgrade/rollback on the target machine;
- Worker production/archive seal on the same real signed-in Linux machine;
- screenshots/video/sanitized target evidence.

Those items are intentionally reserved for `docs/SEAL_CHECKLIST.md`.

## Seal vocabulary

- **CI failed**: not an archive candidate.
- **CI green on PR**: candidate change is repository-valid but not merged.
- **CI green on exact `main` SHA**: `ARCHIVE CANDIDATE`.
- **Every target-host checklist item + retained evidence**: `SEALED`.

No automation or documentation may collapse these states into one claim.
