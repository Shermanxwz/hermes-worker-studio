from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_module(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


plugin_api = load_module("hws_real_worker_plugin_api", ROOT / "dashboard" / "plugin_api.py")
tools = load_module("hws_real_worker_tools", ROOT / "tools.py")


def direct(path: str, *, method: str = "GET", body: object | None = None):
    base = os.environ.get("HERMES_WORKER_STUDIO_WORKER_URL", "http://127.0.0.1:8788").rstrip("/")
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode())


def _model_semantics(model: object) -> dict:
    if not isinstance(model, dict):
        return {"id": ""}
    reasoning = model.get("reasoning") if isinstance(model.get("reasoning"), dict) else {}
    options = reasoning.get("options") if isinstance(reasoning, dict) else []
    return {
        "id": str(model.get("id") or model.get("catalogId") or model.get("name") or ""),
        "provider": model.get("provider"),
        "hidden": model.get("hidden"),
        "isDefault": model.get("isDefault"),
        "kind": model.get("kind"),
        "reasoning": {
            "advertised": reasoning.get("advertised") if isinstance(reasoning, dict) else None,
            "source": reasoning.get("source") if isinstance(reasoning, dict) else None,
            "default": reasoning.get("default") if isinstance(reasoning, dict) else None,
            "options": [
                {
                    "value": item.get("value") if isinstance(item, dict) else str(item),
                    "description": item.get("description") if isinstance(item, dict) else "",
                }
                for item in (options if isinstance(options, list) else [])
            ],
        },
    }


def _catalog_semantics(payload: object) -> dict:
    """Compare stable catalog meaning, excluding regenerated observation time."""
    if not isinstance(payload, dict):
        return {"invalid": True}
    registry = payload.get("registry") if isinstance(payload.get("registry"), dict) else {}
    providers = registry.get("providers") if isinstance(registry, dict) else {}
    provider_semantics: dict[str, dict] = {}
    if isinstance(providers, dict):
        for name, provider in sorted(providers.items()):
            provider = provider if isinstance(provider, dict) else {}
            models = provider.get("models") if isinstance(provider.get("models"), list) else []
            provider_semantics[str(name)] = {
                "available": provider.get("available"),
                "configured": provider.get("configured"),
                "source": provider.get("source"),
                "defaultModel": provider.get("defaultModel"),
                "models": [_model_semantics(model) for model in models],
            }
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
    return {
        "registrySchemaVersion": registry.get("schemaVersion") if isinstance(registry, dict) else None,
        "authentication": registry.get("authentication") if isinstance(registry, dict) else None,
        "mainPolicy": registry.get("mainPolicy") if isinstance(registry, dict) else None,
        "providers": provider_semantics,
        "runtime": {
            "mode": runtime.get("mode") if isinstance(runtime, dict) else None,
            "effectiveRouting": runtime.get("effectiveRouting") if isinstance(runtime, dict) else None,
            "routeErrors": runtime.get("routeErrors") if isinstance(runtime, dict) else None,
        },
    }


def _native_policy() -> dict:
    native = json.loads(tools.worker_catalog({}))
    if native.get("ok") is not True:
        raise SystemExit(f"native worker_catalog failed: {native}")
    result = native.get("result")
    if not isinstance(result, dict):
        raise SystemExit("native worker_catalog result is not an object")
    policy = result.get("studio_policy")
    if not isinstance(policy, dict):
        raise SystemExit("native worker_catalog missing studio_policy")
    return {"result": result, "policy": policy}


def main() -> int:
    direct_health = direct("/api/health")
    direct_state = direct("/api/state")
    direct_catalog = direct("/api/catalog")
    if direct_health.get("ok") is not True:
        raise SystemExit(f"real Worker health not ok: {direct_health}")
    if not isinstance(direct_state, dict):
        raise SystemExit("real Worker state is not an object")
    if not isinstance(direct_catalog, dict) or "registry" not in direct_catalog:
        raise SystemExit(f"real Worker catalog missing registry: {direct_catalog}")

    proxied_health = plugin_api.worker_health()
    proxied_state = plugin_api.worker_state()
    proxied_catalog = plugin_api.worker_catalog()
    if proxied_health != direct_health:
        raise SystemExit("Studio worker health proxy changed the real Worker payload")
    if proxied_state != direct_state:
        raise SystemExit("Studio worker state proxy changed the real Worker payload")
    if _catalog_semantics(proxied_catalog) != _catalog_semantics(direct_catalog):
        raise SystemExit("Studio worker catalog proxy changed stable Worker semantics")

    native = _native_policy()
    if _catalog_semantics(native["result"]) != _catalog_semantics(direct_catalog):
        raise SystemExit("native worker_catalog changed stable Worker semantics")
    initial_mode = str(direct_state.get("mode") or "OFFICIAL").upper()

    # Real pinned control-plane mode cycle.  This proves the exact wire modes
    # that back the Web labels OFFICIAL / AUTO / WORKER(DELEGATE) / MAIN and
    # verifies the native Hermes tool reads the same persisted state.
    try:
        for mode in ("OFFICIAL", "AUTO", "DELEGATE", "MAIN"):
            changed = direct("/api/mode", method="PUT", body={"mode": mode})
            state = direct("/api/state")
            actual = str(state.get("mode") or "").upper()
            if actual != mode:
                raise SystemExit(f"real Worker mode transition failed: requested {mode}, got {actual}; response={changed}")
            policy = _native_policy()["policy"]
            if policy.get("mode") != mode:
                raise SystemExit(f"native policy mode mismatch: expected {mode}, got {policy.get('mode')}")
            expected_allowed = mode in {"AUTO", "DELEGATE"}
            if policy.get("delegation_allowed") is not expected_allowed:
                raise SystemExit(
                    f"native delegation policy mismatch for {mode}: expected {expected_allowed}, got {policy.get('delegation_allowed')}"
                )
            expected_ui = "WORKER" if mode == "DELEGATE" else mode
            if policy.get("ui_mode") != expected_ui:
                raise SystemExit(f"native ui mode mismatch for {mode}: {policy.get('ui_mode')}")
    finally:
        if initial_mode in {"OFFICIAL", "AUTO", "DELEGATE", "MAIN"}:
            direct("/api/mode", method="PUT", body={"mode": initial_mode})

    print("real Worker control-plane smoke passed")
    print(f"  initial mode restored: {initial_mode}")
    print("  modes: OFFICIAL -> AUTO -> DELEGATE(WORKER) -> MAIN")
    providers = direct_catalog.get("registry", {}).get("providers", {})
    print(f"  providers: {', '.join(sorted(providers)) or '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
