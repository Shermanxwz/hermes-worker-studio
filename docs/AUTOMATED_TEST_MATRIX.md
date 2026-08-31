# Automated Test Matrix

This document separates **repository/hosted-runner proof** from **target-machine seal proof**. A green CI run is a release-candidate gate; it is intentionally not allowed to claim that a user's real Hermes installation, credentials, browser, New API, or filesystem is sealed.

## Pinned upstream baseline

`tests/upstream-lock.json` is the machine-readable compatibility baseline. The current archive candidate is tested against:

| Component | Pinned revision | Declared version |
|---|---|---|
| Hermes Agent | `NousResearch/hermes-agent@4f22543509d1b91dc45bcb369447126c5eb14fb7` | `0.20.6` |
| codex-worker-delegation | `Shermanxwz/codex-worker-delegation@e965517e5bddeda57f5bc2b015a817279ea8e6e5` | `3.2.0` |

The CI checkout uses the exact commit SHA, not a moving branch. `scripts/verify_upstreams.py` also rejects a checkout whose Git HEAD or declared version does not match the lock.

## CI jobs

### 1. Studio static + integration + UI runtime

This gate exercises the Studio itself at several layers:

- Python `compileall` over runtime, scripts, and tests.
- JavaScript syntax validation of the shipped dashboard IIFE and the runtime harness.
- Shell syntax validation of install/start scripts.
- `scripts/verify_contract.py` archive invariants:
  - official `/sessions` override remains in place;
  - recent/history limits remain 10 / 40 / 20 / 100;
  - FTS search and official archive filter remain used;
  - browser bundle cannot reference server bearer secrets;
  - reasoning effort ladder cannot be locally guessed/hard-coded;
  - Worker/API bridges remain loopback-first;
  - full-access Worker default remains explicit.
- Python unit/integration suite, including:
  - SSE framing, multi-line data and comments;
  - clean EOF -> `incomplete`, never fake success;
  - explicit upstream failure preservation;
  - poll cursors;
  - bounded event history and oversized event truncation;
  - run TTL cleanup;
  - concurrent event append sequencing;
  - snapshot isolation;
  - real loopback HTTP proxy behavior for fake Hermes and Worker servers;
  - bearer forwarding and browser/server secret boundary;
  - HTTP error translation, invalid JSON and response-size rejection;
  - native `worker_delegate` / `worker_status` / `worker_catalog` behavior;
  - requested unattended `danger-full-access` default;
  - install atomicity, staged validation, idempotent reinstall and failure rollback.
- `tests/frontend_runtime.mjs` renders the **actual shipped dashboard bundle** against a Hermes Plugin SDK-shaped runtime and verifies:
  - recent 10 and current 40 request limits;
  - full-history 20 and transcript 100 pagination;
  - official FTS search and archived-only filter;
  - primary Skills / Plugins / MCP navigation;
  - Worker routing/model catalog sharing;
  - `Auto + upstream-advertised` reasoning values only;
  - Auto-only disabled control when upstream advertises no reasoning efforts;
  - New API save, API-key clearing and official Hermes Custom Endpoint sync;
  - per-model connectivity request;
  - official unattended config write while preserving unrelated config;
  - real run-event rendering contract, Worker task-id polling, final transcript reload;
  - completed work auto-collapse, final elapsed time and manual re-expansion;
  - Hermes Session model lock without silently inventing a Worker routing write.
- Dashboard manifest JSON validation.
- npm high-severity vulnerability audit for the test harness dependencies.

### 2. Pinned Hermes + Worker public contracts

CI checks out both upstream repositories at the exact locked revisions and runs `scripts/verify_upstreams.py`.

The verifier checks the public surfaces Worker Studio depends on rather than importing private implementation details. It covers Hermes Dashboard Plugin SDK registration/fetch APIs, plugin backend routing, documented unattended/security keys, session/search/message/chat/model/custom-endpoint/capability routes, and Worker HTTP/model-capability/App-Server contracts.

If a future upstream revision changes one of these contracts, updating `tests/upstream-lock.json` alone is insufficient: the semantic verifier must also pass.

### 3. Worker upstream tests + live control plane

This gate does more than inspect source:

- Runs the pinned Worker repository's own complete Node test suite.
- Runs the Worker's own `check` gate.
- Runs Worker production/archive seal commands on a hosted runner and asserts they **fail closed** with `NOT_SEALED` / `NOT_ARCHIVE_READY` when target-machine evidence is absent. Hosted CI is not permitted to fake a seal.
- Boots the pinned real Worker HTTP control plane on `127.0.0.1:8788`.
- Reads its real health/state/catalog directly.
- Reads those same surfaces through Studio's dashboard backend and native `worker_catalog` tool.
- Compares stable model/routing/capability semantics while correctly excluding the Worker's intentionally regenerated `registry.generatedAt` observation timestamp.

### 4. Hermes real Plugin Doctor

CI installs the exact pinned Hermes checkout and invokes Hermes' real plugin-development doctor against this repository. The gate requires:

- Hermes accepts the plugin manifest/runtime shape.
- Dynamic registration completes successfully.
- The exact native tool set is `worker_delegate`, `worker_status`, `worker_catalog`.

This catches incompatibilities that a local schema imitation would miss.

### 5. Production security static analysis

- Bandit scans production Python. B310 is excluded only because all `urlopen` destinations go through the separately tested `_validate_upstream` / `_safe_url` policy (http(s), no embedded credentials, loopback by default).
- A repository scan rejects common accidentally committed token/key forms outside explicit examples/tests.

## What hosted CI intentionally cannot prove

The following evidence can only be obtained on the actual installation and therefore remains in `docs/SEAL_CHECKLIST.md`:

- the user's real Hermes account/OAuth/provider state;
- the user's real API Server key and file permissions;
- browser networking/authentication in the user's deployed Dashboard;
- real historical data sizes (100+ sessions / 1000+ message conversations);
- real New API credentials, actual model list and actual reasoning capability values;
- a real model completing a real Hermes tool call and Worker delegation;
- unattended behavior under the user's actual host security boundary;
- real service stop/restart, degraded-operation and recovery tests;
- upgrade/rollback on the intended long-term machine;
- screenshots/video and sanitized configuration/version evidence.

A commit may be called **archive candidate** when all hosted CI jobs are green. It may be called **sealed** only after every applicable target-machine item in `docs/SEAL_CHECKLIST.md` is complete and its evidence bundle is retained.
