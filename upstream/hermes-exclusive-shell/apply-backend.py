#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def replace_once(text: str, old: str, new: str, *, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply-backend.py <hermes-agent-checkout>")
    root = Path(sys.argv[1]).resolve()

    path = root / "hermes_cli/web_server.py"
    text = path.read_text()
    text = replace_once(
        text,
        '''                if bool(raw_tab.get("hidden")):
                    tab_info["hidden"] = True
                # Slots: list of named slot locations this plugin populates.
''',
        '''                if bool(raw_tab.get("hidden")):
                    tab_info["hidden"] = True
                shell_mode = raw_tab.get("shell")
                if (
                    "override" in tab_info
                    and shell_mode in {"standard", "exclusive"}
                ):
                    tab_info["shell"] = shell_mode
                # Slots: list of named slot locations this plugin populates.
''',
        label="dashboard manifest shell pass-through",
    )
    path.write_text(text)

    tests_path = root / "tests/hermes_cli/test_web_server.py"
    tests = tests_path.read_text()
    marker = '''    def test_user_plugins_ignore_profile_home_override(self, tmp_path, monkeypatch):
'''
    addition = '''    def test_shell_mode_is_route_scoped_and_validated(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        self._write_plugin(tmp_path, "standard-shell", {
            "name": "standard-shell",
            "tab": {
                "path": "/standard-shell",
                "override": "/sessions",
                "shell": "standard",
            },
            "entry": "dist/index.js",
        })
        self._write_plugin(tmp_path, "invalid-shell", {
            "name": "invalid-shell",
            "tab": {
                "path": "/invalid-shell",
                "override": "/config",
                "shell": "immersive",
            },
            "entry": "dist/index.js",
        })
        self._write_plugin(tmp_path, "standalone-exclusive", {
            "name": "standalone-exclusive",
            "tab": {
                "path": "/standalone-exclusive",
                "shell": "exclusive",
            },
            "entry": "dist/index.js",
        })

        from hermes_cli import web_server
        web_server._dashboard_plugins_cache = None
        plugins = web_server._get_dashboard_plugins(force_rescan=True)
        by_name = {p["name"]: p for p in plugins}

        assert by_name["standard-shell"]["tab"]["shell"] == "standard"
        assert "shell" not in by_name["invalid-shell"]["tab"]
        assert "shell" not in by_name["standalone-exclusive"]["tab"]

'''
    tests = replace_once(
        tests,
        marker,
        addition + marker,
        label="dashboard shell validation test",
    )
    tests_path.write_text(tests)
    print("Applied dashboard manifest shell pass-through and validation tests")


if __name__ == "__main__":
    main()
