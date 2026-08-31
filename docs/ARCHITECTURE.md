# Architecture — Hermes Worker Studio 2.0

## 1. Architectural invariant

Studio is a **thin product layer over public Hermes contracts**. Hermes owns execution, child-agent lifecycle, model/provider resolution, persistence, approvals, Skills, Plugins and MCP. Studio owns navigation, product workflow, bounded UI projection and archive gates.

Forbidden architecture:

- private Hermes `AIAgent` construction/imports;
- direct Hermes SQLite/state access;
- independent Worker daemon or second agent runtime;
- second provider/model registry;
- guessed model capability or reasoning ladders;
- browser exposure of API Server bearer credentials.

## 2. Runtime data flow

```text
Hermes Dashboard
  └─ Dashboard Plugin SDK
      └─ Hermes Worker Studio
          ├─ Sessions/history/search/archive -> Hermes /api/sessions/*
          ├─ Models/New API -> Hermes model/options + custom-endpoints
          ├─ Config/unattended -> Hermes /api/config
          └─ Conversation execution -> Hermes /v1/runs
                                      ├─ status
                                      ├─ events SSE
                                      ├─ stop
                                      ├─ approval
                                      └─ steer

Hermes Main Agent
  ├─ native delegate_task
  ├─ worker_delegate -> PluginContext.subagent_lifecycle
  ├─ /review -> auxiliary.review.*
  └─ durable project work -> Hermes Kanban + Profiles
```

There is no execution hop outside Hermes.

## 3. Worker tools

`__init__.py` receives Hermes `PluginContext`, binds it to `tools.py`, registers:

- `worker_delegate`
- `worker_status`
- `worker_catalog`

`worker_delegate` constructs public `SubagentLaunchRequest` and calls `ctx.subagent_lifecycle.launch()`. Handles are Hermes `SubagentHandle` objects. Studio keeps only a bounded convenience map for status lookup; Hermes remains authoritative.

`worker_status` uses public lifecycle status/wait/result calls. No child transcript/database is copied into Studio.

`worker_catalog` reports policy and points clients to Hermes `/api/model/options`; it deliberately does not expose a parallel model registry.

## 4. Four-mode policy

- `OFFICIAL`: Studio-managed `worker_delegate` is blocked; native Hermes `delegate_task` remains untouched.
- `AUTO`: Studio worker delegation is allowed.
- `WORKER` (`DELEGATE` internally): Studio worker delegation is allowed and product UX emphasizes orchestration.
- `MAIN`: Hermes `pre_tool_call` policy hook blocks both `worker_delegate` and native `delegate_task` before execution.

Unknown configuration fails closed to `MAIN` semantics.

## 5. Models and New API

Canonical inventory is Hermes `/api/model/options`. Custom endpoint credentials and discovery use Hermes `/api/providers/custom-endpoints`.

Main, Worker and Reviewer do not maintain independent model lists:

- Main: Session model lock / Run request provider+model.
- Worker: Hermes `delegation.provider`, `delegation.model`, `delegation.reasoning_effort` where supported.
- Review: Hermes `auxiliary.review.provider`, `auxiliary.review.model`.

Per-model connectivity is a minimal real Hermes Run using the chosen provider/model. This validates the full provider-resolution and generation path.

Reasoning UI consumes only explicit upstream metadata. Missing exact effort metadata => `Auto` only.

## 6. Conversation and history

Daily chat surface is intentionally bounded:

- recent rail: 10 sessions;
- current transcript: latest 40 messages.

Full history uses server pagination:

- sessions: 20/page;
- messages: 100/page.

FTS search and archive filters stay server-side through Hermes APIs.

## 7. Work timeline

Studio projects observable Hermes events only. It does not expose hidden chain-of-thought.

Supported display categories include Run lifecycle, tool lifecycle, `todo.updated`, approval, subagent lifecycle, and post-Run Skills delta. Start/end timestamps produce elapsed duration. Terminal Runs auto-collapse; users can reopen the evidence trail.

Run status is authoritative. Studio's event ring is bounded and disposable.

## 8. Native pages and navigation

High-frequency first level: Chat, Worker, Models, Unattended, Skills, Plugins, MCP, Full History.

Lower-frequency native administration remains under More: Cron/Automation, Profiles, Analytics, Logs, Config, Docs.

Studio links to/reuses Hermes native surfaces rather than copying their management implementation.

## 9. Security boundary

Backend API Server target defaults to `127.0.0.1:8642`; remote targets require explicit opt-in. Embedded URL credentials are rejected. Browser code does not receive upstream bearer tokens.

Unattended configuration uses Hermes official approval settings and `delegation.subagent_auto_approve`; Hermes Hardline Blocklist remains authoritative and cannot be bypassed.

## 10. Archive boundary

`tests/upstream-lock.json` contains exactly one runtime upstream: Hermes. `scripts/verify_contract.py` rejects reintroduction of a second execution runtime, private delegation internals, guessed reasoning ladders or duplicate navigation/model surfaces.
