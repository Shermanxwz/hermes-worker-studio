# Final Seal Checklist — Product 3

`SEAL_ACCEPTANCE.md` is the canonical release contract. This file is a diagnostic checklist for operators; it must not introduce extra unrecorded release gates.

## 1. Exact candidate

- [ ] `git status --porcelain --untracked-files=no` is empty.
- [ ] `git rev-parse HEAD` is the intended PR head.
- [ ] PR CI is green for that exact SHA.
- [ ] `tests/upstream-lock.json` contains only the pinned Hermes runtime upstream.
- [ ] pinned-upstream verification still proves Session resume, arbitrary attachment, no-wait input-response and Dashboard return-slot contracts.

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
- [ ] composer stays inside viewport and has no horizontal overflow;
- [ ] installed picker is arbitrary-file (`添加文件`) rather than image-only;
- [ ] browser capability surface reports `image.attach_bytes`, `pdf.attach`, `file.attach`;
- [ ] browser capability surface reports `session.resume(close_on_disconnect=false)`;
- [ ] browser capability surface includes official no-wait responders such as `clarify.respond` and `mcp.setup.respond`;
- [ ] Hermes 会话 / 技能 / 插件 / MCP / 自动化 are visible native destinations;
- [ ] Full Access explains automatic Skip/Decline and Hardline remains visible;
- [ ] mobile drawer/touch shell is usable;
- [ ] native `/sessions` exposes at least one `← Worker Studio` return path and returns to `/`;
- [ ] no failed, timed-out or interrupted Playwright result exists.

Mounted Node/JSDOM CI separately proves behavior-heavy flows: lazy session creation, Session CRUD, mixed image/PDF/file staging, returned `@file:` propagation, durable WebSocket reconnect/runtime rebinding, Stop/Steer/approval wiring, official plan rendering, Full Access no-wait input handling and enable/restore, Custom Endpoint CRUD and model probes.

## 5. Runtime closure

- [ ] browser WebSocket is transport only; durable Hermes Session is authoritative;
- [ ] `session.resume` uses `close_on_disconnect=false`;
- [ ] socket loss becomes `reconnecting`, never immediate `interrupted`;
- [ ] reconnect obtains a fresh authenticated WS URL and rebinds the live runtime;
- [ ] image → `image.attach_bytes`;
- [ ] PDF → `pdf.attach`;
- [ ] generic file → `file.attach` and returned `@file:` is passed to the prompt;
- [ ] picker / paste / drag-drop share the arbitrary-file path;
- [ ] Full Access approval/clarify/MCP/sudo/secret/terminal waits resolve through official Hermes response contracts;
- [ ] unavailable credentials/MFA may fail the task but must not leave Studio indefinitely parked waiting for its own UI.

## 6. Architecture/security invariants

- [ ] no second execution service is required;
- [ ] no private Hermes `AIAgent`/delegate implementation is imported;
- [ ] no direct Hermes SQLite/state access;
- [ ] browser bundle contains no API Server bearer secret;
- [ ] remote Hermes API bridge remains opt-in;
- [ ] Hermes Hardline Blocklist remains authoritative;
- [ ] model/reasoning capabilities are not guessed;
- [ ] installed favicon reuses official Hermes Web `/favicon.ico`;
- [ ] installer does not patch Hermes core files.

## 7. Four modes

- `OFFICIAL`: Studio-managed worker delegation sleeps; Hermes native defaults remain authoritative.
- `AUTO`: Main may use Hermes child agents through public lifecycle.
- `WORKER`: wire=`DELEGATE`; same Hermes runtime, orchestration-emphasized UX.
- `MAIN`: Hermes `pre_tool_call` blocks new `delegate_task` and `worker_delegate` launches.

Unknown mode must fail closed.

## 8. Final decision

Re-run the independent verifier if needed:

```bash
python scripts/verify_seal_evidence.py
```

Only when exact-head CI is green **and** `.seal/SEALED.json` says `eligible: true` for that same SHA may PR #4 be marked Ready / `SEALED` and merged.

If real-target evidence is unavailable, the correct status is **ARCHIVE CANDIDATE**, never SEALED.
