# Final Seal Checklist — Product 3

`SEAL_ACCEPTANCE.md` is the canonical release contract. This file is a diagnostic checklist for operators; it must not introduce extra unrecorded release gates.

## 1. Exact candidate

- [ ] `git status --porcelain --untracked-files=no` is empty.
- [ ] `git rev-parse HEAD` is the intended PR head.
- [ ] PR CI is green for that exact SHA.
- [ ] `tests/upstream-lock.json` contains only the pinned Hermes runtime upstream.

## 2. One-command target closure

On the real Hermes target run:

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

If protected, export `API_SERVER_KEY`. Optional `--provider` / `--model` can pin the real model route.

The command must exit 0 and produce:

- `.seal/target.json`
- `.seal/ui-report.json`
- `.seal/playwright-artifacts/`
- `.seal/SEALED.json`

`SEALED.json` must contain the exact current `candidate_sha` and `eligible: true`.

## 3. What target.json proves

- [ ] running Product 3 `/product-capabilities` reports the exact installed candidate SHA;
- [ ] execution plane is Hermes `official_runs`;
- [ ] Worker plane is `PluginContext.subagent_lifecycle`;
- [ ] model catalog is Hermes `/api/model/options`;
- [ ] temporary Session create → rename → archive → unarchive → delete completes;
- [ ] real Hermes model Run reaches `completed`;
- [ ] final marker is verified;
- [ ] Hermes canonical todo has at least 3 monotonic persisted revisions;
- [ ] an `in_progress` state occurred;
- [ ] final todo has at least 3 items and all are `completed`;
- [ ] Studio Run projection contains real `todo.updated` or `todo.snapshot` evidence.

## 4. What ui-report.json proves

- [ ] desktop Chromium Product 3 shell passes;
- [ ] Pixel 7 mobile-emulation Product 3 shell passes;
- [ ] composer stays inside viewport;
- [ ] no horizontal overflow;
- [ ] mobile drawer/touch shell is usable;
- [ ] native `/sessions` exposes `← Worker Studio` and returns to `/`;
- [ ] no failed, timed-out or interrupted Playwright result exists.

Mounted JSDOM CI separately proves behavior-heavy flows: lazy session creation, Session CRUD, image paste/multimodal transport, Stop/Steer/approval wiring, official plan rendering, Full Access enable/restore and real-probe wiring, Custom Endpoint CRUD and model probes.

## 5. Architecture/security invariants

- [ ] no second execution service is required;
- [ ] no private Hermes `AIAgent`/delegate implementation is imported;
- [ ] no direct Hermes SQLite/state access;
- [ ] browser bundle contains no API Server bearer secret;
- [ ] remote Hermes API bridge remains opt-in;
- [ ] Hermes Hardline Blocklist remains authoritative;
- [ ] model/reasoning capabilities are not guessed;
- [ ] installed favicon reuses official Hermes Web `/favicon.ico`;
- [ ] installer does not patch Hermes core files.

## 6. Four modes

- `OFFICIAL`: Studio-managed worker delegation sleeps; Hermes native defaults remain authoritative.
- `AUTO`: Main may use Hermes child agents through public lifecycle.
- `WORKER`: wire=`DELEGATE`; same Hermes runtime, orchestration-emphasized UX.
- `MAIN`: Hermes `pre_tool_call` blocks new `delegate_task` and `worker_delegate` launches.

Unknown mode must fail closed.

## 7. Final decision

Re-run the independent verifier if needed:

```bash
python scripts/verify_seal_evidence.py
```

Only when exact-head CI is green **and** `.seal/SEALED.json` says `eligible: true` for that same SHA may PR #4 be marked Ready / `SEALED` and merged.

If real-target evidence is unavailable, the correct status is **ARCHIVE CANDIDATE**, never SEALED.
