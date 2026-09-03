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
        raise SystemExit("usage: apply-cache-gate.py <hermes-agent-checkout>")
    root = Path(sys.argv[1]).resolve()

    hook_path = root / "web/src/plugins/usePlugins.ts"
    text = hook_path.read_text()
    old_gate = '''/**
 * Whether it is safe to skip the initial plugin-loading gate for a set of
 * cached manifests.
 *
 * App.tsx waits on `pluginsLoading` before mounting the persistent ChatPage
 * host: if a plugin overrides /chat (`tab.override === "/chat"`), mounting
 * the built-in chat first would spawn a PTY and then yank it out from under
 * the user when the plugin resolves. That gate is load-bearing — so we may
 * only seed `loading = false` from the cache when no cached manifest
 * declares a /chat override. Manifests are still seeded either way; only
 * the loading flag stays conservative.
 */
export function canSeedLoadedFromCache(
  cached: PluginManifest[] | null,
): boolean {
  if (cached === null) return false;
  return !cached.some((m) => m.tab?.override === "/chat");
}
'''
    new_gate = '''/**
 * Whether a manifest set can change native Dashboard ownership while its
 * plugin bundle is still resolving.
 *
 * `/chat` overrides must hold the gate so the persistent native PTY host is
 * never mounted before ownership is known. Route-scoped exclusive-shell
 * overrides use the same gate: native Dashboard chrome must not paint and
 * then disappear after the plugin registers.
 */
export function requiresPluginLoadingGate(
  manifests: PluginManifest[],
): boolean {
  return manifests.some((manifest) => {
    const tab = manifest.tab;
    if (!tab) return false;
    if (tab.override === "/chat") return true;
    return tab.shell === "exclusive" && typeof tab.override === "string";
  });
}

/** Whether cached manifests are safe to treat as synchronously loaded. */
export function canSeedLoadedFromCache(
  cached: PluginManifest[] | null,
): boolean {
  if (cached === null) return false;
  return !requiresPluginLoadingGate(cached);
}
'''
    text = replace_once(text, old_gate, new_gate, label="cache loading gate helper")

    old_fetch = '''      .then((list) => {
        cacheManifests(list);
        setManifests(list);
        if (list.length === 0) setLoading(false);
      })
'''
    new_fetch = '''      .then((list) => {
        cacheManifests(list);
        // A background refresh may discover an ownership-sensitive override
        // that was not present in sessionStorage. Raise the loading gate in
        // the same React batch as the new manifest list so native UI never
        // paints for a route whose ownership has just changed.
        if (requiresPluginLoadingGate(list)) setLoading(true);
        setManifests(list);
        if (list.length === 0) setLoading(false);
      })
'''
    text = replace_once(text, old_fetch, new_fetch, label="background cache drift gate")
    hook_path.write_text(text)

    test_path = root / "web/src/plugins/usePlugins.test.ts"
    tests = test_path.read_text()
    tests = replace_once(
        tests,
        '''  canSeedLoadedFromCache,\n  MANIFEST_CACHE_KEY,\n''',
        '''  canSeedLoadedFromCache,\n  requiresPluginLoadingGate,\n  MANIFEST_CACHE_KEY,\n''',
        label="cache helper test import",
    )
    insert_after = '''  it("returns false when a cached manifest overrides /chat — loading must stay true so App.tsx's pluginsLoading gate keeps the persistent chat host unmounted", () => {
    const list: PluginManifest[] = [
      exampleManifest,
      {
        ...exampleManifest,
        name: "chat-replacer",
        tab: { path: "/chat-alt", override: "/chat" },
      },
    ];
    expect(canSeedLoadedFromCache(list)).toBe(false);
  });
'''
    addition = insert_after + '''

  it("returns false for a cached route-scoped exclusive-shell override", () => {
    const list: PluginManifest[] = [
      {
        ...exampleManifest,
        name: "product-home",
        tab: {
          path: "/product-home",
          override: "/",
          shell: "exclusive",
        },
      },
    ];
    expect(canSeedLoadedFromCache(list)).toBe(false);
    expect(requiresPluginLoadingGate(list)).toBe(true);
  });

  it("does not hold the loading gate for a standalone shell declaration", () => {
    const list: PluginManifest[] = [
      {
        ...exampleManifest,
        name: "standalone",
        tab: { path: "/standalone", shell: "exclusive" },
      },
    ];
    expect(canSeedLoadedFromCache(list)).toBe(true);
    expect(requiresPluginLoadingGate(list)).toBe(false);
  });
'''
    tests = replace_once(
        tests,
        insert_after,
        addition,
        label="exclusive cache gate tests",
    )
    test_path.write_text(tests)
    print("Applied plugin manifest cache ownership gate")


if __name__ == "__main__":
    main()
