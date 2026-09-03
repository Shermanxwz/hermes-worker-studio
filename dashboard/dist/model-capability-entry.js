(function () {
  'use strict';
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK?.React || typeof SDK.fetchJSON !== 'function') { console.error('[hermes-worker-studio] Hermes Plugin SDK unavailable'); return; }
  const current = document.currentScript || [...document.scripts].reverse().find((s) => /model-capability-entry\.js(?:\?|$)/.test(s.src));
  if (!current?.src) { console.error('[hermes-worker-studio] model capability entry URL unavailable'); return; }
  const load = (name, next) => { const s = document.createElement('script'); s.src = new URL(name, current.src).href; s.async = false; s.onload = next || null; s.onerror = () => console.error(`[hermes-worker-studio] failed to load ${name}`); document.head.appendChild(s); };
  load('model-capability-core.js', () => load('model-capability-bridge.js', () => load('model-capability-dom.js', () => load('gateway-native.js'))));
})();
