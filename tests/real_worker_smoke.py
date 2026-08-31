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


def direct(path: str):
    base = os.environ.get("HERMES_WORKER_STUDIO_WORKER_URL", "http://127.0.0.1:8788").rstrip("/")
    with urllib.request.urlopen(base + path, timeout=10) as response:
        return json.loads(response.read().decode())


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
    if proxied_catalog != direct_catalog:
        raise SystemExit("Studio worker catalog proxy changed the real Worker payload")

    native = json.loads(tools.worker_catalog({}))
    if native.get("ok") is not True or native.get("result") != direct_catalog:
        raise SystemExit(f"native worker_catalog mismatch: {native}")

    print("real Worker control-plane smoke passed")
    print(f"  mode: {direct_state.get('mode')}")
    providers = direct_catalog.get("registry", {}).get("providers", {})
    print(f"  providers: {', '.join(sorted(providers)) or '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
