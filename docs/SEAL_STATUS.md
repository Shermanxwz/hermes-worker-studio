# Seal Status

Status: **ARCHIVE CANDIDATE**

Product: **Hermes Worker Studio 3.0** — Hermes-native single-runtime product shell.

This file intentionally does **not** hard-code a current PR number or claim that an older target capture seals a newer commit. The exact seal candidate is always the clean SHA supplied to the real-target workflow / `seal_close.py`, and `.seal/SEALED.json` must name that same SHA.

## Current repository engineering state

The repository has reached code-level archive-candidate closure around these invariants:

- Hermes is the only runtime upstream, pinned in `tests/upstream-lock.json`;
- product chat uses the official Hermes TUI Gateway WebSocket (`session.resume`, `prompt.submit`, Gateway context/todo/tool/subagent events);
- official `/v1/runs` remains the probe/CI/unattended rail, not a second product chat runtime;
- Worker uses `PluginContext.subagent_lifecycle`; native `delegate_task` remains Hermes-owned;
- Main / Worker / Verifier / MOA share Hermes model inventory and the same per-model execution-route resolver;
- mixed custom endpoints can contain Chat Completions and Responses-only models without a provider-global guess;
- first unresolved model use performs real Hermes Chat/Responses probes, caches exactly verified routing, deduplicates concurrent first-use probes, and fails closed on ambiguous/both-failed outcomes;
- reasoning effort is emitted only from explicit upstream capability metadata;
- session/history/search/archive, config, Custom Endpoints, MOA, Skills/Plugins/MCP ownership all remain on official Hermes surfaces;
- there is no second model registry, planner, tokenizer, worker daemon, queue or persistence database;
- candidate installation is atomic and candidate-SHA stamped;
- deterministic release transforms are exact-count/fail-closed and are independently built/syntax-checked in CI;
- the final UI stylesheet is `product-closure.css`, layered over sealed/base CSS without changing the product visual language;
- desktop, phone portrait and compact landscape real-target UI projects cover every existing first-level Studio page for viewport/overflow regressions;
- keyboard focus, dialog Escape/focus lifecycle, disclosure/menu state, touch-only action discoverability and reduced-motion behavior are part of the product closure contract;
- production security gates reject bearer-secret leaks and second-runtime residue.

Repository CI can prove these code and integration contracts, but **CI success alone never changes this status to SEALED**.

## Historical target evidence — 2026-09-01

A real Hermes target was previously exercised on host `xwz-MS-7D90` against Hermes `0.20.6` at exact upstream commit:

`9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea`

The functional Studio source at that historical capture was:

`a63cf83154ce2e627b76d6d7504946e1fc38f685`

That capture established useful environmental facts, including:

- staged/installed Plugin Doctor success with exactly 3 Studio tools + 1 hook;
- no Studio sidecar / no `:8788` runtime;
- official Sessions, history/search/archive, model locks, Runs controls, approvals, Skills/Plugins/MCP and unattended configuration paths worked on the target;
- OFFICIAL/AUTO/WORKER/MAIN delegation semantics were exercised against real Hermes children;
- browser HTML did not expose the API Server bearer credential;
- New API custom endpoint discovery returned **13 models** from a `/v1` API root;
- ordinary dialogue models were verified through Chat Completions;
- three `gpt-5.6-*` models failed Hermes Chat Completions but direct credentialed New API `/v1/responses` calls returned HTTP 200 and terminal `response.completed`;
- this proved the pinned Hermes limitation: generic custom-provider transport is provider-global and cannot safely be switched to Responses for the whole mixed provider.

Those observations motivated the current per-model compatibility bridge. They are **historical evidence only**. They do not prove that the current exact Studio candidate, current installer artifact or current UI closure has run on that machine.

## Current mixed-protocol behavior

The Product 3 compatibility bridge does not infer protocol from `gpt-*`, another model name, or a pasted `/responses` URL.

For one source Provider/Model:

1. Hermes model/provider protocol metadata is authoritative when present;
2. a previously verified route is reused;
3. otherwise first real use invokes the official Hermes Chat/Responses probe path;
4. exactly one successful transport becomes a narrow managed alias written through `/api/config`;
5. both-success => ambiguous / explicit operator choice;
6. both-failed => fail closed with real results;
7. the source Provider/Model remains what the UI displays.

The Models **官方探测** action remains available for diagnostics and active retry; it is not required before normal first use. Probe work is never triggered merely by rendering the model catalog.

## What remains before SEALED

`SEALED` requires **fresh evidence for the exact current candidate**, not reuse of the 2026-09-01 capture:

- clean exact candidate SHA;
- exact-SHA repository CI green;
- deterministic candidate install and loaded SHA read-back;
- current real Hermes target health + Plugin Doctor;
- current product Gateway/session/context/todo evidence;
- current mixed-provider New API evidence for intended dialogue models, including automatic Responses routing where required;
- current Worker/Verifier/MOA route evidence where those paths use mixed-provider models;
- Full Access read-back/marker and failure-injection/security evidence;
- Playwright desktop + phone portrait + compact landscape closure on every first-level Studio page;
- native `/sessions` return-path evidence;
- independent `.seal` evidence verification;
- the required upstream route-scoped exclusive-shell contract (`NousResearch/hermes-agent#100149`, or an equivalent documented replacement in the pinned Hermes revision) must pass the upstream gate.

The canonical command is:

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

Only when `scripts/verify_seal_evidence.py` accepts the generated evidence and `.seal/SEALED.json` reports `eligible=true` for the **same exact candidate SHA** may this project be called `SEALED`.
