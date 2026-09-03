#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply-backend.py <hermes-agent-checkout>")
    root = Path(sys.argv[1]).resolve()
    path = root / "hermes_cli/web_server.py"
    text = path.read_text()
    old = '''                if bool(raw_tab.get("hidden")):
                    tab_info["hidden"] = True
                # Slots: list of named slot locations this plugin populates.
'''
    new = '''                if bool(raw_tab.get("hidden")):
                    tab_info["hidden"] = True
                shell_mode = raw_tab.get("shell")
                if (
                    "override" in tab_info
                    and shell_mode in {"standard", "exclusive"}
                ):
                    tab_info["shell"] = shell_mode
                # Slots: list of named slot locations this plugin populates.
'''
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"dashboard manifest shell pass-through: expected one match, found {count}"
        )
    path.write_text(text.replace(old, new, 1))
    print("Applied dashboard manifest shell pass-through")


if __name__ == "__main__":
    main()
