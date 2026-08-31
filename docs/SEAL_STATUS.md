# Seal Status

Status: **ARCHIVE CANDIDATE**

Target: Hermes Worker Studio 2.0 — Hermes-native single-runtime archive baseline.

## Repository acceptance

- Pinned Hermes snapshot: `9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea` (`0.20.6`).
- PR: `#3` — `feat: seal Hermes-native Worker Studio 2.0`.
- Accepted PR head: `e943bd64285621858fc3cf14a661201ecf635662`.
- Final PR CI: Actions run `33406016546` — all four archive jobs passed.
- Merge commit: `48030e09bb45d8180780897bcc8c07fda2555a23`.
- Post-merge `main` CI: Actions run `33406204161` — all four archive jobs passed.
- Pinned Hermes regression seam: **179 passed** across public subagent lifecycle, Runs and approval suites.
- Hermes Plugin Doctor: runtime discovery/import/registration passed; **3 tools + 1 hook** registered.
- Production security gate: Bandit, secret rejection and second-runtime residue rejection passed.
- Studio gate: Python/JS/Shell syntax, archive contract, unit/HTTP/installer tests, jsdom product flow, manifest and high-severity npm audit passed.

Repository-level engineering acceptance is therefore complete and this revision family qualifies as an **ARCHIVE CANDIDATE**.

## Target-machine evidence — 2026-09-01

Host: `xwz-MS-7D90` (Linux, Asia/Shanghai). Operator: Codex, using the local
root-owned Hermes installation. Functional Studio source commit at this
capture: `a63cf83154ce2e627b76d6d7504946e1fc38f685`.

### Baseline and installation

- `main` was pinned from `2f9d62f343735f9546acb3da87855d72cfd3b176`; the
  Hermes-event/approval compatibility fixes were committed as `a63cf83`.
- Hermes is `/usr/local/lib/hermes-agent`, version `0.20.6`, exact commit
  `9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea`.
- `verify_upstreams.py --hermes-root /usr/local/lib/hermes-agent` and
  `verify_contract.py` both passed.
- `bash scripts/install.sh` passed; staged and installed-tree Plugin Doctor
  both passed; the official plugin is enabled with exactly 3 tools and 1 hook:
  `worker_delegate`, `worker_status`, and `worker_catalog`.
- `hermes-gateway.service` and `hermes-dashboard.service` are active on
  `127.0.0.1:8642` and `127.0.0.1:9119`. No Studio sidecar or `:8788` listener
  exists.

### Host paths exercised

- `/health`, `/health/detailed`, `/v1/capabilities`, `/api/status`, plugin
  health/integration, Skills, Plugins, MCP, model options, Sessions, History,
  Search, Archive/Unarchive, and model lock all returned successfully.
- Recent sessions returned at most 10; full session pages and 100-message
  transcript pages were exercised. A known historical phrase was found by FTS.
  The 33 acceptance-only sessions were then deleted by their exact IDs, leaving
  the user history clean.
- Real Studio Runs used official `POST /v1/runs` plus Hermes SSE. A successful
  end-to-end response, direct SSE response, elapsed-time terminal state,
  lifecycle projection, stop, steer, and approval response were observed.
  The approval test transitioned `running → waiting_for_approval → running →
  completed` through `/v1/runs/{id}/approval`.
- Live mode evidence: OFFICIAL blocked `worker_delegate` while native
  `delegate_task` completed a real child; AUTO launched a real
  `SubagentHandle` and `worker_status` reached a terminal result; WORKER
  launched a real child; MAIN blocked both worker and native delegation before
  child launch; an unknown mode also failed closed as MAIN.
- The official CLI `/review` path was exercised with a configured
  `auxiliary.review` route; its dispatch line named the configured reviewer
  model and the temporary child marker was observed. Worker and Review writes
  changed only `delegation.*` and `auxiliary.review.*`, respectively.
- A disposable native Skill was created through `/api/skills`, appeared in the
  native Skills list/content API, and was removed through Hermes' validated
  skill-management path. Plugins and MCP remained native surfaces; no Studio
  management database was created.
- Unattended settings were written and read back exactly as required; the real
  marker returned `UNATTENDED_READY` with `marker_verified=true`, and no marker
  file remained. A safe Hardline Blocklist case was rejected before shell
  execution. The temporary unattended policy was restored to the prior
  `smart`/`deny` safety configuration after the test.
- An invalid model returned a clear Hermes failure (`HTTP 401: ... is not
  supported`). An invalid custom endpoint failed validation without affecting
  Hermes health. A local disposable OpenAI-compatible endpoint was saved,
  discovered, read back without an API key, and removed.
- Gateway and Dashboard restarts preserved authoritative session/history data.
  During an active disposable Run, Dashboard restart did not invent a success:
  the upstream Run remained authoritative and was stopped through the official
  API. Stopping the Gateway made both local services unavailable; starting them
  restored health. Staged-doctor failure preserved a sentinel previous install.
  A reversible swap to the preserved prior Hermes tree started successfully,
  then the exact pinned tree was restored and rechecked.
- Browser HTML did not contain `API_SERVER_KEY` or its value; `.env` is mode
  `600`; `HERMES_WORKER_STUDIO_ALLOW_REMOTE=0`; only Hermes Gateway and
  Dashboard listen for this deployment. Static contract, unit, frontend,
  syntax, and secret/second-runtime checks passed.

### New API and transport evidence

The operator's New API credential is now present in Hermes' official custom
provider configuration. The authenticated configuration read-back reported:

- provider: `worker-studio-new-api`;
- base URL: `https://api.230385.xyz/v1`;
- credential present: yes (the key was never displayed, logged, or copied);
- model discovery: 13 models; and
- current global model: unchanged OpenRouter/Anthropic selection (the test did
  not silently replace the user's default).

The base URL is correctly a versioned API root. Hermes' OpenAI-compatible
client appends the transport path: `/v1/chat/completions` for Chat Completions
and `/v1/responses` for Codex Responses. There is no missing `/v1` rewrite in
Studio.

Authenticated model-probe Runs through the official Hermes `/v1/runs` path
completed for 7 of the 13 discovered models: `MiniMax-M3`, both `cc-deepseek`
models, `cc-laguna-s-2.1-free`, `cc-mimo-v2.5`, and both `deepseek-v4` models.
The three `gpt-5.6-*` models returned Hermes' Chat Completions unsupported
error. Direct, credentialed SSE requests to New API `/v1/responses` for those
three models returned HTTP 200 and terminal `response.completed` events. The
embedding model is not a dialogue model, and `qwen3:4b-instruct` rejected
Hermes' thinking parameter; those are model compatibility results, not
credential failures.

The remaining host blocker is precise: Hermes `0.20.6` resolves a generic named
custom provider without an explicit provider-level `api_mode` to
`chat_completions`, and does not dynamically select `codex_responses` per
model. A single custom provider therefore cannot transparently route this
mixed New API inventory. Adding `api_mode: codex_responses` globally would
break the verified Chat Completions models. The pinned Hermes source also
intentionally does not apply a generic custom-endpoint GPT-name heuristic.

Reproduce the configuration and transport evidence through an authenticated
Dashboard session (the session token and API key must remain private):

```text
GET  http://127.0.0.1:9119/api/providers/custom-endpoints
GET  http://127.0.0.1:9119/api/model/options?refresh=1
POST http://127.0.0.1:9119/api/plugins/hermes-worker-studio/hermes/model-probe
     {"provider":"worker-studio-new-api","model":"gpt-5.6-sol"}
```

The last request currently demonstrates the blocker as Hermes attempts
`/v1/chat/completions`; a direct authenticated New API request to
`https://api.230385.xyz/v1/responses` with the same GPT model and streaming
enabled demonstrates that the provider's Responses surface is available.

The pinned environment also has no local Bandit executable; the repository's
previous CI security gate passed, while the post-change local static gates and
contract checks passed. Because the mixed-provider transport remains
unresolved, the host acceptance is recorded as **NOT YET SEALED**.

## Target-machine seal

Status: **NOT YET SEALED**.

`SEALED` additionally requires the authenticated host evidence in `SEAL_CHECKLIST.md`: real target-machine installation/Plugin Doctor, live Hermes API readiness, real New API credentials/model probes, four-mode live child behavior, unattended config read-back + marker Run, restart/failure injection and security sweep. It also requires a supported configuration or upstream fix for the mixed New API Chat Completions/Responses routing described above, followed by successful end-to-end probes for every intended dialogue model and final CI.

The repository must never label itself `SEALED` solely because GitHub CI is green.
