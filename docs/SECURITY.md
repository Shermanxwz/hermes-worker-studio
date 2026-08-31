# Security Boundary

## Trust model

Hermes is the sole execution/model/policy authority. Studio is an authenticated product layer and must never become a second security boundary with hidden authority.

## Credentials

- Browser code uses Hermes Dashboard SDK / plugin API only.
- `API_SERVER_KEY` stays server-side.
- Custom Endpoint API keys are submitted to Hermes official endpoint management and are not persisted in Studio/browser state.
- URL-embedded credentials are rejected.
- Upstream target defaults to loopback `127.0.0.1:8642`; remote use requires explicit opt-in and operator-provided secure transport.

## Execution

Studio does not execute child work itself. `worker_delegate` uses `PluginContext.subagent_lifecycle`. Native Hermes `delegate_task` remains the official default path in OFFICIAL mode.

`MAIN` mode is enforced through Hermes `pre_tool_call`, so blocking occurs before the delegated tool executes. Unknown mode fails closed.

No private `AIAgent` constructors, private delegate helpers, direct process spawning or second Worker daemon are permitted in production code.

## Approvals / unattended

Unattended mode changes only Hermes official configuration and verifies read-back. It also enables `delegation.subagent_auto_approve` so child work does not silently reintroduce an approval stop.

A real authenticated Hermes Run writes a random temporary marker; `UNATTENDED_READY` is returned only when the Run reaches successful terminal state and the marker is observed.

Hermes Hardline Blocklist remains permanent. Studio cannot and does not bypass it.

## Persistence/privacy

Studio does not read Hermes SQLite or private state files. Conversation/session data is obtained through official APIs. The in-memory Run event projection and lifecycle handle convenience map are bounded and disposable; authoritative state remains Hermes.

## Model integrity

Studio does not infer provider/model capabilities from model names. Reasoning controls are rendered only from explicit upstream metadata; absent effort metadata means `Auto`.

New API connectivity probes use real Hermes Runs, preventing a shallow `/models` response from being mistaken for end-to-end model usability.

## UI evidence

The work timeline shows observable operational events only: tools, todo state, approvals, subagent lifecycle, timestamps and Skills deltas. Hidden chain-of-thought is not requested, stored or rendered.

## Archive enforcement

CI rejects:

- second-runtime production sentinels;
- private delegation imports;
- direct persistence imports;
- browser bearer-secret references;
- hard-coded reasoning ladders;
- obvious committed credentials;
- Bandit high-risk findings outside the documented URL-validation exception.

A target machine is not SEALED until the authenticated checklist in `SEAL_CHECKLIST.md` is completed.