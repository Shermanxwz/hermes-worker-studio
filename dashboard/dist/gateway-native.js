(function () {
  'use strict';

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || typeof SDK.fetchJSON !== 'function' || typeof SDK.buildWsUrl !== 'function') {
    console.error('[hermes-worker-studio] Hermes Dashboard Plugin SDK gateway surface is unavailable');
    return;
  }

  const originalFetchJSON = SDK.fetchJSON.bind(SDK);
  const PLUGIN = '/api/plugins/hermes-worker-studio';
  const RUNS_V3 = `${PLUGIN}/hermes/runs-v3`;
  const runRoute = new RegExp(`^${PLUGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/hermes/runs/([^/?]+)(?:/(steer|stop|approval))?(?:\\?after=(\\d+))?$`);
  const contextRoute = new RegExp(`^${PLUGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/hermes/sessions/([^/?]+)/context$`);

  const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
  const runtimeByStored = new Map();
  const storedByRuntime = new Map();
  const runs = new Map();
  let gateway = null;
  let gatewayPromise = null;
  let rpcSeq = 0;

  function nowSec() { return Date.now() / 1000; }
  function jsonBody(init) {
    if (!init || init.body == null) return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body); } catch (_) { return {}; }
    }
    return init.body && typeof init.body === 'object' ? init.body : {};
  }
  function cleanDataUrl(value) {
    const text = String(value || '');
    const comma = text.indexOf(',');
    return comma >= 0 ? text.slice(comma + 1) : text;
  }
  function imageExt(dataUrl) {
    const mime = String(dataUrl || '').slice(0, 80).match(/^data:image\/([a-zA-Z0-9.+-]+);/i)?.[1]?.toLowerCase() || 'png';
    if (mime === 'jpeg') return 'jpg';
    return mime.replace(/[^a-z0-9]/g, '') || 'png';
  }
  function parseStudioInput(input) {
    if (typeof input === 'string') return { text: input, images: [] };
    const blocks = [];
    const images = [];
    const turns = Array.isArray(input) ? input : [input];
    for (const turn of turns) {
      const content = Array.isArray(turn?.content) ? turn.content : [];
      for (const part of content) {
        if (part?.type === 'text' && typeof part.text === 'string') blocks.push(part.text);
        if (part?.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
          if (typeof url === 'string' && url.startsWith('data:image/')) images.push(url);
        }
      }
    }
    return { text: blocks.join('\n').trim(), images };
  }
  function gatewayError(frame) {
    const error = new Error(frame?.error?.message || 'Hermes Gateway RPC failed');
    error.code = frame?.error?.code;
    error.data = frame?.error?.data;
    return error;
  }

  class StudioGatewayClient {
    constructor(url) {
      this.url = url;
      this.ws = null;
      this.pending = new Map();
      this.listeners = new Set();
      this.openPromise = null;
    }
    async connect() {
      if (this.ws?.readyState === WebSocket.OPEN) return;
      if (this.openPromise) return this.openPromise;
      this.openPromise = new Promise((resolve, reject) => {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { ws.close(); } catch (_) {}
          reject(new Error('Hermes Gateway WebSocket connection timed out'));
        }, 15000);
        ws.addEventListener('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        }, { once: true });
        ws.addEventListener('error', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('Hermes Gateway WebSocket connection failed'));
        }, { once: true });
        ws.addEventListener('message', (message) => this.onMessage(message.data));
        ws.addEventListener('close', () => {
          this.ws = null;
          runtimeByStored.clear();
          storedByRuntime.clear();
          for (const pending of this.pending.values()) pending.reject(new Error('Hermes Gateway WebSocket closed'));
          this.pending.clear();
        });
      }).finally(() => { this.openPromise = null; });
      return this.openPromise;
    }
    onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    async request(method, params = {}, timeout = 120000) {
      await this.connect();
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Hermes Gateway is not connected');
      const id = `hws-${++rpcSeq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Hermes Gateway request timed out: ${method}`));
        }, timeout);
        this.pending.set(id, { resolve, reject, timer });
        try {
          this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    }
    onMessage(raw) {
      let frame;
      try { frame = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch (_) { return; }
      if (frame?.id != null) {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        if (frame.error) pending.reject(gatewayError(frame));
        else pending.resolve(frame.result);
        return;
      }
      if (frame?.method === 'event' && frame.params?.type) {
        for (const listener of this.listeners) {
          try { listener(frame.params); } catch (error) { console.error('[hermes-worker-studio] gateway event handler failed', error); }
        }
      }
    }
  }

  async function getGateway() {
    if (gateway) {
      await gateway.connect();
      return gateway;
    }
    if (!gatewayPromise) {
      gatewayPromise = (async () => {
        const url = await SDK.buildWsUrl('/api/ws');
        const client = new StudioGatewayClient(url);
        client.onEvent(onGatewayEvent);
        await client.connect();
        gateway = client;
        return client;
      })().finally(() => { gatewayPromise = null; });
    }
    return gatewayPromise;
  }

  async function ensureRuntime(storedSessionId) {
    const stored = String(storedSessionId || '').trim();
    if (!stored) throw new Error('Hermes stored session id is required');
    const existing = runtimeByStored.get(stored);
    if (existing) return existing;
    const gw = await getGateway();
    const resumed = await gw.request('session.resume', { session_id: stored, source: 'hermes_browser', omit_messages: true });
    const runtime = String(resumed?.session_id || '').trim();
    if (!runtime) throw new Error('Hermes Gateway did not return a runtime session id');
    runtimeByStored.set(stored, runtime);
    storedByRuntime.set(runtime, stored);
    if (resumed?.todo_state) seedTodoForRuntime(runtime, resumed.todo_state);
    return runtime;
  }

  function eventData(payload) {
    return payload && typeof payload === 'object' ? payload : {};
  }
  function addRunEvent(run, event, data = {}, at = nowSec()) {
    const row = { seq: ++run.seq, event, data, at };
    run.events.push(row);
    if (run.events.length > 10000) run.events.splice(0, run.events.length - 10000);
    run.last_seq = row.seq;
    return row;
  }
  function runPublic(run, after = 0) {
    return {
      id: run.id,
      run_id: run.id,
      session_id: run.storedSessionId,
      status: run.status,
      started_at: run.started_at,
      ended_at: run.ended_at,
      last_seq: run.last_seq,
      events: run.events.filter((event) => event.seq > after),
      source: 'hermes_gateway_jsonrpc',
      transport: 'official_gateway_websocket',
    };
  }
  function activeRunForRuntime(runtimeId) {
    let found = null;
    for (const run of runs.values()) {
      if (run.runtimeId === runtimeId && !TERMINAL.has(run.status)) found = run;
    }
    return found;
  }
  function seedTodoForRuntime(runtimeId, payload) {
    const run = activeRunForRuntime(runtimeId);
    if (run) addRunEvent(run, 'todo.updated', eventData(payload));
  }
  async function refreshOfficialUsage(run) {
    if (!run || TERMINAL.has(run.status) === false && run.status !== 'running' && run.status !== 'waiting_for_approval') return;
    try {
      const gw = await getGateway();
      const usage = await gw.request('session.usage', { session_id: run.runtimeId }, 30000);
      addRunEvent(run, 'context.snapshot', {
        ...eventData(usage),
        compression_count: usage?.compressions,
        source: 'hermes.gateway.session.usage',
        measurement: 'Hermes Gateway',
      });
    } catch (_) {}
  }

  function onGatewayEvent(event) {
    const runtime = String(event?.session_id || '');
    if (!runtime) return;
    const run = activeRunForRuntime(runtime);
    if (!run) return;
    const type = String(event.type || '');
    const payload = eventData(event.payload);
    const at = Number(event.timestamp || event.at || nowSec());

    if (type === 'message.start') addRunEvent(run, 'run.message_started', payload, at);
    else if (type === 'message.delta') addRunEvent(run, 'assistant.delta', payload, at);
    else if (type === 'reasoning.available') addRunEvent(run, 'reasoning.available', payload, at);
    else if (type === 'thinking.delta' || type === 'reasoning.delta') addRunEvent(run, type, payload, at);
    else if (type === 'tool.start') addRunEvent(run, 'tool.started', payload, at);
    else if (type === 'tool.progress') addRunEvent(run, 'tool.progress', payload, at);
    else if (type === 'tool.complete') addRunEvent(run, 'tool.completed', payload, at);
    else if (type === 'todo.updated') addRunEvent(run, 'todo.updated', payload, at);
    else if (type === 'approval.request') {
      run.approval = payload;
      run.status = 'waiting_for_approval';
      addRunEvent(run, 'approval.request', payload, at);
    } else if (type === 'status.update') {
      const kind = String(payload.kind || '').toLowerCase();
      if (kind === 'compacting' || kind === 'compacted') {
        addRunEvent(run, 'context.compaction', { ...payload, kind, source: 'hermes.gateway.status.update' }, at);
        if (kind === 'compacted') void refreshOfficialUsage(run);
      } else {
        addRunEvent(run, 'status.update', payload, at);
      }
    } else if (type === 'session.usage') {
      addRunEvent(run, 'context.snapshot', { ...payload, compression_count: payload.compressions, source: 'hermes.gateway.session.usage' }, at);
    } else if (type.startsWith('subagent.') || type.startsWith('delegation.')) addRunEvent(run, type, payload, at);
    else if (type === 'error') {
      run.status = 'failed';
      run.ended_at = nowSec();
      addRunEvent(run, 'run.failed', payload, at);
      void refreshOfficialUsage(run);
    } else if (type === 'message.complete') {
      addRunEvent(run, 'message.complete', payload, at);
      run.status = 'completed';
      run.ended_at = nowSec();
      addRunEvent(run, 'run.completed', { source: 'hermes.gateway.message.complete' }, at);
      void refreshOfficialUsage(run);
    } else {
      addRunEvent(run, type, payload, at);
    }
  }

  async function startGatewayRun(body) {
    const storedSessionId = String(body?.session_id || '').trim();
    if (!storedSessionId) throw new Error('session_id is required');
    const runtimeId = await ensureRuntime(storedSessionId);
    const parsed = parseStudioInput(body?.input);
    const gw = await getGateway();

    for (let i = 0; i < parsed.images.length; i += 1) {
      const dataUrl = parsed.images[i];
      const ext = imageExt(dataUrl);
      await gw.request('image.attach_bytes', {
        session_id: runtimeId,
        content_base64: cleanDataUrl(dataUrl),
        filename: `worker-studio-${Date.now()}-${i + 1}.${ext}`,
      });
    }

    const run = {
      id: `gw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      storedSessionId,
      runtimeId,
      status: 'running',
      started_at: nowSec(),
      ended_at: null,
      seq: 0,
      last_seq: 0,
      events: [],
      approval: null,
    };
    runs.set(run.id, run);
    addRunEvent(run, 'run.started', { source: 'hermes.gateway.prompt.submit' });
    await refreshOfficialUsage(run);
    const text = parsed.text || (parsed.images.length ? '请查看我刚刚附加的图片。' : '');
    if (!text) throw new Error('Hermes prompt cannot be empty');
    await gw.request('prompt.submit', { session_id: runtimeId, text }, 30000);
    return runPublic(run, 0);
  }

  async function getOfficialContext(storedSessionId) {
    try {
      const runtimeId = await ensureRuntime(storedSessionId);
      const gw = await getGateway();
      const usage = await gw.request('session.usage', { session_id: runtimeId }, 30000);
      let breakdown = null;
      try { breakdown = await gw.request('session.context_breakdown', { session_id: runtimeId }, 30000); } catch (_) {}
      return {
        available: Boolean(usage || breakdown),
        source: 'hermes.gateway.session.usage',
        measurement: 'Hermes Gateway',
        context_used: usage?.context_used ?? breakdown?.context_used ?? null,
        context_max: usage?.context_max ?? breakdown?.context_max ?? null,
        context_percent: usage?.context_percent ?? breakdown?.context_percent ?? null,
        compression_count: usage?.compressions ?? breakdown?.compressions ?? null,
        threshold_tokens: breakdown?.threshold_tokens ?? breakdown?.compression_threshold_tokens ?? null,
        compression_threshold_percent: breakdown?.threshold_percent ?? breakdown?.compression_threshold_percent ?? null,
        compression_enabled: breakdown?.compression_enabled ?? true,
        categories: Array.isArray(breakdown?.categories) ? breakdown.categories : [],
        model: usage?.model ?? breakdown?.model ?? null,
      };
    } catch (error) {
      return { available: false, source: 'hermes.gateway.unavailable', error: error?.message || String(error) };
    }
  }

  async function handleRunRoute(path, init, match) {
    const runId = decodeURIComponent(match[1]);
    const action = match[2] || '';
    const after = Number(match[3] || 0);
    const run = runs.get(runId);
    if (!run) throw new Error(`Hermes Gateway run not found: ${runId}`);
    const gw = await getGateway();
    const body = jsonBody(init);
    if (!action) return runPublic(run, after);
    if (action === 'steer') {
      const text = String(body.input || body.text || '').trim();
      if (!text) throw new Error('steer text is required');
      const result = await gw.request('session.steer', { session_id: run.runtimeId, text });
      addRunEvent(run, 'run.steered', { text, ...eventData(result) });
      return { ok: true, ...eventData(result) };
    }
    if (action === 'stop') {
      const result = await gw.request('session.interrupt', { session_id: run.runtimeId });
      run.status = 'interrupted';
      run.ended_at = nowSec();
      addRunEvent(run, 'run.interrupted', { source: 'hermes.gateway.session.interrupt' });
      return { ok: true, ...eventData(result) };
    }
    if (action === 'approval') {
      const choice = String(body.choice || 'deny').toLowerCase();
      const requestId = run.approval?.request_id || run.approval?.id;
      const result = await gw.request('approval.respond', {
        session_id: run.runtimeId,
        request_id: requestId,
        choice,
      });
      run.status = 'running';
      addRunEvent(run, 'approval.resolved', { choice, request_id: requestId });
      return { ok: true, ...eventData(result) };
    }
    throw new Error(`Unsupported Hermes Gateway run action: ${action}`);
  }

  SDK.fetchJSON = async function gatewayNativeFetch(path, init) {
    const url = String(path || '');
    if (url === RUNS_V3 && String(init?.method || 'GET').toUpperCase() === 'POST') {
      return startGatewayRun(jsonBody(init));
    }
    const contextMatch = url.match(contextRoute);
    if (contextMatch) return getOfficialContext(decodeURIComponent(contextMatch[1]));
    const runMatch = url.match(runRoute);
    if (runMatch) return handleRunRoute(url, init, runMatch);
    return originalFetchJSON(path, init);
  };

  window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__ = {
    protocol: 'tui_gateway_jsonrpc_websocket',
    chat: 'prompt.submit',
    context: ['session.usage', 'session.context_breakdown'],
    compact: ['status.update:compacting', 'status.update:compacted'],
    plan: 'todo.updated',
    stop: 'session.interrupt',
    steer: 'session.steer',
    approval: 'approval.respond',
    attachments: 'image.attach_bytes',
  };

  const current = document.currentScript || [...document.scripts].reverse().find((script) => /gateway-native\.js(?:\?|$)/.test(script.src));
  if (!current?.src) {
    console.error('[hermes-worker-studio] cannot resolve Product 3 UI entry');
    return;
  }
  const script = document.createElement('script');
  script.src = new URL('index-v3.js', current.src).href;
  script.async = false;
  script.onerror = () => console.error('[hermes-worker-studio] failed to load Product 3 UI');
  document.head.appendChild(script);
})();
