#!/usr/bin/env python3
from __future__ import annotations

import sys
import textwrap
from pathlib import Path

UPSTREAM_SHA = "63279301bcbdc185c1b07b98a9312eb0c862f26d"

def replace_once(text: str, old: str, new: str, *, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply.py <hermes-agent-checkout>")
    root = Path(sys.argv[1]).resolve()

    types_path = root / "web/src/plugins/types.ts"
    text = types_path.read_text()
    text = replace_once(
        text,
        """    /** When true, the plugin may register without a sidebar tab (slot-only, etc.). */
    hidden?: boolean;
""",
        """    /** When true, the plugin may register without a sidebar tab (slot-only, etc.). */
    hidden?: boolean;
    /**
     * Shell chrome mode for an overridden built-in route.
     * `standard` keeps the normal Dashboard shell (default).
     * `exclusive` gives the plugin route the full viewport while preserving
     * Dashboard providers, routing, auth, theme, and plugin lifecycle.
     */
    shell?: "standard" | "exclusive";
""",
        label="PluginManifest.tab shell type",
    )
    types_path.write_text(text)

    (root / "web/src/plugins/shell-mode.ts").write_text("""import type { PluginManifest } from "./types";

export type DashboardShellMode = "pending" | "standard" | "exclusive";

function normalizeRoutePath(path: string): string {
  return path.replace(/\\/$/, "") || "/";
}

/**
 * Resolve Dashboard chrome ownership for the current route.
 *
 * Plugin manifests arrive asynchronously, so the shell must stay neutral
 * while discovery is pending. Otherwise an exclusive override would first
 * paint native Dashboard chrome and then yank it away after manifests load.
 */
export function resolveDashboardShellMode(
  manifests: PluginManifest[],
  pathname: string,
  pluginsLoading: boolean,
): DashboardShellMode {
  if (pluginsLoading) return "pending";

  const activePath = normalizeRoutePath(pathname);
  const ownsExclusiveShell = manifests.some((manifest) => {
    const override = manifest.tab.override;
    return (
      manifest.tab.shell === "exclusive" &&
      typeof override === "string" &&
      normalizeRoutePath(override) === activePath
    );
  });

  return ownsExclusiveShell ? "exclusive" : "standard";
}
""")

    (root / "web/src/plugins/shell-mode.test.ts").write_text("""import { describe, expect, it } from "vitest";

import type { PluginManifest } from "./types";
import { resolveDashboardShellMode } from "./shell-mode";

function manifest(
  tab: PluginManifest["tab"],
  name = "test-plugin",
): PluginManifest {
  return {
    name,
    label: name,
    description: "",
    icon: "Puzzle",
    version: "1.0.0",
    tab,
    slots: [],
    entry: "/plugin.js",
    css: null,
    has_api: false,
    source: "/tmp/plugin",
  };
}

describe("resolveDashboardShellMode", () => {
  it("keeps shell chrome neutral until plugin discovery completes", () => {
    expect(resolveDashboardShellMode([], "/", true)).toBe("pending");
    expect(
      resolveDashboardShellMode(
        [
          manifest({
            path: "/worker-studio",
            override: "/",
            shell: "exclusive",
          }),
        ],
        "/",
        true,
      ),
    ).toBe("pending");
  });

  it("grants exclusive shell ownership only on the overridden route", () => {
    const manifests = [
      manifest({
        path: "/worker-studio",
        override: "/",
        shell: "exclusive",
      }),
    ];

    expect(resolveDashboardShellMode(manifests, "/", false)).toBe("exclusive");
    expect(resolveDashboardShellMode(manifests, "/sessions", false)).toBe(
      "standard",
    );
  });

  it("keeps legacy and explicit-standard overrides on the normal shell", () => {
    expect(
      resolveDashboardShellMode(
        [manifest({ path: "/legacy", override: "/" })],
        "/",
        false,
      ),
    ).toBe("standard");
    expect(
      resolveDashboardShellMode(
        [
          manifest({
            path: "/standard",
            override: "/",
            shell: "standard",
          }),
        ],
        "/",
        false,
      ),
    ).toBe("standard");
  });

  it("does not let a non-override plugin claim exclusive shell ownership", () => {
    expect(
      resolveDashboardShellMode(
        [manifest({ path: "/standalone", shell: "exclusive" })],
        "/standalone",
        false,
      ),
    ).toBe("standard");
  });

  it("treats a trailing slash as the same route", () => {
    expect(
      resolveDashboardShellMode(
        [
          manifest({
            path: "/worker-studio",
            override: "/sessions",
            shell: "exclusive",
          }),
        ],
        "/sessions/",
        false,
      ),
    ).toBe("exclusive");
  });
});
""")

    app_path = root / "web/src/App.tsx"
    app = app_path.read_text()
    app = replace_once(
        app,
        """import { PluginPage, PluginSlot, usePlugins } from "@/plugins";
import type { PluginManifest } from "@/plugins";
""",
        """import { PluginPage, PluginSlot, usePlugins } from "@/plugins";
import type { PluginManifest } from "@/plugins";
import { resolveDashboardShellMode } from "@/plugins/shell-mode";
""",
        label="App shell-mode import",
    )
    app = replace_once(
        app,
        """  const normalizedPath = pathname.replace(/\\/$/, "") || "/";
  const isChatRoute = normalizedPath === "/chat";
""",
        """  const normalizedPath = pathname.replace(/\\/$/, "") || "/";
  const isChatRoute = normalizedPath === "/chat";
  const dashboardShellMode = resolveDashboardShellMode(
    manifests,
    normalizedPath,
    pluginsLoading,
  );
""",
        label="App shell mode resolution",
    )

    route_start = app.index("                <ProfileKeyedRoutes>\n")
    route_end = app.index('              <PluginSlot name="post-main" />\n', route_start)
    routed_block = app[route_start:route_end]
    app = app[:route_start] + "                {routedPage}\n" + app[route_end:]
    routed_body = textwrap.dedent(routed_block).rstrip() + "\n"
    routed_page = (
        "  const routedPage = (\n"
        "    <>\n"
        + textwrap.indent(routed_body, "      ")
        + "    </>\n"
        "  );\n\n"
    )

    return_marker = "  return (\n    <ProfileProvider>\n"
    return_pos = app.rfind(return_marker)
    if return_pos < 0:
        raise SystemExit("App return marker not found")

    branches = routed_page + """  if (dashboardShellMode === "pending") {
    return (
      <ProfileProvider>
        <div
          data-dashboard-shell-mode="pending"
          data-layout-variant={layoutVariant}
          className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background-base text-text-primary antialiased"
        >
          <RouteFallback label="Loading dashboard…" />
        </div>
      </ProfileProvider>
    );
  }

  if (dashboardShellMode === "exclusive") {
    return (
      <ProfileProvider>
        <div
          data-dashboard-shell-mode="exclusive"
          data-layout-variant={layoutVariant}
          className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background-base text-text-primary antialiased"
        >
          <PageHeaderProvider pluginTabs={pluginTabMeta}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
              {routedPage}
            </div>
          </PageHeaderProvider>
        </div>
      </ProfileProvider>
    );
  }

"""
    app = app[:return_pos] + branches + app[return_pos:]
    app = replace_once(
        app,
        """    <div
      data-layout-variant={layoutVariant}
""",
        """    <div
      data-dashboard-shell-mode="standard"
      data-layout-variant={layoutVariant}
""",
        label="standard shell mode marker",
    )
    app_path.write_text(app)

    tests_path = root / "tests/hermes_cli/test_web_server.py"
    tests = tests_path.read_text()
    tests = replace_once(
        tests,
        "    tab.hidden, slots) read by _discover_dashboard_plugins().",
        "    tab.hidden, tab.shell, slots) read by _discover_dashboard_plugins().",
        label="backend manifest extension docstring",
    )
    tests = replace_once(
        tests,
        '            "tab": {"path": "/skin-home", "override": "/", "hidden": True},\n',
        """            "tab": {
                "path": "/skin-home",
                "override": "/",
                "hidden": True,
                "shell": "exclusive",
            },
""",
        label="backend manifest shell fixture",
    )
    tests = replace_once(
        tests,
        """        assert entry["tab"]["override"] == "/"
        assert entry["tab"]["hidden"] is True
        assert entry["slots"] == ["sidebar", "header-left"]
""",
        """        assert entry["tab"]["override"] == "/"
        assert entry["tab"]["hidden"] is True
        assert entry["tab"]["shell"] == "exclusive"
        assert entry["slots"] == ["sidebar", "header-left"]
""",
        label="backend manifest shell assertion",
    )
    tests_path.write_text(tests)

    docs_path = root / "website/docs/user-guide/features/extending-the-dashboard.md"
    docs = docs_path.read_text()
    docs = replace_once(
        docs,
        """    "position": "after:skills",
    "override": "/",
    "hidden": false
""",
        """    "position": "after:skills",
    "override": "/",
    "hidden": false,
    "shell": "standard"
""",
        label="manifest reference shell field",
    )
    docs = replace_once(
        docs,
        """| `tab.override` | No | Set to a built-in route path (`"/"`, `"/sessions"`, `"/config"`, ...) to **replace** that page instead of adding a new tab. See [Replacing built-in pages](#replacing-built-in-pages-taboverride). |
| `tab.hidden` | No | When true, register the component and any slots without adding a tab to the nav. Used by slot-only plugins. See [Slot-only plugins](#slot-only-plugins-tabhidden). |
""",
        """| `tab.override` | No | Set to a built-in route path (`"/"`, `"/sessions"`, `"/config"`, ...) to **replace** that page instead of adding a new tab. See [Replacing built-in pages](#replacing-built-in-pages-taboverride). |
| `tab.shell` | No | Shell chrome mode for an overridden route. `"standard"` (default) keeps the normal Hermes sidebar/header. `"exclusive"` gives the plugin the full route viewport while preserving Dashboard providers, routing, auth, theme, and plugin lifecycle. Only applies with `tab.override`. |
| `tab.hidden` | No | When true, register the component and any slots without adding a tab to the nav. Used by slot-only plugins. See [Slot-only plugins](#slot-only-plugins-tabhidden). |
""",
        label="manifest reference shell row",
    )
    docs = replace_once(
        docs,
        """    "path": "/my-home",
    "override": "/",
    "position": "end"
""",
        """    "path": "/my-home",
    "override": "/",
    "shell": "exclusive",
    "position": "end"
""",
        label="override example exclusive shell",
    )
    docs = replace_once(
        docs,
        """- The original page component at `/` is removed from the router.
- Your plugin renders at `/` instead.
- No nav tab is added for `tab.path` (the override is the point).

Only one plugin can override a given path. If two plugins claim the same override, the first wins and the second is ignored with a dev-mode warning.
""",
        """- The original page component at `/` is removed from the router.
- Your plugin renders at `/` instead.
- No nav tab is added for `tab.path` (the override is the point).
- `tab.shell: "standard"` (or omitting `tab.shell`) keeps the normal Hermes Dashboard chrome.
- `tab.shell: "exclusive"` suppresses built-in shell chrome **only while the overridden route is active**. Navigating to any other route restores the normal Hermes shell automatically.
- Dashboard providers, routing, auth, theme, profile scope, deep links, and browser history remain owned by Hermes in both modes.
- While plugin manifests are still loading, the Dashboard renders a neutral loading surface instead of native chrome. This prevents an exclusive override from flashing the built-in sidebar/header before ownership is known.

Only one plugin can override a given path. If two plugins claim the same override, the first wins and the second is ignored with a dev-mode warning.
""",
        label="override shell semantics docs",
    )
    docs_path.write_text(docs)

    print(f"Applied exclusive-shell contribution against Hermes {UPSTREAM_SHA}")

if __name__ == "__main__":
    main()
