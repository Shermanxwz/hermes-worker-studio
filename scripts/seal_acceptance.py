#!/usr/bin/env python3
"""Real-target seal acceptance for Hermes Worker Studio Product 3.

This script talks only to the running Hermes Dashboard / public Studio plugin
HTTP surface. The default pass is deliberately low-risk: it verifies health,
public integration ownership, Product 3 capabilities, model catalog access,
and a complete ephemeral session CRUD lifecycle.

Optional real model execution is enabled with ``--run``. The real-run gate is
intentionally stronger than a plain echo: it requires Hermes' own ``todo`` tool
to evolve a three-step canonical plan through multiple revisions, requires the
Studio Run projection to surface a real todo event, verifies the actual resolved
execution route, and verifies a final marker. When ``--reasoning-effort`` is
supplied, the route must explicitly publish that vocabulary through Hermes model
metadata or the official provider config overlay, and the concrete effort is
sent through Hermes ``/v1/runs.model_options.reasoning_effort``. Nothing changes
approval policy; the harness never enables Full Access on its own.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TERMINAL = {"completed", "failed", "cancelled", "canceled", "stopped", "incomplete", "interrupted"}
PLUGIN = "/api/plugins/hermes-worker-studio"
TARGET_EVIDENCE_SCHEMA = "hermes-worker-studio.seal-evidence.v2"
_EXECUTABLE_ROUTE_STATES = {"native", "declared", "resolved", "manual"}
_REASONING_LIST_KEYS = (
    "reasoning_efforts",
    "reasoningEfforts",
    "supported_reasoning_efforts",
    "supportedReasoningEfforts",
)


class AcceptanceError(RuntimeError):
    pass


@dataclass
class Client:
    base_url: str
    api_key: str = ""
    timeout: float = 30.0

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Any | None = None,
        expected: tuple[int, ...] = (200,),
    ) -> tuple[int, Any]:
        url = self.base_url.rstrip("/") + (path if path.startswith("/") else "/" + path)
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json", "User-Agent": "hermes-worker-studio-seal/3.0"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read(8 * 1024 * 1024)
                payload = json.loads(raw.decode("utf-8")) if raw else {}
                status = int(response.status)
        except urllib.error.HTTPError as exc:
            raw = exc.read(2 * 1024 * 1024)
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                payload = {"raw": raw.decode("utf-8", "replace")}
            status = int(exc.code)
        except Exception as exc:
            raise AcceptanceError(f"{method} {url} failed: {exc}") from exc
        if status not in expected:
            raise AcceptanceError(f"{method} {path}: expected HTTP {expected}, got {status}: {payload}")
        return status, payload


def require(condition: Any, message: str) -> None:
    if not condition:
        raise AcceptanceError(message)


def _jsonish(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _textish(value: Any, depth: int = 0) -> str:
    if isinstance(value, str):
        return value
    if value is None or depth > 3:
        return ""
    if isinstance(value, list):
        return "".join(_textish(item, depth + 1) for item in value)
    if isinstance(value, dict):
        for key in ("text", "output_text", "content", "message"):
            text = _textish(value.get(key), depth + 1)
            if text:
                return text
    return ""


def parse_todo_message(message: Any) -> dict[str, Any] | None:
    """Return one persisted canonical Hermes todo result, if this row is one."""
    if not isinstance(message, dict) or str(message.get("role") or "") != "tool":
        return None
    name = str(message.get("tool_name") or message.get("name") or "")
    if name != "todo":
        return None
    raw = message.get("content") if message.get("content") not in (None, "") else message.get("text")
    payload = _jsonish(raw)
    if not isinstance(payload, dict) or not isinstance(payload.get("todos"), list):
        return None
    try:
        revision = max(0, int(payload.get("revision") or 0))
    except (TypeError, ValueError):
        revision = 0
    return {"revision": revision, "todos": payload["todos"], "timestamp": message.get("timestamp")}


def canonical_todo_history(messages: Any) -> list[dict[str, Any]]:
    """Deduplicate persisted todo snapshots by revision and return oldest->newest."""
    if not isinstance(messages, list):
        return []
    by_revision: dict[int, dict[str, Any]] = {}
    for message in messages:
        snapshot = parse_todo_message(message)
        if snapshot is not None:
            by_revision[int(snapshot["revision"])] = snapshot
    return [by_revision[key] for key in sorted(by_revision)]


def projected_todo_events(run: Any) -> list[dict[str, Any]]:
    """Return Studio-visible todo events from one Run snapshot."""
    if not isinstance(run, dict) or not isinstance(run.get("events"), list):
        return []
    rows: list[dict[str, Any]] = []
    for event in run["events"]:
        if not isinstance(event, dict):
            continue
        name = str(event.get("event") or "")
        if "todo" not in name.lower():
            continue
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        rows.append(
            {
                "event": name,
                "revision": data.get("revision"),
                "source": data.get("source"),
                "todos": data.get("todos") if isinstance(data.get("todos"), list) else [],
            }
        )
    return rows


def pick_route(model_options: dict[str, Any], provider: str, model: str) -> tuple[str, str]:
    rows = model_options.get("providers") if isinstance(model_options, dict) else []
    rows = rows if isinstance(rows, list) else []
    if provider and model:
        return provider, model
    explicit_moa = provider.strip().lower() == "moa"
    wanted_provider = provider or str(model_options.get("provider") or "")
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug = str(row.get("slug") or "")
        if slug == "moa" and not explicit_moa:
            continue
        models = row.get("models") if isinstance(row.get("models"), list) else []
        if wanted_provider and slug != wanted_provider and wanted_provider not in (row.get("aliases") or []):
            continue
        chosen = model or (str(model_options.get("model") or "") if str(model_options.get("model") or "") in models else "")
        if not chosen and models:
            chosen = str(models[0])
        if slug and chosen:
            return slug, chosen
    for row in rows:
        if not isinstance(row, dict) or row.get("authenticated") is False:
            continue
        slug = str(row.get("slug") or "")
        if not slug or slug == "moa":
            continue
        models = row.get("models") if isinstance(row.get("models"), list) else []
        if models:
            return slug, str(models[0])
    raise AcceptanceError("No usable non-MOA provider/model found in Hermes /api/model/options")


def _effort_values(meta: Any) -> tuple[bool, list[str]]:
    if not isinstance(meta, dict):
        return False, []
    rich = meta.get("reasoning") if isinstance(meta.get("reasoning"), dict) else {}
    lists: list[Any] = [
        rich.get("options"),
        rich.get("efforts"),
        rich.get("supported_efforts"),
        rich.get("supportedEfforts"),
    ]
    lists.extend(meta.get(key) for key in _REASONING_LIST_KEYS)
    present = any(isinstance(items, list) for items in lists)
    values: list[str] = []
    for items in lists:
        if not isinstance(items, list):
            continue
        for item in items:
            value = str(item if isinstance(item, str) else (item.get("value") if isinstance(item, dict) else "") or "").strip()
            if value and value.lower() != "auto" and value not in values:
                values.append(value)
    return present, values


def _reasoning_disabled(meta: Any) -> bool | None:
    if not isinstance(meta, dict):
        return None
    rich = meta.get("reasoning") if isinstance(meta.get("reasoning"), dict) else {}
    supported = rich.get("supported") if "supported" in rich else meta.get("supports_reasoning")
    if meta.get("reasoning") is False or supported is False:
        return True
    return False if meta.get("reasoning") is True or supported is True else None


def _can_disable_reasoning(meta: Any, values: list[str]) -> bool | None:
    if not isinstance(meta, dict):
        return None
    rich = meta.get("reasoning") if isinstance(meta.get("reasoning"), dict) else {}
    value = rich.get("can_disable")
    if value is None:
        value = rich.get("canDisable")
    if value is None:
        value = meta.get("can_disable_reasoning")
    if value is None:
        value = meta.get("canDisableReasoning")
    if value is True or value is False:
        return value
    if any(item.lower() == "none" for item in values):
        return True
    control = str(rich.get("control") or meta.get("reasoning_control") or "").strip().lower()
    if control in {"toggle", "toggle_effort"}:
        return True
    if control == "fixed":
        return False
    return None


def _option_provider(model_options: dict[str, Any], provider: str) -> dict[str, Any] | None:
    wanted = provider.strip().lower()
    for row in model_options.get("providers") or []:
        if not isinstance(row, dict):
            continue
        aliases = [row.get("slug"), row.get("name"), *(row.get("aliases") or [])]
        if wanted in {str(item or "").strip().lower() for item in aliases}:
            return row
    return None


def _config_provider(config: dict[str, Any], provider: str) -> dict[str, Any] | None:
    providers = config.get("providers") if isinstance(config, dict) else None
    if not isinstance(providers, dict):
        return None
    wanted = provider.strip().lower()
    for key, row in providers.items():
        if not isinstance(row, dict):
            continue
        aliases = [key, row.get("slug"), row.get("name"), *(row.get("aliases") or [])]
        if wanted in {str(item or "").strip().lower() for item in aliases}:
            return row
    return None


def validate_reasoning_declaration(
    *,
    model_options: dict[str, Any],
    config: dict[str, Any],
    provider: str,
    model: str,
    effort: str,
) -> dict[str, Any]:
    """Require an explicit effort vocabulary before a real-target reasoning run.

    This mirrors the product's fail-closed source precedence but intentionally
    stays narrower than the browser renderer: a seal for a concrete *effort*
    must find that exact token in an explicit vocabulary. A boolean
    ``reasoning: true`` is never sufficient.
    """
    requested = effort.strip()
    require(requested and requested.lower() != "auto", "real-target reasoning seal requires a concrete non-Auto effort")
    provider_row = _option_provider(model_options, provider)
    require(provider_row is not None, f"provider {provider!r} is absent from Hermes model options")
    caps = provider_row.get("capabilities") if isinstance(provider_row.get("capabilities"), dict) else {}
    native = caps.get(model) if isinstance(caps.get(model), dict) else {}
    if _reasoning_disabled(native) is True:
        raise AcceptanceError(f"Hermes model metadata explicitly disables reasoning for {provider}/{model}")
    present, values = _effort_values(native)
    if present:
        can_disable = _can_disable_reasoning(native, values)
        allowed = requested in values or (requested.lower() == "none" and can_disable is True)
        require(allowed, f"Hermes model metadata does not explicitly allow reasoning effort {requested!r} for {provider}/{model}: {values}")
        return {"source": "hermes.model_options", "values": values, "can_disable": can_disable}

    configured = _config_provider(config, provider)
    model_entry = None
    if isinstance(configured, dict) and isinstance(configured.get("models"), dict):
        candidate = configured["models"].get(model)
        model_entry = candidate if isinstance(candidate, dict) else None
    sources = []
    if isinstance(model_entry, dict):
        exact = model_entry.get("hws_reasoning") if isinstance(model_entry.get("hws_reasoning"), dict) else model_entry
        sources.append(("hermes.provider_config.model", exact))
    if isinstance(configured, dict) and isinstance(configured.get("hws_reasoning_defaults"), dict):
        sources.append(("hermes.provider_config.defaults", configured["hws_reasoning_defaults"]))
    for source, metadata in sources:
        if _reasoning_disabled(metadata) is True:
            raise AcceptanceError(f"{source} explicitly disables reasoning for {provider}/{model}")
        present, values = _effort_values(metadata)
        if not present:
            continue
        can_disable = _can_disable_reasoning(metadata, values)
        allowed = requested in values or (requested.lower() == "none" and can_disable is True)
        require(allowed, f"{source} does not explicitly allow reasoning effort {requested!r} for {provider}/{model}: {values}")
        return {"source": source, "values": values, "can_disable": can_disable}
    raise AcceptanceError(
        f"No explicit reasoning effort vocabulary is published for {provider}/{model}; refusing to seal {requested!r} by inference"
    )


def validate_started_route(started: Any, provider: str, model: str) -> dict[str, Any]:
    """Prove that the real Run start resolved the requested source route safely."""
    if provider.strip().lower() == "moa":
        return {
            "provider": provider,
            "model": model,
            "mode": "",
            "status": "native_moa",
            "execution_provider": "moa",
            "source": "hermes_native_moa",
        }
    require(isinstance(started, dict), f"Run start is not an object: {started}")
    raw = started.get("source_route")
    require(isinstance(raw, dict), f"Run start did not expose resolved source_route: {started}")
    source_provider = str(raw.get("provider") or "")
    source_model = str(raw.get("model") or "")
    status = str(raw.get("status") or "").lower()
    execution_provider = str(raw.get("execution_provider") or "")
    require(source_provider == provider, f"Run route provider mismatch: expected {provider}, got {source_provider or '<missing>'}")
    require(source_model == model, f"Run route model mismatch: expected {model}, got {source_model or '<missing>'}")
    require(raw.get("requires_probe") is not True, f"Run route remained unresolved at execution time: {raw}")
    require(status in _EXECUTABLE_ROUTE_STATES, f"Run route is not executable/final: {raw}")
    require(bool(execution_provider), f"Run route has no execution_provider: {raw}")
    return {
        key: raw.get(key)
        for key in ("provider", "model", "mode", "status", "execution_provider", "source", "probed_at")
        if key in raw
    }


def wait_run(client: Client, run_id: str, timeout: float) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: dict[str, Any] = {}
    while time.time() < deadline:
        _, payload = client.request(f"{PLUGIN}/hermes/runs/{urllib.parse.quote(run_id, safe='')}?after=0")
        require(isinstance(payload, dict), "Run snapshot is not an object")
        last = payload
        status = str(payload.get("status") or "").lower()
        if status in TERMINAL:
            return payload
        time.sleep(0.65)
    try:
        client.request(f"{PLUGIN}/hermes/runs/{urllib.parse.quote(run_id, safe='')}/stop", method="POST", body={})
    except Exception:
        pass
    raise AcceptanceError(f"Run {run_id} did not settle within {timeout:.0f}s; last={last}")


def _session_messages(client: Client, session_id: str, limit: int = 100) -> list[dict[str, Any]]:
    qid = urllib.parse.quote(session_id, safe="")
    _, payload = client.request(f"/api/sessions/{qid}/messages?limit={limit}&order=latest")
    rows = payload.get("messages") if isinstance(payload, dict) else None
    return rows if isinstance(rows, list) else []


def _session_has_marker(messages: list[dict[str, Any]], marker: str) -> bool:
    for message in messages:
        if not isinstance(message, dict) or str(message.get("role") or "") != "assistant":
            continue
        value = message.get("display_content")
        if value is None:
            value = message.get("content") if message.get("content") is not None else message.get("text")
        if marker in _textish(value):
            return True
    return False


def _validate_real_plan(
    *,
    client: Client,
    session_id: str,
    final: dict[str, Any],
    marker: str,
) -> dict[str, Any]:
    messages = _session_messages(client, session_id)
    history = canonical_todo_history(messages)
    revisions = [int(row["revision"]) for row in history]
    require(len(revisions) >= 3, f"Hermes todo did not produce >=3 persisted revisions: {revisions}")
    require(revisions == sorted(set(revisions)), f"Hermes todo revisions are not monotonic/unique: {revisions}")
    require(max((len(row["todos"]) for row in history), default=0) >= 3, f"Hermes todo never contained 3 steps: {history}")

    saw_in_progress = any(
        any(str(item.get("status") or "").lower() == "in_progress" for item in row["todos"] if isinstance(item, dict))
        for row in history
    )
    require(saw_in_progress, f"Hermes todo never exposed an in_progress step: {history}")

    final_todos = history[-1]["todos"]
    final_statuses = [str(item.get("status") or "").lower() for item in final_todos if isinstance(item, dict)]
    require(len(final_statuses) >= 3, f"Final Hermes todo snapshot lost steps: {final_todos}")
    require(all(status == "completed" for status in final_statuses), f"Final Hermes todo is not fully completed: {final_todos}")

    projection = projected_todo_events(final)
    require(projection, f"Studio Run projection never surfaced canonical todo: {final.get('events')}")

    output = str(final.get("output") or "")
    marker_verified = marker in output or _session_has_marker(messages, marker)
    require(marker_verified, f"Run completed but final marker {marker!r} was not observed")

    return {
        "marker_verified": True,
        "canonical_revisions": revisions,
        "canonical_revision_count": len(revisions),
        "final_todo_count": len(final_statuses),
        "final_statuses": final_statuses,
        "projection_events": projection,
    }


def run_acceptance(args: argparse.Namespace) -> dict[str, Any]:
    client = Client(args.url, args.api_key, args.http_timeout)
    reasoning_effort = str(args.reasoning_effort or "").strip()
    if reasoning_effort:
        require(args.run, "--reasoning-effort requires --run")
        require(bool(str(args.provider or "").strip()) and bool(str(args.model or "").strip()), "--reasoning-effort requires explicit --provider and --model")
    evidence: dict[str, Any] = {
        "schema": TARGET_EVIDENCE_SCHEMA,
        "started_at": time.time(),
        "dashboard_url": args.url,
        "checks": {},
    }

    _, health = client.request(f"{PLUGIN}/health")
    require(isinstance(health, dict) and health.get("ok") is True, f"Studio health is not ready: {health}")
    evidence["checks"]["health"] = health

    _, integration = client.request(f"{PLUGIN}/integration")
    hermes = integration.get("hermes") if isinstance(integration, dict) else None
    require(isinstance(hermes, dict), f"Missing Hermes integration object: {integration}")
    require(hermes.get("execution_plane") == "official_runs", f"Unexpected execution plane: {hermes}")
    require(hermes.get("worker_plane") == "PluginContext.subagent_lifecycle", f"Unexpected Worker plane: {hermes}")
    require(hermes.get("model_catalog") == "/api/model/options", f"Unexpected model catalog: {hermes}")
    evidence["checks"]["integration"] = integration

    _, product_caps = client.request(f"{PLUGIN}/product-capabilities")
    require(isinstance(product_caps, dict) and product_caps.get("version") == 3, f"Unexpected Product capabilities: {product_caps}")
    require(product_caps.get("execution") == "Hermes official /v1/runs", f"Product execution drifted: {product_caps}")
    plan_caps = product_caps.get("official_plan") if isinstance(product_caps.get("official_plan"), dict) else {}
    require(plan_caps.get("source") == "Hermes canonical todo", f"Official plan is not Hermes-owned: {plan_caps}")
    require("/api/sessions" in str(plan_caps.get("fallback") or ""), f"Canonical todo fallback missing: {plan_caps}")
    protocol_caps = product_caps.get("model_protocols") if isinstance(product_caps.get("model_protocols"), dict) else {}
    require(protocol_caps.get("per_model") is True, f"Per-model protocol routing capability is missing: {protocol_caps}")
    require("first-use" in str(protocol_caps.get("probe") or ""), f"Installed product does not report first-use real-Run protocol resolution: {protocol_caps}")
    require("fail closed" in str(protocol_caps.get("unresolved") or "").lower(), f"Protocol unresolved policy is not fail-closed: {protocol_caps}")
    evidence["checks"]["product_capabilities"] = product_caps

    _, model_options = client.request("/api/model/options")
    require(isinstance(model_options, dict), "Hermes model catalog is not an object")
    evidence["checks"]["model_catalog"] = {
        "provider": model_options.get("provider"),
        "model": model_options.get("model"),
        "provider_count": len(model_options.get("providers") or []),
    }
    config: dict[str, Any] = {}
    if reasoning_effort:
        _, raw_config = client.request("/api/config")
        require(isinstance(raw_config, dict), "Hermes /api/config is not an object")
        config = raw_config.get("config") if isinstance(raw_config.get("config"), dict) else raw_config

    client.request("/api/sessions?limit=1&offset=0&order=recent&archived=exclude")

    stamp = f"{int(time.time())}-{os.getpid()}"
    title = f"HWS seal {stamp}"
    created_id = ""
    try:
        _, created = client.request(
            f"{PLUGIN}/hermes/sessions",
            method="POST",
            body={"title": title, "source": "hermes_worker_studio_seal"},
            expected=(200, 201),
        )
        require(isinstance(created, dict), f"Session create returned non-object: {created}")
        created_id = str((created.get("session") or {}).get("id") or created.get("session_id") or created.get("id") or "")
        require(created_id, f"Session create did not return an id: {created}")
        qid = urllib.parse.quote(created_id, safe="")

        renamed = f"HWS seal renamed {stamp}"
        client.request(f"/api/sessions/{qid}", method="PATCH", body={"title": renamed})
        _, detail = client.request(f"/api/sessions/{qid}")
        require(str(detail.get("title") or "") == renamed, f"Session rename did not round-trip: {detail}")

        client.request(f"/api/sessions/{qid}", method="PATCH", body={"archived": True})
        _, archived_detail = client.request(f"/api/sessions/{qid}")
        require(bool(archived_detail.get("archived")) is True, f"Archive did not round-trip: {archived_detail}")

        client.request(f"/api/sessions/{qid}", method="PATCH", body={"archived": False})
        _, restored_detail = client.request(f"/api/sessions/{qid}")
        require(bool(restored_detail.get("archived")) is False, f"Unarchive did not round-trip: {restored_detail}")

        evidence["checks"]["session_crud"] = {
            "created": True,
            "renamed": True,
            "archived": True,
            "unarchived": True,
            "session_id": created_id,
        }

        if args.run:
            provider, model = pick_route(model_options, args.provider, args.model)
            reasoning_declaration = None
            if reasoning_effort:
                reasoning_declaration = validate_reasoning_declaration(
                    model_options=model_options,
                    config=config,
                    provider=provider,
                    model=model,
                    effort=reasoning_effort,
                )
            marker = f"HWS_SEAL_RUN_OK_{stamp.replace('-', '_')}"
            prompt = (
                "This is a Hermes Worker Studio acceptance test. You MUST use the Hermes todo tool and no other tool. "
                "First create exactly three short todo items with one in_progress and the other two pending. "
                "Then perform each harmless logical step and call todo after each step so the canonical todo revision "
                "changes multiple times. Finish with all three items completed. The three logical steps are: "
                "(1) remember the token ALPHA, (2) remember the token BETA, (3) verify ALPHA followed by BETA is ALPHABETA. "
                f"After the todo list is fully completed, reply with exactly {marker} and nothing else."
            )
            run_body: dict[str, Any] = {"session_id": created_id, "input": prompt, "provider": provider, "model": model}
            if reasoning_effort:
                run_body["model_options"] = {"reasoning_effort": reasoning_effort}
            _, started = client.request(
                f"{PLUGIN}/hermes/runs-v3",
                method="POST",
                body=run_body,
                expected=(200, 202),
            )
            run_id = str(started.get("id") or started.get("run_id") or "") if isinstance(started, dict) else ""
            require(run_id, f"Run start did not return an id: {started}")
            execution_route = validate_started_route(started, provider, model)
            final = wait_run(client, run_id, args.run_timeout)
            require(str(final.get("status") or "").lower() == "completed", f"Real Hermes Run did not complete: {final}")
            plan_evidence = _validate_real_plan(client=client, session_id=created_id, final=final, marker=marker)
            evidence["checks"]["real_run"] = {
                "run_id": run_id,
                "provider": provider,
                "model": model,
                "status": final.get("status"),
                "execution_route": execution_route,
                "event_names": sorted({str(x.get("event")) for x in (final.get("events") or []) if isinstance(x, dict)}),
                **plan_evidence,
            }
            if reasoning_effort:
                evidence["checks"]["real_run"]["reasoning"] = {
                    "requested_effort": reasoning_effort,
                    "model_options_sent": {"reasoning_effort": reasoning_effort},
                    "declaration": reasoning_declaration,
                    "run_completed": True,
                    "boundary": "Studio -> Hermes /v1/runs model_options; provider wire semantics are separately pinned by Hermes transport tests",
                }

    finally:
        if created_id:
            qid = urllib.parse.quote(created_id, safe="")
            try:
                client.request(f"/api/sessions/{qid}", method="DELETE", expected=(200, 204))
                status, _ = client.request(f"/api/sessions/{qid}", expected=(404,))
                require(status == 404, "Deleted seal session is still addressable")
                evidence.setdefault("checks", {}).setdefault("session_crud", {})["deleted"] = True
            except Exception as exc:
                evidence.setdefault("cleanup_errors", []).append(str(exc))

    evidence["finished_at"] = time.time()
    evidence["ok"] = not evidence.get("cleanup_errors")
    if evidence.get("cleanup_errors"):
        raise AcceptanceError("; ".join(evidence["cleanup_errors"]))
    return evidence


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run real-target Hermes Worker Studio seal acceptance")
    parser.add_argument("--url", default=os.getenv("HWS_DASHBOARD_URL", "http://127.0.0.1:19119"), help="Hermes Dashboard base URL")
    parser.add_argument("--api-key", default=os.getenv("API_SERVER_KEY", ""), help="Optional Dashboard/API bearer token")
    parser.add_argument("--http-timeout", type=float, default=30.0)
    parser.add_argument("--run", action="store_true", help="Run the real Hermes model + canonical three-step todo evolution gate")
    parser.add_argument("--provider", default=os.getenv("HWS_SEAL_PROVIDER", ""))
    parser.add_argument("--model", default=os.getenv("HWS_SEAL_MODEL", ""))
    parser.add_argument("--reasoning-effort", default=os.getenv("HWS_SEAL_REASONING_EFFORT", ""), help="Optional concrete reasoning effort; requires explicit provider/model and --run")
    parser.add_argument("--run-timeout", type=float, default=180.0)
    parser.add_argument("--evidence", default="", help="Write JSON evidence to this path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        evidence = run_acceptance(args)
    except AcceptanceError as exc:
        print(f"SEAL ACCEPTANCE FAILED: {exc}", file=sys.stderr)
        return 1
    rendered = json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True)
    print(rendered)
    if args.evidence:
        path = Path(args.evidence)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered + "\n", encoding="utf-8")
        print(f"Evidence written: {path}", file=sys.stderr)
    print("SEAL ACCEPTANCE PASSED", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
