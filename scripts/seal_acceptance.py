#!/usr/bin/env python3
"""Real-target seal acceptance for Hermes Worker Studio Product 3.

This script talks only to the running Hermes Dashboard / public Studio plugin
HTTP surface.  The default pass is deliberately low-risk: it verifies health,
public integration ownership, model catalog access, and a complete ephemeral
session CRUD lifecycle (create -> rename -> archive -> unarchive -> delete).

Optional real model execution is enabled with ``--run``.  Nothing changes
approval policy unless a future explicit acceptance step is added; the normal
script never enables Full Access on its own.
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


def pick_route(model_options: dict[str, Any], provider: str, model: str) -> tuple[str, str]:
    rows = model_options.get("providers") if isinstance(model_options, dict) else []
    rows = rows if isinstance(rows, list) else []
    if provider and model:
        return provider, model
    wanted_provider = provider or str(model_options.get("provider") or "")
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug = str(row.get("slug") or "")
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
        models = row.get("models") if isinstance(row.get("models"), list) else []
        if row.get("slug") and models:
            return str(row["slug"]), str(models[0])
    raise AcceptanceError("No usable provider/model found in Hermes /api/model/options")


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


def run_acceptance(args: argparse.Namespace) -> dict[str, Any]:
    client = Client(args.url, args.api_key, args.http_timeout)
    evidence: dict[str, Any] = {
        "schema": "hermes-worker-studio.seal-evidence.v1",
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

    _, model_options = client.request("/api/model/options")
    require(isinstance(model_options, dict), "Hermes model catalog is not an object")
    evidence["checks"]["model_catalog"] = {
        "provider": model_options.get("provider"),
        "model": model_options.get("model"),
        "provider_count": len(model_options.get("providers") or []),
    }

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
            marker = f"HWS_SEAL_RUN_OK_{stamp.replace('-', '_')}"
            prompt = f"Reply with exactly {marker} and nothing else. Do not call tools."
            _, started = client.request(
                f"{PLUGIN}/hermes/runs-v3",
                method="POST",
                body={"session_id": created_id, "input": prompt, "provider": provider, "model": model},
                expected=(200, 202),
            )
            run_id = str(started.get("id") or started.get("run_id") or "")
            require(run_id, f"Run start did not return an id: {started}")
            final = wait_run(client, run_id, args.run_timeout)
            require(str(final.get("status") or "").lower() == "completed", f"Real Hermes Run did not complete: {final}")
            output = str(final.get("output") or "")
            if output:
                require(marker in output, f"Run completed but marker was not present in output: {output[:500]}")
            evidence["checks"]["real_run"] = {
                "run_id": run_id,
                "provider": provider,
                "model": model,
                "status": final.get("status"),
                "marker_verified": marker in output if output else None,
                "event_names": sorted({str(x.get("event")) for x in (final.get("events") or []) if isinstance(x, dict)}),
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
    parser.add_argument("--run", action="store_true", help="Also submit and verify one real Hermes model Run")
    parser.add_argument("--provider", default=os.getenv("HWS_SEAL_PROVIDER", ""))
    parser.add_argument("--model", default=os.getenv("HWS_SEAL_MODEL", ""))
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
