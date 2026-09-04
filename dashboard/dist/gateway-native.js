(function () {
  'use strict';
  const current = document.currentScript || [...document.scripts].reverse().find((script) => /gateway-native\.js(?:\?|$)/.test(script.src));
  if (!current?.src) {
    console.error('[hermes-worker-studio] cannot resolve Gateway-native entry');
    return;
  }
  const layers = ['model-capability-core.js', 'model-capability-bridge.js', 'model-capability-dom.js', 'protocol-runtime.js', 'gateway-native-core.js'];
  function load(index) {
    if (index >= layers.length) return;
    const script = document.createElement('script');
    script.src = new URL(layers[index], current.src).href;
    script.async = false;
    script.onload = () => load(index + 1);
    script.onerror = () => console.error(`[hermes-worker-studio] failed to load ${layers[index]}`);
    document.head.appendChild(script);
  }
  load(0);
})();
