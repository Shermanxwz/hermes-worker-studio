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
        raise SystemExit("usage: apply-app-structure.py <hermes-agent-checkout>")
    root = Path(sys.argv[1]).resolve()
    path = root / "web/src/App.tsx"
    text = path.read_text()

    text = replace_once(
        text,
        '''      </div>
    </>
  );

  if (dashboardShellMode === "pending") {
''',
        '''    </>
  );

  if (dashboardShellMode === "pending") {
''',
        label="remove standard-only wrapper close from shared route fragment",
    )
    text = replace_once(
        text,
        '''                {routedPage}
              <PluginSlot name="post-main" />
''',
        '''                {routedPage}
              </div>
              <PluginSlot name="post-main" />
''',
        label="restore standard route wrapper close",
    )
    path.write_text(text)
    print("Corrected shared route fragment ownership")


if __name__ == "__main__":
    main()
