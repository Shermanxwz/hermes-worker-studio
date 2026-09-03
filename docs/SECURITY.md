# Security Boundary

## Trust model

Hermes is the sole execution/model/policy authority. Studio is an authenticated product layer and must never become a second security boundary with hidden authority.

## Credentials

- Browser code uses Hermes Dashboard SDK / plugin API only.
- `API_SERVER_KEY` stays server-side.
- Custom Endpoint API keys are submitted to Hermes official endpoint management and are not persisted in Studio/browser state.
- URL-embedded credentials are rejected.
- Upstream target defaults to loopback `127.0.0.1:8642`; remote use requires explicit opt-in and operator-provided secure transport.
- Seal browser TLS verification is on by default. Ignoring certificate errors requires the explicit `HWS_SEAL_IGNORE_HTTPS_ERRORS=1` test-environment override.

## Execution

Studio does not execute child work itself. `worker_delegate` uses `PluginContext.subagent_lifecycle`. Native Hermes `delegate_task` remains the official default path in OFFICIAL mode.

`MAIN` mode is enforced through Hermes `pre_tool_call`, so blocking occurs before the delegated tool executes. Unknown mode fails closed.

No private `AIAgent` constructors, private delegate helpers, direct process spawning or second Worker daemon are permitted in production code. The retained child-handle map is bounded convenience state, not an execution registry.

Product chat uses the official Hermes TUI Gateway WebSocket. `/v1/runs` is retained only as an official Hermes probe/CI/unattended surface; it is not a parallel Studio chat runtime.

## Approvals / unattended

Full Access changes only Hermes official configuration and verifies read-back. It enables the required approval/headless settings plus `delegation.subagent_auto_approve` so child work does not silently reintroduce an approval stop.

A real authenticated Hermes Run writes a random temporary marker; `UNATTENDED_READY` is returned only when the Run reaches successful terminal state and the marker is observed.

Hermes Hardline Blocklist remains permanent. Studio cannot and does not bypass it.

## Persistence/privacy

Studio does not read Hermes SQLite or private state files. Conversation/session data is obtained through official APIs. Browser Run projection, protocol-route state and lifecycle handle convenience state are bounded/disposable; authoritative execution/session/model truth remains Hermes.

Protocol-route and projection files use atomic replacement and restrictive file permissions. They contain routing/projection metadata, not provider credentials or hidden reasoning.

## Model and protocol integrity

Studio does not infer provider/model capabilities from model names. Reasoning controls are rendered only from explicit upstream metadata; absent effort metadata means `Auto`.

A pasted `/responses` URL is normalized to the API root but is not treated as protocol evidence. For mixed custom endpoints, an unresolved model is resolved only by explicit Hermes capability data or real Hermes Chat/Responses probe outcomes.

First-use protocol probing is fail-closed:

- exactly one successful transport may become the cached execution route;
- both-success remains ambiguous until explicit operator choice;
- both-failed remains failed;
- concurrent first use of one Provider/Model shares one probe lock;
- recent failures have a retry cooldown to avoid a billable/error retry storm;
- managed compatibility aliases are written only through Hermes `/api/config` and never expose credentials to the browser.

The source Provider/Model remains the user-facing identity. Managed aliases are compatibility mechanics, not a second model registry.

## Supported artifact / supply boundary

The supported installer stages a temporary product tree, stamps the exact candidate SHA, applies deterministic exact-count transforms, runs Hermes Plugin Doctor, then atomically swaps the install.

`stage_product_bundle.py` and `stage_mixed_protocol.py` are build transforms only. Security/architecture gates prohibit them from gaining network, socket, request-library or subprocess ownership. CI separately builds and syntax-checks the transformed JS/Python, and installer tests assert the exact installed file set.

The final CSS chain is local plugin static content only; no remote stylesheet/font/script dependency is introduced by product closure.

## UI evidence/privacy

The work timeline shows observable operational events only: tools, todo state, approvals, subagent lifecycle, timestamps and Skills deltas. Hidden chain-of-thought is not requested, stored or rendered.

Accessibility closure (focus state, dialog focus lifecycle, menu/disclosure semantics, touch discoverability, reduced motion) changes interaction semantics only and grants no additional authority.

## Archive enforcement

CI rejects:

- second-runtime production sentinels;
- private delegation imports;
- direct persistence imports;
- browser bearer-secret references;
- hard-coded reasoning ladders;
- model-name/URL protocol guessing as a routing contract;
- obvious committed credentials;
- release transforms gaining external/process capability;
- staged artifact syntax/closure drift;
- Bandit high-risk findings outside the documented URL-validation exception.

A target machine is not `SEALED` until the exact-current authenticated checklist in `SEAL_CHECKLIST.md` is completed and the required upstream exclusive-shell gate passes.
