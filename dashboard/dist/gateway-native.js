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

  const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'incomplete']);
  const runtimeByStored = new Map();
  const storedByRuntime = new Map();
  const runs = new Map();
  let gateway = null;
  let gatewayPromise = null;
  let rpcSeq = 0;
  let recoveryTimer = null;
  let recoveryAttempt = 0;
  let fullAccessCache = { at: 0, value: false };

  function nowSec() { return Date.now() / 1000; }
  function jsonBody(init) {
    if (!init || init.body == null) return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body); } catch (_) { return {}; }
    }
    return init.body && typeof init.body === 'object' ? init.body : {};
  }
  function dataUrlMime(value) {
    return String(value || '').match(/^data:([^;,]+)[;,]/i)?.[1]?.toLowerCase() || '';
  }
  function cleanDataUrl(value) {
    const text = String(value || '');
    const comma = text.indexOf(',');
    return comma >= 0 ? text.slice(comma + 1) : text;
  }
  function imageExt(dataUrl, name = '') {
    const mime = dataUrlMime(dataUrl).replace(/^image\//, '') || String(name).split('.').pop()?.toLowerCase() || 'png';
    if (mime === 'jpeg') return 'jpg';
    return mime.replace(/[^a-z0-9]/g, '') || 'png';
  }
  function basename(value, fallback = 'attachment') {
    const clean = String(value || '').replace(/\\/g, '/').split('/').pop()?.trim();
    return clean || fallback;
  }
  function classifyAttachment(dataUrl, name = '', hinted = '') {
    const hint = String(hinted || '').toLowerCase();
    const mime = dataUrlMime(dataUrl);
    const filename = basename(name, 'attachment');
    if (hint === 'image' || mime.startsWith('image/')) return 'image';
    if (hint === 'pdf' || mime === 'application/pdf' || /\.pdf$/i.test(filename)) return 'pdf';
    return 'file';
  }
  function attachmentFromPart(part, index) {
    if (!part || typeof part !== 'object') return null;
    if (part.type === 'image_url') {
      const raw = typeof part.image_url === 'string' ? { url: part.image_url } : (part.image_url || {});
      const url = raw.url;
      if (typeof url !== 'string' || !url.startsWith('data:')) return null;
      return {
        kind: classifyAttachment(url, raw.name || raw.filename || '', raw.kind),
        dataUrl: url,
        name: basename(raw.name || raw.filename, `attachment-${index + 1}`),
        mime: raw.mime_type || raw.type || dataUrlMime(url),
      };
    }
    if (part.type === 'file_url' || part.type === 'file') {
      const raw = part.file_url || part.file || part;
      const url = raw.url || raw.data_url || raw.data;
      if (typeof url !== 'string' || !url.startsWith('data:')) return null;
      return {
        kind: classifyAttachment(url, raw.name || raw.filename || '', raw.kind),
        dataUrl: url,
        name: basename(raw.name || raw.filename, `attachment-${index + 1}`),
        mime: raw.mime_type || raw.type || dataUrlMime(url),
      };
    }
    return null;
  }
  function parseStudioInput(input) {
    if (typeof input === 'string') return { text: input, attachments: [] };
    const blocks = [];
    const attachments = [];
    const turns = Array.isArray(input) ? input : [input];
    for (const turn of turns) {
      const content = Array.isArray(turn?.content) ? turn.content : [];
      for (const part of content) {
        if (part?.type === 'text' && typeof part.text === 'string') blocks.push(part.text);
        const attachment = attachmentFromPart(part, attachments.length);
        if (attachment) attachments.push(attachment);
      }
    }
    return { text: blocks.join('\n').trim(), attachments };
  }
  function gatewayError(frame) {
    const error = new Error(frame?.error?.message || 'Hermes Gateway RPC failed');
    error.code = frame?.error?.code;
    error.data = frame?.error?.data;
    return error;
  }
  function eventData(payload) {
    return payload && typeof payload === 'object' ? payload : {};
  }
  function unwrapConfig(raw) {
    return raw?.config && typeof raw.config === 'object' ? raw.config : (raw && typeof raw === 'object' ? raw : {});
  }
  async function fullAccessEnabled() {
    const now = Date.now();
    if (now - fullAccessCache.at < 1000) return fullAccessCache.value;
    try {
      const cfg = unwrapConfig(await originalFetchJSON('/api/config'));
      const approvals = cfg?.approvals || {};
      const value = approvals.mode === 'off'
        && approvals.cron_mode === 'approve'
        && approvals.single_query_mode === 'approve'
        && approvals.unattended_mode === 'approve'
        && approvals.mcp_reload_confirm === false
        && approvals.destructive_slash_confirm === false
        && cfg?.delegation?.subagent_auto_approve === true;
      fullAccessCache = { at: now, value };
      return value;
    } catch (_) {
      fullAccessCache = { at: now, value: false };
      return false;
    }
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
      reconnecting: run.status === 'reconnecting',
    };
  }
  function activeRunForRuntime(runtimeId) {
    let found = null;
    for (const run of runs.values()) {
      if (run.runtimeId === runtimeId && !TERMINAL.has(run.status)) found = run;
    }
    return found;
  }
  function activeRuns() {
    return [...runs.values()].filter((run) => !TERMINAL.has(run.status));
  }
  function bindRuntime(stored, runtime) {
    const old = runtimeByStored.get(stored);
    if (old && old !== runtime) storedByRuntime.delete(old);
    runtimeByStored.set(stored, runtime);
    storedByRuntime.set(runtime, stored);
  }
  function seedTodoForRuntime(runtimeId, payload) {
    const run = activeRunForRuntime(runtimeId);
    if (run) addRunEvent(run, 'todo.updated', eventData(payload));
  }

  class StudioGatewayClient {
    constructor(urlFactory) {
      this.urlFactory = urlFactory;
      this.ws = null;
      this.pending = new Map();
      this.listeners = new Set();
      this.openPromise = null;
    }
    async connect() {
      if (this.ws?.readyState === WebSocket.OPEN) return;
      if (this.openPromise) return this.openPromise;
      this.openPromise = new Promise((resolve, reject) => {
        let settled = false;
        let ws = null;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { ws?.close(); } catch (_) {}
          reject(new Error('Hermes Gateway WebSocket connection timed out'));
        }, 15000);
        Promise.resolve(this.urlFactory()).then((url) => {
          if (settled) return;
          ws = new WebSocket(url);
          this.ws = ws;
          ws.addEventListener('open', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            recoveryAttempt = 0;
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
            const owned = this.ws === ws;
            if (owned) this.ws = null;
            for (const pending of this.pending.values()) pending.reject(new Error('Hermes Gateway WebSocket closed'));
            this.pending.clear();
            if (owned) handleGatewayDisconnect();
          });
        }).catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
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
        const client = new StudioGatewayClient(() => SDK.buildWsUrl('/api/ws'));
        client.onEvent(onGatewayEvent);
        await client.connect();
        gateway = client;
        return client;
      })().finally(() => { gatewayPromise = null; });
    }
    return gatewayPromise;
  }

  async function resumeStored(storedSessionId, { omitMessages = true } = {}) {
    const stored = String(storedSessionId || '').trim();
    if (!stored) throw new Error('Hermes stored session id is required');
    const gw = await getGateway();
    const resumed = await gw.request('session.resume', {
      session_id: stored,
      source: 'hermes_browser',
      omit_messages: omitMessages,
      close_on_disconnect: false,
    });
    const runtime = String(resumed?.session_id || '').trim();
    if (!runtime) throw new Error('Hermes Gateway did not return a runtime session id');
    bindRuntime(stored, runtime);
    if (resumed?.todo_state) seedTodoForRuntime(runtime, resumed.todo_state);
    return { runtime, resumed };
  }
  async function ensureRuntime(storedSessionId) {
    const stored = String(storedSessionId || '').trim();
    if (!stored) throw new Error('Hermes stored session id is required');
    const existing = runtimeByStored.get(stored);
    if (existing) return existing;
    return (await resumeStored(stored, { omitMessages: true })).runtime;
  }

  async function autoResolveInput(run, type, payload) {
    if (!run || !await fullAccessEnabled()) return false;
    const gw = await getGateway();
    const requestId = String(payload?.request_id || payload?.id || '').trim();
    if (!requestId) return false;
    try {
      if (type === 'approval.request') {
        const choices = Array.isArray(payload?.choices) ? payload.choices.map((x) => String(x).toLowerCase()) : [];
        const choice = ['session', 'once', 'always'].find((x) => choices.includes(x)) || 'once';
        await gw.request('approval.respond', { session_id: run.runtimeId, request_id: requestId, choice });
        run.approval = null;
        run.status = 'running';
        addRunEvent(run, 'approval.auto_resolved', { request_id: requestId, choice, source: 'studio.full_access' });
        return true;
      }
      if (type === 'clarify.request') {
        await gw.request('clarify.respond', { request_id: requestId, answer: '' });
        run.status = 'running';
        addRunEvent(run, 'clarify.auto_skipped', { request_id: requestId, source: 'studio.full_access' });
        return true;
      }
      if (type === 'mcp.setup.request') {
        await gw.request('mcp.setup.respond', {
          request_id: requestId,
          result: JSON.stringify({ server: String(payload?.server || ''), status: 'declined' }),
        });
        run.status = 'running';
        addRunEvent(run, 'mcp.setup.auto_declined', { request_id: requestId, source: 'studio.full_access' });
        return true;
      }
      if (type === 'sudo.request') {
        await gw.request('sudo.respond', { request_id: requestId, password: '' });
        run.status = 'running';
        addRunEvent(run, 'sudo.auto_declined', { request_id: requestId, source: 'studio.full_access' });
        return true;
      }
      if (type === 'secret.request') {
        await gw.request('secret.respond', { request_id: requestId, value: '' });
        run.status = 'running';
        addRunEvent(run, 'secret.auto_declined', { request_id: requestId, source: 'studio.full_access' });
        return true;
      }
      if (type === 'terminal.read.request') {
        await gw.request('terminal.read.respond', { request_id: requestId, text: '' });
        run.status = 'running';
        addRunEvent(run, 'terminal.read.auto_eof', { request_id: requestId, source: 'studio.full_access' });
        return true;
      }
    } catch (error) {
      addRunEvent(run, 'input.auto_resolve_failed', { type, request_id: requestId, error: error?.message || String(error) });
    }
    return false;
  }

  async function reconcileResumeSnapshot(run, resumed, previousRuntime) {
    if (!run) return;
    const pendingApproval = resumed?.pending_approval && typeof resumed.pending_approval === 'object' ? resumed.pending_approval : null;
    const pendingClarify = resumed?.pending_clarify && typeof resumed.pending_clarify === 'object' ? resumed.pending_clarify : null;
    if (resumed?.todo_state) addRunEvent(run, 'todo.updated', eventData(resumed.todo_state));
    if (pendingApproval) {
      run.approval = pendingApproval;
      addRunEvent(run, 'approval.request', pendingApproval);
      const resolved = await autoResolveInput(run, 'approval.request', pendingApproval);
      if (!resolved) run.status = 'waiting_for_approval';
    }
    if (pendingClarify) {
      addRunEvent(run, 'clarify.request', pendingClarify);
      const resolved = await autoResolveInput(run, 'clarify.request', pendingClarify);
      if (!resolved) run.status = 'waiting_for_input';
    }
    const active = resumed?.running === true || resumed?.inflight === true;
    if (active && !['waiting_for_approval', 'waiting_for_input'].includes(run.status)) run.status = 'running';
    if (!active && !pendingApproval && !pendingClarify && run.promptAccepted && !TERMINAL.has(run.status)) {
      run.status = 'completed';
      run.ended_at = nowSec();
      addRunEvent(run, 'run.completed', {
        source: 'hermes.gateway.session.resume_reconciliation',
        previous_runtime: previousRuntime || null,
        message_count: resumed?.message_count ?? (Array.isArray(resumed?.messages) ? resumed.messages.length : null),
      });
    }
  }

  async function recoverRun(run) {
    const previousRuntime = run.runtimeId;
    const { runtime, resumed } = await resumeStored(run.storedSessionId, { omitMessages: false });
    run.runtimeId = runtime;
    addRunEvent(run, 'transport.reconnected', {
      source: 'hermes.gateway.session.resume',
      previous_runtime: previousRuntime || null,
      runtime,
    });
    await reconcileResumeSnapshot(run, resumed, previousRuntime);
    if (!TERMINAL.has(run.status)) await refreshOfficialUsage(run);
  }
  function scheduleRecovery() {
    if (recoveryTimer || !activeRuns().length) return;
    const delay = Math.min(5000, 250 * Math.pow(2, Math.min(recoveryAttempt, 4)));
    recoveryTimer = setTimeout(async () => {
      recoveryTimer = null;
      recoveryAttempt += 1;
      try {
        await getGateway();
        const pending = activeRuns().filter((run) => run.status === 'reconnecting');
        for (const run of pending) await recoverRun(run);
        recoveryAttempt = 0;
      } catch (error) {
        for (const run of activeRuns()) {
          if (run.status === 'reconnecting') addRunEvent(run, 'transport.reconnect_failed', { error: error?.message || String(error), attempt: recoveryAttempt });
        }
      }
      if (activeRuns().some((run) => run.status === 'reconnecting')) scheduleRecovery();
    }, delay);
  }
  function handleGatewayDisconnect() {
    runtimeByStored.clear();
    storedByRuntime.clear();
    for (const run of activeRuns()) {
      run.status = 'reconnecting';
      run.ended_at = null;
      addRunEvent(run, 'transport.reconnecting', {
        source: 'hermes.gateway.websocket',
        reason: 'gateway_websocket_closed',
      });
    }
    scheduleRecovery();
  }

  async function refreshOfficialUsage(run) {
    if (!run || TERMINAL.has(run.status) || run.status === 'reconnecting') return;
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
    else if (['approval.request', 'clarify.request', 'mcp.setup.request', 'sudo.request', 'secret.request', 'terminal.read.request'].includes(type)) {
      addRunEvent(run, type, payload, at);
      if (type === 'approval.request') run.approval = payload;
      if (type === 'approval.request') run.status = 'waiting_for_approval';
      else run.status = 'waiting_for_input';
      void autoResolveInput(run, type, payload);
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

  async function stageAttachments(gw, runtimeId, attachments) {
    const fileRefs = [];
    for (let i = 0; i < attachments.length; i += 1) {
      const item = attachments[i];
      const name = basename(item.name, `attachment-${i + 1}`);
      if (item.kind === 'image') {
        await gw.request('image.attach_bytes', {
          session_id: runtimeId,
          content_base64: cleanDataUrl(item.dataUrl),
          filename: name.includes('.') ? name : `${name}.${imageExt(item.dataUrl, name)}`,
        });
      } else if (item.kind === 'pdf') {
        await gw.request('pdf.attach', {
          session_id: runtimeId,
          content_base64: cleanDataUrl(item.dataUrl),
          filename: /\.pdf$/i.test(name) ? name : `${name}.pdf`,
        });
      } else {
        const result = await gw.request('file.attach', {
          session_id: runtimeId,
          data_url: item.dataUrl,
          name,
        });
        if (result?.ref_text) fileRefs.push(`${name} → ${result.ref_text}`);
      }
    }
    return fileRefs;
  }

  async function startGatewayRun(body) {
    const storedSessionId = String(body?.session_id || '').trim();
    if (!storedSessionId) throw new Error('session_id is required');
    const { runtime: runtimeId, resumed } = await resumeStored(storedSessionId, { omitMessages: true });
    const parsed = parseStudioInput(body?.input);
    const gw = await getGateway();
    const fileRefs = await stageAttachments(gw, runtimeId, parsed.attachments);

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
      promptAccepted: false,
      baselineMessageCount: Number(resumed?.message_count ?? 0),
    };
    runs.set(run.id, run);
    addRunEvent(run, 'run.started', { source: 'hermes.gateway.prompt.submit' });
    await refreshOfficialUsage(run);
    const attachmentOnly = parsed.attachments.length ? '请查看我刚刚附加的内容。' : '';
    const refBlock = fileRefs.length ? `\n\nAttached files staged in your session workspace:\n${fileRefs.join('\n')}` : '';
    const text = (parsed.text || attachmentOnly) + refBlock;
    if (!text.trim()) throw new Error('Hermes prompt cannot be empty');
    await gw.request('prompt.submit', { session_id: runtimeId, text }, 30000);
    run.promptAccepted = true;
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

  async function ensureRunRuntime(run) {
    if (run.status !== 'reconnecting' && run.runtimeId && storedByRuntime.get(run.runtimeId) === run.storedSessionId) return run.runtimeId;
    await recoverRun(run);
    if (!run.runtimeId) throw new Error('Hermes runtime session could not be recovered');
    return run.runtimeId;
  }
  async function handleRunRoute(path, init, match) {
    const runId = decodeURIComponent(match[1]);
    const action = match[2] || '';
    const after = Number(match[3] || 0);
    const run = runs.get(runId);
    if (!run) throw new Error(`Hermes Gateway run not found: ${runId}`);
    const body = jsonBody(init);
    if (!action) return runPublic(run, after);
    const runtimeId = await ensureRunRuntime(run);
    const gw = await getGateway();
    if (action === 'steer') {
      const text = String(body.input || body.text || '').trim();
      if (!text) throw new Error('steer text is required');
      const result = await gw.request('session.steer', { session_id: runtimeId, text });
      addRunEvent(run, 'run.steered', { text, ...eventData(result) });
      return { ok: true, ...eventData(result) };
    }
    if (action === 'stop') {
      const result = await gw.request('session.interrupt', { session_id: runtimeId });
      run.status = 'interrupted';
      run.ended_at = nowSec();
      addRunEvent(run, 'run.interrupted', { source: 'hermes.gateway.session.interrupt' });
      return { ok: true, ...eventData(result) };
    }
    if (action === 'approval') {
      const choice = String(body.choice || 'deny').toLowerCase();
      const requestId = run.approval?.request_id || run.approval?.id;
      const result = await gw.request('approval.respond', {
        session_id: runtimeId,
        request_id: requestId,
        choice,
      });
      run.status = 'running';
      run.approval = null;
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

  function baseHref(path) {
    const base = String(window.__HERMES_BASE_PATH__ || '').replace(/\/$/, '');
    return `${base}${path}`;
  }
  function registerNativeReturnSlots() {
    const registry = window.__HERMES_PLUGINS__;
    const React = SDK.React;
    if (!registry || typeof registry.registerSlot !== 'function' || !React?.createElement) return;
    const h = React.createElement;
    function NativeReturn() {
      const path = String(window.location?.pathname || '');
      if (path === '/' || path.endsWith('/worker-studio')) return null;
      return h('a', {
        href: baseHref('/'),
        className: 'hws3-return-slot',
        title: '返回 Hermes Worker Studio',
        style: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
      }, '← Worker Studio');
    }
    registry.registerSlot('hermes-worker-studio', 'header-left', NativeReturn);
    registry.registerSlot('hermes-worker-studio', 'sidebar', NativeReturn);
  }
  registerNativeReturnSlots();

  window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__ = {
    protocol: 'tui_gateway_jsonrpc_websocket',
    chat: 'prompt.submit',
    reconnect: 'session.resume(close_on_disconnect=false)',
    context: ['session.usage', 'session.context_breakdown'],
    compact: ['status.update:compacting', 'status.update:compacted'],
    plan: 'todo.updated',
    stop: 'session.interrupt',
    steer: 'session.steer',
    approval: 'approval.respond',
    unattended_input: ['clarify.respond', 'mcp.setup.respond', 'sudo.respond', 'secret.respond', 'terminal.read.respond'],
    attachments: ['image.attach_bytes', 'pdf.attach', 'file.attach'],
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
