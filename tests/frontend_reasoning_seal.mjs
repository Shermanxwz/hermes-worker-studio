import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { JSDOM } from 'jsdom';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFile(path.join(rootDir, `dashboard/dist/${name}`), 'utf8');
const [core, bridge] = await Promise.all([read('model-capability-core.js'), read('model-capability-bridge.js')]);

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1/',
  runScripts: 'outside-only',
});
const { window } = dom;
Object.assign(globalThis, {
  window,
  document: window.document,
  Event: window.Event,
});

const modelOptions = {
  provider: 'newapi',
  model: 'MiniMax-M3',
  providers: [{
    slug: 'newapi',
    name: 'New API',
    authenticated: true,
    models: ['MiniMax-M3', 'gpt-proxy'],
    capabilities: {
      // Deliberately contradictory metadata proves the native execution
      // constraint wins over a stale/unsafe editable declaration.
      'MiniMax-M3': {
        reasoning: {
          supported: true,
          control: 'toggle_effort',
          can_disable: true,
          options: ['low', 'high'],
        },
      },
      'gpt-proxy': { reasoning: true },
    },
  }],
};

const hermesConfig = {
  providers: {
    newapi: {
      api: 'https://newapi.invalid/v1',
      models: {
        'MiniMax-M3': {
          hws_native_reasoning: 'minimax_openai',
          hws_reasoning: {
            supports_reasoning: true,
            can_disable_reasoning: true,
            reasoning_control: 'toggle_effort',
            reasoning_efforts: ['none', 'low', 'high'],
          },
        },
        'gpt-proxy': {
          hws_reasoning: {
            supports_reasoning: true,
            can_disable_reasoning: true,
            reasoning_control: 'toggle_effort',
            reasoning_efforts: ['none', 'low', 'high', 'xhigh'],
          },
        },
      },
    },
  },
};

window.__HERMES_PLUGIN_SDK__ = {
  React,
  buildWsUrl: async () => 'ws://127.0.0.1/api/ws',
  fetchJSON: async (url) => {
    if (url.startsWith('/api/model/options')) return modelOptions;
    if (url === '/api/config') return hermesConfig;
    return {};
  },
};

window.eval(core);
window.eval(bridge);
const api = window.__HERMES_WORKER_STUDIO_MODEL_CAPABILITIES__;

const enriched = api.enrichModelOptions(modelOptions, hermesConfig);
const minimax = api._internal.descriptor(enriched, 'newapi', 'MiniMax-M3');
assert.equal(minimax.supported, true);
assert.equal(minimax.control, 'fixed');
assert.equal(minimax.canDisable, false);
assert.deepEqual(minimax.efforts, []);
assert.equal(minimax.source, 'hermes.provider_config.model+native.minimax_openai');
assert.equal(
  enriched.providers[0].capabilities['MiniMax-M3'].reasoning_efforts,
  undefined,
  'static adaptive native execution must not expose an effort ladder',
);
assert.throws(
  () => api.validateReasoning(enriched, 'newapi', 'MiniMax-M3', 'none'),
  /does not explicitly allow disabling/,
  'MiniMax native adaptive-on execution must not expose an executable off state',
);
assert.throws(
  () => api.validateReasoning(enriched, 'newapi', 'MiniMax-M3', 'high'),
  /does not explicitly allow reasoning value/,
  'MiniMax native adaptive-on execution must not expose fake effort states',
);

const gpt = api._internal.descriptor(enriched, 'newapi', 'gpt-proxy');
assert.equal(gpt.control, 'toggle_effort');
assert.equal(gpt.canDisable, true);
assert.equal(gpt.source, 'hermes.provider_config.model');
assert.deepEqual(gpt.efforts.map((x) => x.value), ['low', 'high', 'xhigh']);

await api._runtime.ensureModelOptions();
const gptRoute = await api._runtime.sourceRoute({
  provider: 'newapi',
  model: 'gpt-proxy',
  model_options: { reasoning_effort: 'xhigh' },
});
assert.equal(gptRoute.reasoning, 'xhigh');
assert.equal(gptRoute.reasoning_control, 'toggle_effort');
assert.equal(gptRoute.reasoning_source, 'hermes.provider_config.model');

const minimaxRoute = await api._runtime.sourceRoute({
  provider: 'newapi',
  model: 'MiniMax-M3',
  model_options: {},
});
assert.equal(minimaxRoute.reasoning, 'auto');
assert.equal(minimaxRoute.reasoning_control, 'fixed');
assert.equal(minimaxRoute.reasoning_source, 'hermes.provider_config.model+native.minimax_openai');

console.log('Reasoning seal closure passed.');
