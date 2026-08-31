# Security Model

Worker Studio intentionally inherits Hermes' authentication and safety model instead of creating a competing security subsystem.

## Trust assumptions

A user who can access an authenticated Hermes Dashboard can already inspect/manage powerful Hermes surfaces. Worker Studio does not try to sandbox that authenticated operator from Hermes itself.

The additional trust boundary is the local bridge to:

- Hermes API Server (`127.0.0.1:8642` by default), and
- codex-worker-delegation (`127.0.0.1:8788` by default).

## Secrets

The browser bundle never references or receives:

- `API_SERVER_KEY`
- `HERMES_WORKER_STUDIO_API_KEY`
- `CWD_WEB_TOKEN`
- `HERMES_WORKER_STUDIO_WORKER_TOKEN`

Those are read only by `dashboard/plugin_api.py` in the Hermes Dashboard process.

A New API key entered in the Worker Routing UI is intentionally submitted to two user-authorized products:

1. codex-worker-delegation, which owns Worker routing/provider state;
2. Hermes' official Custom Endpoint API, which owns the Hermes provider configuration.

The input field is cleared after a successful save. Worker Studio does not create a third secret store.

## Browser rendering

Conversation text, tool output, search snippets, Worker JSON and errors are rendered as React text/preformatted content. The bundle does not use `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or dynamic script injection for untrusted model/tool output.

This matters because tool output and model text are untrusted data even when the operator trusts the local agent.

## Loopback SSRF boundary

Unless `HERMES_WORKER_STUDIO_ALLOW_REMOTE=1`, upstream URLs must use a literal loopback hostname/address (`localhost`, `127.0.0.1`, `::1`). The bridge does not accept an arbitrary hostname merely because DNS currently resolves it to loopback.

Remote mode is deliberately explicit. If enabled, the operator is responsible for private networking/TLS and strong upstream credentials.

## Local Worker passwordless mode

`scripts/run-worker-local.sh` sets `CWD_REQUIRE_AUTH=0` only while forcing `CWD_HOST=127.0.0.1`. Do not copy that passwordless setting to a public bind.

For a network-reachable Worker, use codex-worker-delegation's own hardened deployment/authentication flow and set `HERMES_WORKER_STUDIO_WORKER_TOKEN` appropriately.

## Full access / unattended behavior

The requested operator mode is intentionally powerful:

- Worker default sandbox: `danger-full-access`.
- Local Worker: `CWD_ALLOW_DANGER_FULL_ACCESS=1`.
- Hermes `approvals.mode=off`.
- Headless approval modes: `approve`.

This is appropriate only for a machine/workspace the operator deliberately trusts for autonomous execution.

Worker Studio does **not** remove Hermes' hardline blocklist. That upstream always-on floor remains authoritative.

## Run bridge limits

The run bridge:

- is reachable only through the normal authenticated Dashboard plugin route;
- forwards runs only to the configured Hermes API Server;
- caps stored event count per run;
- caps a single stored event payload;
- expires old run records;
- never treats an incomplete SSE stream as completed.

Run records are process-memory state used only for live UI projection. The authoritative transcript remains Hermes' Session store.

## What to rotate after suspected compromise

Rotate at least:

1. `API_SERVER_KEY` / `HERMES_WORKER_STUDIO_API_KEY`;
2. Worker control token, if enabled;
3. New API key(s);
4. any credentials the autonomous Worker could read from the affected workspace/account.

Then restart the relevant services so old process-memory credentials and live run bridges are gone.
