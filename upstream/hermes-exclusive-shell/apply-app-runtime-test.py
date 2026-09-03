#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply-app-runtime-test.py <hermes-agent-checkout>")
    root = Path(sys.argv[1]).resolve()
    path = root / "web/src/App.exclusive-shell.test.tsx"
    path.write_text(r'''// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pluginState = vi.hoisted(() => ({
  loading: false,
  manifests: [] as Array<Record<string, unknown>>,
}));

const apiMocks = vi.hoisted(() => ({
  getConfig: vi.fn(async () => ({ dashboard: {} })),
  checkHermesUpdate: vi.fn(async () => null),
}));

vi.mock("@/plugins", async () => {
  const React = await import("react");
  return {
    usePlugins: () => ({
      manifests: pluginState.manifests,
      loading: pluginState.loading,
      plugins: [],
    }),
    PluginPage: ({ name }: { name: string }) =>
      React.createElement(
        "div",
        { "data-plugin-page": name },
        `plugin:${name}`,
      ),
    PluginSlot: ({ name }: { name: string }) =>
      React.createElement("div", { "data-plugin-slot": name }),
  };
});

vi.mock("@/contexts/ProfileProvider", async () => {
  const React = await import("react");
  return {
    ProfileProvider: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("@/contexts/PageHeaderProvider", async () => {
  const React = await import("react");
  return {
    PageHeaderProvider: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("@/contexts/useProfileScope", () => ({
  useProfileScope: () => ({ profile: "" }),
}));

vi.mock("@/themes", () => ({
  useTheme: () => ({ theme: { layoutVariant: "standard" } }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: {
      app: {
        openNavigation: "Open navigation",
        closeNavigation: "Close navigation",
        navigation: "Navigation",
        brand: "Hermes",
        pluginNavSection: "Plugins",
        system: "System",
        nav: {},
      },
      common: {
        expand: "Expand",
        collapse: "Collapse",
        cancel: "Cancel",
        loading: "Loading",
      },
      theme: { switchTheme: "Switch theme" },
      language: { switchTo: "Switch language" },
      status: {
        gateway: "Gateway",
        restartGateway: "Restart gateway",
        restartingGateway: "Restarting gateway",
        updateHermes: "Update Hermes",
        updatingHermes: "Updating Hermes",
        updateHermesConfirmNow: "Update now",
        updateHermesConfirmTitle: "Update Hermes?",
        updateHermesConfirmMessage: "Update Hermes",
        restartGatewayConfirmTitle: "Restart gateway?",
        restartGatewayConfirmMessage: "Restart gateway",
      },
    },
  }),
}));

vi.mock("@nous-research/ui/hooks/use-below-breakpoint", () => ({
  useBelowBreakpoint: () => false,
}));

vi.mock("@/hooks/useSidebarStatus", () => ({
  useSidebarStatus: () => null,
}));

vi.mock("@/contexts/useSystemActions", () => ({
  useSystemActions: () => ({
    activeAction: null,
    isBusy: false,
    isRunning: false,
    pendingAction: null,
    runAction: vi.fn(),
  }),
}));

vi.mock("@/components/SidebarStatusStrip", () => ({
  SidebarStatusStrip: () => null,
  gatewayLine: () => ({ tone: "text-success", label: "OK" }),
}));
vi.mock("@/components/SidebarFooter", () => ({ SidebarFooter: () => null }));
vi.mock("@/components/AuthWidget", () => ({ AuthWidget: () => null }));
vi.mock("@/components/ProfileSwitcher", () => ({ ProfileSwitcher: () => null }));
vi.mock("@/components/ProfileScopeBanner", () => ({ ProfileScopeBanner: () => null }));
vi.mock("@/components/MemoryPressureBanner", () => ({ MemoryPressureBanner: () => null }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeSwitcher", () => ({ ThemeSwitcher: () => null }));

vi.mock("@nous-research/ui/ui/components/selection-switcher", () => ({
  SelectionSwitcher: () => null,
}));
vi.mock("@nous-research/ui/ui/components/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));
vi.mock("@nous-research/ui/ui/components/spinner", async () => {
  const React = await import("react");
  return { Spinner: () => React.createElement("span", null, "loading") };
});
vi.mock("@nous-research/ui/ui/components/typography/index", async () => {
  const React = await import("react");
  return {
    Typography: ({ children }: { children: ReactNode }) =>
      React.createElement("span", null, children),
  };
});
vi.mock("@nous-research/ui/ui/components/button", async () => {
  const React = await import("react");
  return {
    Button: ({ children, onClick, ...props }: Record<string, unknown>) =>
      React.createElement(
        "button",
        {
          onClick,
          "aria-label": props["aria-label"],
          "aria-expanded": props["aria-expanded"],
          "aria-controls": props["aria-controls"],
        },
        children as ReactNode,
      ),
  };
});

vi.mock("@/lib/dashboard-flags", () => ({
  isDashboardEmbeddedChatEnabled: () => false,
}));
vi.mock("@/lib/chat-activation", () => ({
  latchChatActivation: (mounted: boolean, active: boolean) => mounted || active,
}));
vi.mock("@/lib/api", () => ({
  api: apiMocks,
}));

import App from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const storage = (() => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
})();

function productHomeManifest() {
  return {
    name: "product-home",
    label: "Product Home",
    description: "",
    icon: "Puzzle",
    version: "1.0.0",
    tab: {
      path: "/product-home",
      override: "/",
      shell: "exclusive",
    },
    entry: "index.js",
    has_api: false,
    source: "local",
  };
}

function sessionsOverrideManifest() {
  return {
    name: "sessions-override",
    label: "Sessions Override",
    description: "",
    icon: "Puzzle",
    version: "1.0.0",
    tab: {
      path: "/sessions-override",
      override: "/sessions",
      shell: "standard",
    },
    entry: "index.js",
    has_api: false,
    source: "local",
  };
}

async function renderAt(pathname: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[pathname]}>
        <App />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  pluginState.loading = false;
  pluginState.manifests = [];
  apiMocks.getConfig.mockClear();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("matchMedia", () => ({
    addEventListener() {},
    removeEventListener() {},
    matches: false,
    media: "",
  }));
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  container?.remove();
  document.body.innerHTML = "";
  storage.clear();
  vi.unstubAllGlobals();
});

describe("Dashboard route-scoped exclusive shell", () => {
  it("renders a neutral surface while plugin ownership is unresolved", async () => {
    pluginState.loading = true;
    pluginState.manifests = [productHomeManifest()];

    await renderAt("/");

    expect(
      container.querySelector('[data-dashboard-shell-mode="pending"]'),
    ).not.toBeNull();
    expect(container.querySelector("#app-sidebar")).toBeNull();
    expect(container.querySelector("[data-plugin-page]")).toBeNull();
    expect(container.querySelector("[data-plugin-slot]")).toBeNull();
  });

  it("renders the overriding plugin without native Dashboard chrome", async () => {
    pluginState.manifests = [productHomeManifest()];

    await renderAt("/");

    expect(
      container.querySelector('[data-dashboard-shell-mode="exclusive"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-plugin-page="product-home"]'),
    ).not.toBeNull();
    expect(container.querySelector("#app-sidebar")).toBeNull();
    expect(container.querySelector("[data-plugin-slot]")).toBeNull();
  });

  it("restores the standard Hermes shell on a non-exclusive route", async () => {
    pluginState.manifests = [
      productHomeManifest(),
      sessionsOverrideManifest(),
    ];

    await renderAt("/sessions");

    expect(
      container.querySelector('[data-dashboard-shell-mode="standard"]'),
    ).not.toBeNull();
    expect(container.querySelector("#app-sidebar")).not.toBeNull();
    expect(
      container.querySelector('[data-plugin-page="sessions-override"]'),
    ).not.toBeNull();
  });
});
''')
    print("Added Dashboard exclusive-shell runtime DOM tests")


if __name__ == "__main__":
    main()
