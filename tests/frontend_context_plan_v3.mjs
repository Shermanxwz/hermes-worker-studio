import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await fs.readFile(path.join(rootDir, 'dashboard/dist/index-v3.js'), 'utf8');
const sealedCss = await fs.readFile(path.join(rootDir, 'dashboard/dist/product-sealed.css'), 'utf8');
assert.match(sealedCss, /hws3-context-meter/);
assert.match(sealedCss, /hws3-context-spin/);
assert.match(sealedCss, /hws3-plan-summary/);
assert.match(sealedCss, /prefers-reduced-motion/);
assert.match(sealedCss, /@media\(max-width:540px\)/);

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:19119/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLFormElement', 'File', 'FileReader', 'Event', 'MouseEvent']) globalThis[name] = window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.__HERMES_BASE_PATH__ = '';
window.requestAnimationFrame = (fn) => { fn(Date.now()); return 1; };
globalThis.requestAnimationFrame = window.requestAnimationFrame;
window.HTMLElement.prototype.scrollTo = function scrollTo({ top = 0 } = {}) { this.scrollTop = top; };
window.alert = (message) => { throw new Error(`unexpected alert: ${message}`); };
window.confirm = () => true;
globalThis.alert = window.alert;
globalThis.confirm = window.confirm;

const { createRoot } = await import('react-dom/client');
let Registered = null;
let pollCount = 0;
let finalContext = false;
let latestRunBody = null;
const session = { id: 'session-1', title: 'Official Context Session', model: 'main-model', archived: false, last_active: 1788138000 };
const config = {
  plugins: { entries: { 'hermes-worker-studio': { settings: { mode: 'AUTO' } } } },
  approvals: { mode: 'smart', cron_mode: 'approve', single_query_mode: 'approve', unattended_mode: 'approve', mcp_reload_confirm: true, destructive_slash_confirm: true },
  delegation: { subagent_auto_approve: false },
};
const modelOptions = {
  provider: 'official', model: 'main-model',
  providers: [{
    slug: 'official', name: 'Official', authenticated: true, is_current: true,
    models: ['main-model'],
    capabilities: { 'main-model': { context_window: 128000, reasoning_efforts: ['balanced', 'deep'] } },
  }],
};
function bodyOf(init) { return init?.body ? JSON.parse(init.body) : null; }
function contextPayload() {
  return finalContext
    ? { available: true, context_used: 28000, context_max: 128000, context_percent: 21.88, threshold_tokens: 96000, compression_threshold_percent: 75, remaining_tokens: 68000, compression_count: 2, compression_enabled: true, compacted: true, source: 'hermes_session_context_api' }
    : { available: true, context_used: 32400, context_max: 128000, context_percent: 25.31, threshold_tokens: 96000, compression_threshold_percent: 75, remaining_tokens: 63600, compression_count: 1, compression_enabled: true, compacted: false, source: 'hermes_session_context_api' };
}
async function responseFor(url, init = {}) {
  const method = init.method || 'GET';
  const body = bodyOf(init);
  if (url === '/api/sessions?limit=20&offset=0&order=recent&archived=exclude') return { sessions: [session], total: 1 };
  if (url === '/api/config') return { config };
  if (url === '/api/model/options') return modelOptions;
  if (url === '/api/skills') return { skills: [] };
  if (url === '/api/plugins/hermes-worker-studio/health') return { ok: true };
  if (url === '/api/sessions/session-1/messages?limit=80&order=latest') return { messages: [{ id: 'm1', role: 'assistant', content: 'Ready.' }] };
  if (url === '/api/plugins/hermes-worker-studio/hermes/sessions/session-1/context') return contextPayload();
  if (url === '/api/plugins/hermes-worker-studio/hermes/sessions/session-1/model') return { ok: true };
  if (url === '/api/plugins/hermes-worker-studio/hermes/runs-v3') {
    latestRunBody = body;
    pollCount = 0;
    finalContext = false;
    return { id: 'run-context', session_id: 'session-1', status: 'running', started_at: 1000, context: contextPayload() };
  }
  if (url.startsWith('/api/plugins/hermes-worker-studio/hermes/runs/run-context?after=')) {
    pollCount += 1;
    if (pollCount === 1) return {
      id: 'run-context', session_id: 'session-1', status: 'running', started_at: 1000, elapsed_ms: 500, last_seq: 4,
      events: [
        { seq: 1, event: 'run.started', data: {}, at: 1000 },
        { seq: 2, event: 'todo.updated', data: { revision: 3, todos: [
          { id: 'a', content: 'Inspect official context', status: 'completed', detail: 'Read Hermes telemetry' },
          { id: 'b', content: 'Finish sealed UI', status: 'in_progress', detail: 'Verify desktop and mobile presentation' },
        ] }, at: 1000.1 },
        { seq: 3, event: 'context.snapshot', data: { available: true, context_used: 90000, context_max: 128000, context_percent: 70.31, threshold_tokens: 96000, remaining_tokens: 6000, compression_count: 1, compression_enabled: true, source: 'hermes_session_context_api' }, at: 1000.2 },
        { seq: 4, event: 'context.compaction', data: { kind: 'compacting', message: 'Compacting conversation context…' }, at: 1000.3 },
      ],
    };
    finalContext = true;
    return {
      id: 'run-context', session_id: 'session-1', status: 'completed', started_at: 1000, ended_at: 1001, elapsed_ms: 1000, last_seq: 7,
      events: [
        { seq: 5, event: 'context.compaction', data: { kind: 'compacted', message: 'Context compacted' }, at: 1000.7 },
        { seq: 6, event: 'context.snapshot', data: contextPayload(), at: 1000.8 },
        { seq: 7, event: 'run.completed', data: { usage: { context: contextPayload() } }, at: 1001 },
      ],
    };
  }
  if (url.startsWith('/api/sessions/search?')) return { results: [session] };
  if (url.startsWith('/api/sessions?limit=30')) return { sessions: [session], total: 1 };
  if (url === '/api/providers/custom-endpoints') return { endpoints: [] };
  throw new Error(`Unhandled fetchJSON call: ${method} ${url}`);
}

window.__HERMES_PLUGIN_SDK__ = {
  sdkVersion: '1', React,
  hooks: { useState: React.useState, useEffect: React.useEffect, useCallback: React.useCallback, useMemo: React.useMemo, useRef: React.useRef, useContext: React.useContext, createContext: React.createContext },
  fetchJSON: responseFor,
  authedFetch: async () => { throw new Error('not used'); }, buildWsUrl: async () => '', buildWsAuthParam: async () => ['', ''], api: {}, components: {}, utils: {}, useI18n: () => ({}),
};
window.__HERMES_PLUGINS__ = { register(name, component) { assert.equal(name, 'hermes-worker-studio'); Registered = component; }, registerSlot() {} };
window.eval(bundle);
assert.ok(Registered);
const root = createRoot(window.document.getElementById('root'));
await act(async () => { root.render(React.createElement(Registered)); });

async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check, label, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await act(async () => { await sleep(20); });
    if (check()) return;
  }
  throw new Error(`waitFor ${label} timed out`);
}
async function click(el) { assert.ok(el); await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); }
function setValue(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

await waitFor(() => window.document.querySelector('.hws3-session-row'), 'recent session');
await click(window.document.querySelector('.hws3-session-row'));
await waitFor(() => window.document.querySelector('.hws3-context-meter')?.textContent.includes('32.4K / 128K · 25%'), 'official context meter');
await click(window.document.querySelector('.hws3-context-meter'));
assert.match(window.document.querySelector('.hws3-context-popover').textContent, /Hermes 官方遥测/);
assert.match(window.document.querySelector('.hws3-context-popover').textContent, /96K · 75%/);
assert.match(window.document.querySelector('.hws3-context-popover').textContent, /Hermes Auto Compact/);

const composer = window.document.querySelector('.hws3-composer textarea');
setValue(composer, 'Execute official plan and compact context');
await act(async () => { window.document.querySelector('.hws3-composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
await waitFor(() => latestRunBody?.session_id === 'session-1', 'official run start');
await waitFor(() => window.document.querySelector('.hws3-plan-summary')?.textContent.includes('已完成 1 / 2'), 'plan summary counts');
assert.equal(window.document.querySelector('.hws3-plan-list'), null, 'plan details start collapsed');
await click(window.document.querySelector('.hws3-plan-summary'));
assert.match(window.document.querySelector('.hws3-plan-list').textContent, /Inspect official context/);
assert.match(window.document.querySelector('.hws3-plan-list').textContent, /Verify desktop and mobile presentation/);
await waitFor(() => window.document.querySelector('.hws3-context-meter')?.classList.contains('compacting'), 'official compact animation');
assert.match(window.document.querySelector('.hws3-context-meter').textContent, /正在压缩上下文/);
await waitFor(() => pollCount >= 2, 'run completion');
await waitFor(() => window.document.querySelector('.hws3-context-meter')?.textContent.includes('28K / 128K · 22%'), 'context restored after compact', 6000);
assert.equal(latestRunBody.provider, 'official');
assert.equal(latestRunBody.model, 'main-model');

console.log('frontend official context/compact + canonical plan runtime passed');
