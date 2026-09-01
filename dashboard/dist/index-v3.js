(function () {
  'use strict';

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) {
    console.error('[hermes-worker-studio] Hermes Dashboard Plugin SDK is unavailable');
    return;
  }

  const React = SDK.React;
  const h = React.createElement;
  const { useCallback, useEffect, useMemo, useRef, useState } = SDK.hooks;
  const fetchJSON = SDK.fetchJSON;
  const PLUGIN = '/api/plugins/hermes-worker-studio';
  const RECENT_LIMIT = 20;
  const CHAT_MESSAGE_LIMIT = 80;
  const HISTORY_SESSION_LIMIT = 30;
  const HISTORY_MESSAGE_LIMIT = 100;
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'incomplete', 'cancelled', 'canceled', 'stopped', 'interrupted']);
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);

  const PRIMARY_NAV = [
    ['chat', '对话', '✦'],
    ['worker', 'Worker', '⇄'],
    ['models', '模型', '◫'],
    ['unattended', '完全访问', '⚡'],
    ['history', '完整历史', '☷'],
  ];
  const HERMES_PRIMARY = [
    ['/skills', '技能', '◇'],
    ['/plugins', '插件', '⬡'],
    ['/mcp', 'MCP', '⌘'],
  ];
  const HERMES_ADVANCED = [
    ['/sessions', '原生 Dashboard · 会话'],
    ['/cron', '自动化 / Cron'],
    ['/profiles', 'Profiles'],
    ['/analytics', 'Analytics'],
    ['/logs', 'Logs'],
    ['/config', 'Config'],
    ['https://github.com/NousResearch/hermes-agent/tree/main/website/docs', '官方文档'],
  ];

  const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#082a27"/><path d="M18 13h28v7H35v31h-7V20H18z" fill="#f2dfbb"/><path d="M14 34c8-10 28-10 36 0-8-3-13-2-18 2-5-4-10-5-18-2z" fill="#2b9c8e"/><circle cx="32" cy="36" r="5" fill="#f2dfbb"/><path d="M12 45c7 1 12 4 16 9M52 45c-7 1-12 4-16 9" stroke="#2b9c8e" stroke-width="4" stroke-linecap="round"/></svg>';

  function jinit(method, body) {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  }
  function api(path, init) { return fetchJSON(path, init); }
  function plugin(path, init) { return fetchJSON(PLUGIN + path, init); }
  function baseHref(path) {
    if (/^https?:\/\//.test(path)) return path;
    const base = String(window.__HERMES_BASE_PATH__ || '').replace(/\/$/, '');
    return base + path;
  }
  function errorText(error) {
    const text = error && error.message ? error.message : String(error || 'Unknown error');
    return text.replace(/^\d+:\s*/, '').slice(0, 2400);
  }
  function shortText(value, max = 120) {
    const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    const one = text.replace(/\s+/g, ' ').trim();
    return one.length > max ? one.slice(0, max - 1) + '…' : one;
  }
  function clone(value) { return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : {}; }
  function unwrapConfig(raw) { return raw?.config && typeof raw.config === 'object' ? raw.config : (raw && typeof raw === 'object' ? raw : {}); }
  function fmtTime(value) {
    if (!value) return '';
    const n = Number(value);
    const date = Number.isFinite(n) ? new Date(n > 1e12 ? n : n * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDuration(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (total < 60) return `${total}秒`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return `${m}分${s ? `${s}秒` : ''}`;
    return `${Math.floor(m / 60)}小时${m % 60}分`;
  }
  function sessionTitle(session) { return session?.title || session?.preview || session?.id || '未命名对话'; }
  function getSessionId(payload) { return payload?.session?.id || payload?.session_id || payload?.id || null; }

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function ensureBranding() {
    const href = `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`;
    let icon = document.querySelector('link[data-hws-favicon]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      icon.setAttribute('data-hws-favicon', '1');
      document.head.appendChild(icon);
    }
    icon.href = href;
    document.title = 'Hermes Worker Studio';
  }

  function studioMode(cfg) {
    const raw = String(cfg?.plugins?.entries?.['hermes-worker-studio']?.settings?.mode || 'AUTO').toUpperCase();
    return raw === 'WORKER' ? 'DELEGATE' : ['OFFICIAL', 'AUTO', 'DELEGATE', 'MAIN'].includes(raw) ? raw : 'MAIN';
  }
  function studioSettings(cfg) { return cfg?.plugins?.entries?.['hermes-worker-studio']?.settings || {}; }
  function withStudioSettings(cfg, patch) {
    const next = clone(cfg);
    next.plugins = { ...(next.plugins || {}) };
    next.plugins.entries = { ...(next.plugins.entries || {}) };
    const old = next.plugins.entries['hermes-worker-studio'] || {};
    next.plugins.entries['hermes-worker-studio'] = { ...old, settings: { ...(old.settings || {}), ...patch } };
    return next;
  }
  function withStudioMode(cfg, mode) { return withStudioSettings(cfg, { mode }); }
  function unattendedReady(cfg) {
    const a = cfg?.approvals || {};
    return a.mode === 'off'
      && a.cron_mode === 'approve'
      && a.single_query_mode === 'approve'
      && a.unattended_mode === 'approve'
      && a.mcp_reload_confirm === false
      && a.destructive_slash_confirm === false
      && cfg?.delegation?.subagent_auto_approve === true;
  }

  function providerRows(options) { return Array.isArray(options?.providers) ? options.providers : []; }
  function providerBySlug(options, slug) { return providerRows(options).find((p) => p.slug === slug || (Array.isArray(p.aliases) && p.aliases.includes(slug))); }
  function modelsFor(options, slug) { return Array.isArray(providerBySlug(options, slug)?.models) ? providerBySlug(options, slug).models : []; }
  function authenticatedProviders(options) {
    const rows = providerRows(options).filter((p) => p.authenticated !== false && Array.isArray(p.models) && p.models.length);
    return rows.length ? rows : providerRows(options).filter((p) => Array.isArray(p.models) && p.models.length);
  }
  function defaultRoute(options) {
    const rows = authenticatedProviders(options);
    let row = providerBySlug(options, String(options?.provider || ''));
    if (!row || !row.models?.length) row = rows.find((x) => x.is_current) || rows[0];
    const provider = row?.slug || '';
    const models = Array.isArray(row?.models) ? row.models : [];
    const model = models.includes(options?.model) ? options.model : (models[0] || '');
    return { provider, model, effort: 'auto' };
  }
  function modelCapability(options, provider, model) { return providerBySlug(options, provider)?.capabilities?.[model] || {}; }
  function reasoningOptions(options, provider, model) {
    const cap = modelCapability(options, provider, model);
    const candidates = [cap?.reasoning?.options, cap?.reasoning_efforts, cap?.reasoningEfforts, cap?.supported_reasoning_efforts, cap?.supportedReasoningEfforts];
    const exact = [];
    for (const values of candidates) {
      if (!Array.isArray(values)) continue;
      for (const item of values) {
        const value = typeof item === 'string' ? item : item?.value;
        if (value && value !== 'auto' && !exact.some((x) => x.value === String(value))) exact.push({ value: String(value), description: typeof item === 'object' ? String(item.description || '') : '' });
      }
    }
    return [{ value: 'auto', description: '使用 Hermes/provider 默认值' }, ...exact];
  }
  function normalizeRoute(options, route) {
    const fallback = defaultRoute(options);
    const provider = providerBySlug(options, route?.provider)?.slug || fallback.provider;
    const models = modelsFor(options, provider);
    const model = models.includes(route?.model) ? route.model : (models[0] || fallback.model);
    const efforts = reasoningOptions(options, provider, model).map((x) => x.value);
    const effort = efforts.includes(route?.effort) ? route.effort : 'auto';
    return { provider, model, effort };
  }

  function skillsArray(payload) { return Array.isArray(payload) ? payload : Array.isArray(payload?.skills) ? payload.skills : []; }
  function skillKey(skill) { return String(skill?.name || skill?.id || skill?.path || '').trim(); }
  function diffSkills(before, after) {
    const left = new Map(skillsArray(before).map((x) => [skillKey(x), x]).filter(([key]) => key));
    const right = new Map(skillsArray(after).map((x) => [skillKey(x), x]).filter(([key]) => key));
    return {
      added: [...right.keys()].filter((key) => !left.has(key)),
      removed: [...left.keys()].filter((key) => !right.has(key)),
      toggled: [...right.keys()].filter((key) => left.has(key) && Boolean(left.get(key)?.enabled) !== Boolean(right.get(key)?.enabled)),
    };
  }

  function deltaText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    for (const key of ['delta', 'text', 'content', 'output_text']) if (typeof data[key] === 'string') return data[key];
    return '';
  }
  function toolName(data) { return data?.tool_name || data?.tool || data?.name || data?.function?.name || data?.tool_call?.function?.name || 'tool'; }
  function eventSummary(event) {
    const name = String(event?.event || 'event');
    const data = event?.data || {};
    if (name === 'run.started') return 'Hermes Run 开始';
    if (name === 'run.completed') return '任务执行完成';
    if (['run.failed', 'run.error'].includes(name)) return '任务执行失败';
    if (['run.cancelled', 'run.canceled', 'run.stopped', 'run.interrupted'].includes(name)) return '任务已停止';
    if (name === 'tool.started') return `执行工具 · ${toolName(data)}`;
    if (name === 'tool.completed') return `工具完成 · ${toolName(data)}`;
    if (name === 'tool.failed') return `工具失败 · ${toolName(data)}`;
    if (name.includes('todo')) return '官方计划更新';
    if (name === 'context.compaction') return `上下文 · ${String(data?.kind || 'compact')}`;
    if (name === 'context.snapshot') return '上下文遥测更新';
    if (name.includes('approval')) return '需要确认';
    if (name.includes('subagent') || name.includes('delegat')) return `子代理 · ${name}`;
    return name;
  }
  function eventDetail(event) {
    const data = event?.data || {};
    const name = String(event?.event || '');
    if (name === 'tool.started') return shortText(data.arguments || data.args || data.preview || data.input || '', 320);
    if (name === 'tool.completed' || name === 'tool.failed') return shortText(data.result || data.output || data.error || data.preview || '', 320);
    if (name === 'context.compaction') return shortText(data.message || data.detail || '', 320);
    if (name.includes('subagent')) return shortText(data.summary || data.goal || data.preview || '', 320);
    if (name.includes('error') || name.includes('failed')) return shortText(data.error || data.message || data, 360);
    return '';
  }
  function approvalChoices(event) {
    if (!String(event?.event || '').toLowerCase().includes('approval')) return [];
    const values = Array.isArray(event?.data?.choices) ? event.data.choices : [];
    return values.map((x) => String(x).toLowerCase()).filter((x) => ['once', 'session', 'always', 'deny'].includes(x));
  }

  function planItemsFromData(data) {
    const candidates = [data?.todos, data?.items, data?.tasks, data?.plan, data?.steps, data];
    let rows = candidates.find((x) => Array.isArray(x));
    if (!rows && data && typeof data === 'object') {
      const nested = Object.values(data).find((x) => Array.isArray(x));
      if (nested) rows = nested;
    }
    if (!Array.isArray(rows)) return [];
    return rows.map((item, index) => {
      if (typeof item === 'string') return { id: String(index), text: item, detail: '', status: 'pending' };
      const statusRaw = String(item?.status || item?.state || '').toLowerCase();
      const status = ['done', 'completed', 'complete', 'success'].includes(statusRaw)
        ? 'completed'
        : ['running', 'active', 'in_progress', 'in-progress', 'current'].includes(statusRaw)
          ? 'in_progress'
          : 'pending';
      return {
        id: String(item?.id || item?.key || index),
        text: String(item?.content || item?.title || item?.text || item?.task || item?.description || `步骤 ${index + 1}`),
        detail: shortText(item?.detail || item?.notes || item?.summary || item?.result || '', 360),
        status,
      };
    }).filter((x) => x.text.trim());
  }
  function officialPlan(run) {
    const todoEvents = (run?.events || []).filter((e) => String(e?.event || '').includes('todo'));
    for (let i = todoEvents.length - 1; i >= 0; i--) {
      const items = planItemsFromData(todoEvents[i]?.data || {});
      if (items.length) return items;
    }
    return [];
  }

  function finiteNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  }
  function fmtTokens(value) {
    const n = finiteNumber(value);
    if (n === null) return '—';
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(Math.round(n));
  }
  function normalizeContextPayload(raw) {
    let data = raw && typeof raw === 'object' ? raw : null;
    if (data?.context && typeof data.context === 'object') data = data.context;
    if (!data) return null;
    const used = finiteNumber(data.context_used, data.context_tokens, data.used_tokens, data.last_prompt_tokens);
    const maximum = finiteNumber(data.context_max, data.context_length, data.context_window, data.context_window_tokens, data.max_tokens);
    const threshold = finiteNumber(data.threshold_tokens, data.compression_threshold, data.compression_threshold_tokens, data.compact_at_tokens);
    const explicitPercent = finiteNumber(data.context_percent, data.usage_percent, data.percent, data.fill_percent);
    const percent = explicitPercent !== null ? Math.max(0, Math.min(100, explicitPercent)) : used !== null && maximum ? Math.max(0, Math.min(100, (used / maximum) * 100)) : null;
    const thresholdPercent = finiteNumber(data.compression_threshold_percent) ?? (threshold !== null && maximum ? (threshold / maximum) * 100 : null);
    const progressPercent = finiteNumber(data.compression_progress_percent) ?? (used !== null && threshold ? (used / threshold) * 100 : null);
    const remaining = finiteNumber(data.remaining_tokens, data.context_remaining, data.tokens_until_compression) ?? (used !== null && threshold !== null ? Math.max(0, threshold - used) : null);
    const compressionCount = finiteNumber(data.compression_count, data.compaction_count);
    if (used === null && maximum === null && threshold === null && compressionCount === null) return null;
    return {
      available: data.available !== false,
      used,
      maximum,
      percent,
      threshold,
      thresholdPercent,
      progressPercent,
      remaining,
      compressionCount,
      compressionEnabled: data.compression_enabled ?? data.auto_compact,
      compacted: data.compacted === true,
      source: String(data.source || data.context_source || data.measurement || 'Hermes official telemetry'),
      measurement: String(data.measurement || data.context_source || ''),
      updatedAt: data.updated_at || null,
    };
  }
  function mergeContext(base, next) {
    if (!next) return base;
    if (!base) return { ...next };
    const merged = { ...base };
    for (const [key, value] of Object.entries(next)) if (value !== null && value !== undefined && value !== '') merged[key] = value;
    return merged;
  }
  function officialContextTelemetry(run, idleSnapshot, options, route) {
    let telemetry = normalizeContextPayload(idleSnapshot);
    telemetry = mergeContext(telemetry, normalizeContextPayload(run?.context));
    telemetry = mergeContext(telemetry, normalizeContextPayload(run?.usage?.context));
    let compacting = false;
    let compactMessage = '';
    let compactionMarker = '';
    for (const event of run?.events || []) {
      const name = String(event?.event || '').toLowerCase();
      const data = event?.data || {};
      if (name === 'context.snapshot') {
        const normalized = normalizeContextPayload(data);
        telemetry = mergeContext(telemetry, normalized);
        if (normalized?.compacted) compactionMarker = `snapshot:${event.seq || event.at || data.updated_at || ''}`;
      }
      if (name === 'run.completed') telemetry = mergeContext(telemetry, normalizeContextPayload(data?.usage?.context || data?.context));
      if (name === 'context.compaction') {
        const kind = String(data?.kind || data?.status || data?.phase || '').toLowerCase();
        compactMessage = String(data?.message || data?.detail || 'Hermes Auto Compact');
        if (['compacting', 'started', 'start', 'running', 'compressing'].includes(kind)) compacting = true;
        if (['compacted', 'completed', 'complete', 'done', 'finished', 'failed'].includes(kind)) {
          compacting = false;
          compactionMarker = `event:${event.seq || event.at || kind}`;
        }
        telemetry = mergeContext(telemetry, normalizeContextPayload(data?.context || data));
      }
    }
    const normalizedRoute = normalizeRoute(options, route);
    const cap = modelCapability(options, normalizedRoute.provider, normalizedRoute.model);
    const officialMax = finiteNumber(cap?.context_window, cap?.context_length, cap?.contextWindow, cap?.max_context_tokens);
    telemetry = telemetry || {};
    if (telemetry.maximum == null && officialMax !== null) telemetry.maximum = officialMax;
    if (telemetry.percent == null && telemetry.used != null && telemetry.maximum) telemetry.percent = Math.max(0, Math.min(100, (telemetry.used / telemetry.maximum) * 100));
    return { ...telemetry, compacting, compactMessage, compactionMarker };
  }

  function normalizeEndpointUrl(value) {
    let url = String(value || '').trim();
    if (!url) return '';
    const suffixes = ['/v1/chat/completions', '/chat/completions', '/v1/responses', '/responses', '/v1/models', '/models'];
    for (const suffix of suffixes) {
      if (url.toLowerCase().endsWith(suffix)) {
        url = url.slice(0, -suffix.length);
        if (suffix.startsWith('/v1/')) url += '/v1';
        break;
      }
    }
    return url.replace(/\/$/, '');
  }

  function titleFromPrompt(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 42) || '新对话';
    return `${clean} · ${Date.now().toString(36).slice(-5)}`;
  }

  function Button({ children, className = '', ...props }) { return h('button', { ...props, className: `hws3-button ${className}`.trim() }, children); }
  function Pill({ children, tone = 'neutral' }) { return h('span', { className: `hws3-pill ${tone}` }, children); }
  function Spinner() { return h('span', { className: 'hws3-spinner', 'aria-hidden': 'true' }); }
  function ErrorBar({ error, onClear }) {
    if (!error) return null;
    return h('div', { className: 'hws3-error' }, h('span', null, error), onClear ? h('button', { onClick: onClear, title: '关闭' }, '×') : null);
  }
  function Empty({ title, body }) { return h('div', { className: 'hws3-empty' }, h('strong', null, title || '暂无内容'), body ? h('p', null, body) : null); }

  function HermesMark({ compact = false }) {
    return h('span', { className: `hws3-mark ${compact ? 'compact' : ''}`, dangerouslySetInnerHTML: { __html: ICON_SVG } });
  }

  function ReturnToStudioSlot() {
    const path = String(window.location.pathname || '');
    if (path === '/' || path.endsWith('/worker-studio')) return null;
    return h('a', { className: 'hws3-return-slot', href: baseHref('/'), title: '返回 Hermes Worker Studio' }, '← Worker Studio');
  }

  function Modal({ title, body, inputValue, setInputValue, confirmText = '确认', destructive = false, onConfirm, onClose }) {
    return h('div', { className: 'hws3-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
      h('section', { className: 'hws3-modal', role: 'dialog', 'aria-modal': 'true' },
        h('header', null, h('h3', null, title), h('button', { onClick: onClose, title: '关闭' }, '×')),
        body ? h('p', null, body) : null,
        inputValue !== undefined ? h('input', { autoFocus: true, value: inputValue, onChange: (e) => setInputValue(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && inputValue.trim()) onConfirm(); } }) : null,
        h('footer', null,
          h(Button, { className: 'ghost', onClick: onClose }, '取消'),
          h(Button, { className: destructive ? 'danger' : 'primary', onClick: onConfirm, disabled: inputValue !== undefined && !inputValue.trim() }, confirmText),
        ),
      ),
    );
  }

  function SessionMenu({ session, onOpen, onRename, onArchive, onDelete }) {
    const [open, setOpen] = useState(false);
    return h('div', { className: 'hws3-session-wrap' },
      h('button', { className: 'hws3-session-row', onClick: onOpen },
        h('span', { className: `hws3-session-dot ${session?.is_active ? 'live' : ''}` }),
        h('span', { className: 'hws3-session-copy' },
          h('strong', null, shortText(sessionTitle(session), 52)),
          h('small', null, [session?.model, fmtTime(session?.last_active || session?.started_at)].filter(Boolean).join(' · ')),
        ),
      ),
      h('button', { className: 'hws3-session-more', title: '会话操作', onClick: (e) => { e.stopPropagation(); setOpen(!open); } }, '⋯'),
      open ? h('div', { className: 'hws3-session-menu' },
        h('button', { onClick: () => { setOpen(false); onRename(); } }, '重命名'),
        h('button', { onClick: () => { setOpen(false); onArchive(); } }, session.archived ? '取消归档' : '归档'),
        h('button', { className: 'danger', onClick: () => { setOpen(false); onDelete(); } }, '删除'),
      ) : null,
    );
  }

  function MessageBubble({ msg }) {
    const role = msg?.role || 'system';
    if (msg?.display_kind === 'hidden') return null;
    if (role === 'tool') return h('details', { className: 'hws3-tool-card' }, h('summary', null, `工具结果${msg?.tool_name ? ` · ${msg.tool_name}` : ''}`), h('pre', null, typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg?.content, null, 2)));
    const raw = typeof msg?.display_content === 'string' ? msg.display_content : msg?.content;
    const content = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p) => p?.text || p?.content || '').filter(Boolean).join('\n') : JSON.stringify(raw ?? '', null, 2);
    const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    return h('article', { className: `hws3-message ${role}` },
      h('div', { className: 'hws3-message-avatar' }, role === 'user' ? '你' : role === 'assistant' ? h(HermesMark, { compact: true }) : '•'),
      h('div', { className: 'hws3-message-main' },
        h('div', { className: 'hws3-message-meta' }, role === 'user' ? '你' : role === 'assistant' ? 'Hermes' : role),
        content ? h('div', { className: 'hws3-message-content' }, content) : null,
        calls.length ? h('details', { className: 'hws3-tool-card' }, h('summary', null, `工具调用 ${calls.length} 项`), calls.map((call, i) => h('div', { className: 'hws3-tool-call', key: call?.id || i }, h('strong', null, call?.function?.name || call?.name || 'tool'), h('pre', null, call?.function?.arguments || call?.arguments || '')))) : null,
      ),
    );
  }

  function CompactRouteSelector({ options, route, onChange, disabled }) {
    const normalized = normalizeRoute(options, route);
    const providers = authenticatedProviders(options);
    const models = modelsFor(options, normalized.provider);
    const efforts = reasoningOptions(options, normalized.provider, normalized.model);
    return h('div', { className: 'hws3-route-compact' },
      h('select', { value: normalized.provider, disabled: disabled || !providers.length, title: 'Provider', onChange: (e) => { const provider = e.target.value; onChange({ provider, model: modelsFor(options, provider)[0] || '', effort: 'auto' }); } }, providers.map((p) => h('option', { key: p.slug, value: p.slug }, p.name || p.slug))),
      h('select', { value: normalized.model, disabled: disabled || !models.length, title: '模型', onChange: (e) => onChange({ ...normalized, model: e.target.value, effort: 'auto' }) }, models.map((m) => h('option', { key: m, value: m }, m))),
      efforts.length > 1 ? h('select', { value: normalized.effort, disabled, title: '推理强度', onChange: (e) => onChange({ ...normalized, effort: e.target.value }) }, efforts.map((x) => h('option', { key: x.value, value: x.value }, x.value === 'auto' ? '思考 Auto' : `思考 ${x.value}`))) : h(Pill, null, '思考 Auto'),
    );
  }

  function PlanCard({ run }) {
    const [expanded, setExpanded] = useState(false);
    const items = officialPlan(run);
    if (!items.length) return null;
    const completed = items.filter((x) => x.status === 'completed').length;
    const active = items.find((x) => x.status === 'in_progress');
    const pct = Math.round((completed / items.length) * 100);
    return h('section', { className: `hws3-plan-card ${expanded ? 'expanded' : ''}` },
      h('button', { className: 'hws3-plan-summary', onClick: () => setExpanded(!expanded), 'aria-expanded': expanded },
        h('span', { className: 'hws3-plan-orbit' }, active ? '●' : completed === items.length ? '✓' : '○'),
        h('span', { className: 'hws3-plan-copy' },
          h('span', { className: 'hws3-plan-title-row' }, h('strong', null, '官方计划'), h('b', null, `已完成 ${completed} / ${items.length}`)),
          h('span', { className: 'hws3-plan-current' }, active ? `正在进行 · ${active.text}` : completed === items.length ? 'Hermes 计划已全部完成' : 'Hermes canonical todo'),
          h('span', { className: 'hws3-plan-progress' }, h('i', { style: { width: `${pct}%` } })),
        ),
        h('span', { className: 'hws3-plan-chevron' }, expanded ? '⌃' : '⌄'),
      ),
      expanded ? h('div', { className: 'hws3-plan-list' }, items.map((item, index) => h('div', { className: `hws3-plan-step ${item.status}`, key: item.id },
        h('span', { className: 'hws3-plan-step-state' }, item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'),
        h('div', null, h('p', null, h('em', null, `${index + 1}`), item.text), item.detail ? h('small', null, item.detail) : null),
      ))) : null,
    );
  }

  function ContextMeter({ run, snapshot, options, route }) {
    const [open, setOpen] = useState(false);
    const [flash, setFlash] = useState(false);
    const telemetry = officialContextTelemetry(run, snapshot, options, route);
    const marker = telemetry.compactionMarker;
    useEffect(() => {
      if (!marker) return undefined;
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(timer);
    }, [marker]);
    const maximum = telemetry.maximum;
    const used = telemetry.used;
    const percent = telemetry.percent != null ? Math.round(telemetry.percent) : null;
    const hasAny = used != null || maximum != null || telemetry.compacting || flash;
    if (!hasAny) return null;
    const compacting = telemetry.compacting;
    const summary = used != null && maximum != null
      ? `${fmtTokens(used)} / ${fmtTokens(maximum)} · ${percent ?? '—'}%`
      : maximum != null ? `— / ${fmtTokens(maximum)}` : 'Context';
    const label = compacting ? '正在压缩上下文' : flash ? '上下文已压缩' : summary;
    const stateClass = compacting ? 'compacting' : flash ? 'compacted' : '';
    return h('div', { className: 'hws3-context-wrap' },
      h('button', { className: `hws3-context-meter ${stateClass}`, onClick: () => setOpen(!open), 'aria-expanded': open, title: 'Hermes 官方上下文' },
        h('span', { className: 'hws3-context-ring', style: { '--hws-context-pct': `${percent ?? 0}%` } }, h('i')),
        h('span', { className: 'hws3-context-label' }, label),
      ),
      open ? h('section', { className: 'hws3-context-popover' },
        h('header', null, h('div', null, h('strong', null, '上下文'), h('small', null, 'Hermes 官方遥测')), h(Pill, { tone: used != null ? 'good' : 'neutral' }, used != null ? '实测' : '等待实测')),
        h('div', { className: `hws3-context-hero ${stateClass}` },
          h('span', { className: 'hws3-context-hero-ring' }, h('i', { style: { '--hws-context-pct': `${percent ?? 0}%` } })),
          h('div', null, h('b', null, used != null && maximum != null ? `${fmtTokens(used)} / ${fmtTokens(maximum)}` : maximum != null ? `— / ${fmtTokens(maximum)}` : '等待 Hermes'), h('span', null, compacting ? 'Auto Compact 进行中' : flash ? 'Compact 完成，正在恢复实时上下文' : percent != null ? `${percent}% 已使用` : '当前版本尚未暴露占用量')),
        ),
        telemetry.threshold != null ? h('div', { className: 'hws3-context-row' }, h('span', null, '自动压缩阈值'), h('strong', null, `${fmtTokens(telemetry.threshold)}${telemetry.thresholdPercent != null ? ` · ${Math.round(telemetry.thresholdPercent)}%` : ''}`)) : null,
        telemetry.remaining != null ? h('div', { className: 'hws3-context-row' }, h('span', null, '距 Compact'), h('strong', null, fmtTokens(telemetry.remaining))) : null,
        telemetry.compressionCount != null ? h('div', { className: 'hws3-context-row' }, h('span', null, '已 Compact'), h('strong', null, `${Math.round(telemetry.compressionCount)} 次`)) : null,
        h('div', { className: 'hws3-context-row' }, h('span', null, '执行'), h('strong', null, telemetry.compressionEnabled === false ? 'Hermes Auto Compact 已关闭' : 'Hermes Auto Compact')),
        h('footer', null, '只显示 Hermes 官方 Context 数据；不会把累计 billing/input token 当成当前上下文。'),
      ) : null,
    );
  }

  function WorkTimeline({ run, expanded, setExpanded, now, skillDiff, onApprove }) {
    if (!run) return null;
    const done = TERMINAL_RUN_STATES.has(run.status);
    const started = Number(run.started_at || 0) * 1000;
    const ended = run.ended_at ? Number(run.ended_at) * 1000 : null;
    const duration = run.elapsed_ms != null ? run.elapsed_ms : Math.max(0, (ended || now) - started);
    const events = (run.events || []).filter((e) => !['assistant.delta', 'message.delta'].includes(e.event) && !String(e.event || '').includes('todo') && !String(e.event || '').startsWith('context.'));
    return h('section', { className: `hws3-work ${done ? 'done' : 'running'}` },
      h('button', { className: 'hws3-work-head', onClick: () => setExpanded(!expanded) },
        h('span', { className: 'hws3-work-state' }, done ? (run.status === 'completed' ? '✓' : '!') : h(Spinner)),
        h('strong', null, done ? (run.status === 'completed' ? '工作已完成' : `工作结束 · ${run.status}`) : '工作进行中'),
        h('span', null, fmtDuration(duration)),
        h('span', null, `${events.length} 项`),
        h('span', null, expanded ? '⌃' : '⌄'),
      ),
      expanded ? h('div', { className: 'hws3-work-body' },
        events.length ? events.map((event) => h('div', { className: 'hws3-work-event', key: event.seq },
          h('span', { className: 'hws3-event-dot' }),
          h('div', null, h('strong', null, eventSummary(event)), eventDetail(event) ? h('small', null, eventDetail(event)) : null,
            approvalChoices(event).length ? h('div', { className: 'hws3-approval-actions' }, approvalChoices(event).map((choice) => h(Button, { key: choice, className: choice === 'deny' ? 'danger small' : 'ghost small', onClick: () => onApprove?.(choice) }, choice === 'once' ? '允许一次' : choice === 'session' ? '本会话允许' : choice === 'always' ? '始终允许' : '拒绝'))) : null),
          h('time', null, fmtTime(event.at)),
        )) : h('p', { className: 'hws3-muted' }, '等待 Hermes lifecycle 事件…'),
        skillDiff && (skillDiff.added.length || skillDiff.removed.length || skillDiff.toggled.length) ? h('details', { className: 'hws3-skill-diff' }, h('summary', null, 'Hermes Skills 变化'), skillDiff.added.length ? h('p', null, `新增：${skillDiff.added.join(' · ')}`) : null, skillDiff.removed.length ? h('p', null, `移除：${skillDiff.removed.join(' · ')}`) : null, skillDiff.toggled.length ? h('p', null, `启停变化：${skillDiff.toggled.join(' · ')}`) : null) : null,
      ) : null,
    );
  }

  function AttachmentChip({ item, onRemove }) {
    return h('div', { className: 'hws3-attachment-chip' }, h('img', { src: item.dataUrl, alt: item.name }), h('div', null, h('strong', null, shortText(item.name, 24)), h('small', null, `${Math.max(1, Math.round(item.size / 1024))} KB`)), h('button', { onClick: onRemove, title: '移除' }, '×'));
  }

  function Conversation(props) {
    const {
      session, messages, loading, run, streamText, draft, setDraft, onSend, sending,
      modelOptions, chatRoute, setChatRoute, contextSnapshot, now, onStop, onSteer, onApprove, skillDiff,
      timelineExpanded, setTimelineExpanded, attachments, setAttachments, onRename, onArchive, onDelete,
    } = props;
    const transcriptRef = useRef(null);
    const fileRef = useRef(null);
    const textareaRef = useRef(null);
    const [autoScroll, setAutoScroll] = useState(() => readLocal('hws3_auto_scroll', true));
    const [following, setFollowing] = useState(true);
    const [dragging, setDragging] = useState(false);

    const scrollToBottom = useCallback((behavior = 'smooth') => {
      const el = transcriptRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setFollowing(true);
    }, []);

    useEffect(() => { writeLocal('hws3_auto_scroll', autoScroll); }, [autoScroll]);
    useEffect(() => {
      if (autoScroll && following) requestAnimationFrame(() => scrollToBottom('smooth'));
    }, [messages.length, streamText, run?.last_seq, autoScroll, following, scrollToBottom]);
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(180, Math.max(52, el.scrollHeight)) + 'px';
    }, [draft]);

    async function filesToAttachments(files) {
      const valid = [...files].filter((file) => IMAGE_TYPES.has(file.type));
      for (const file of valid) {
        if (file.size > MAX_IMAGE_BYTES) throw new Error(`图片 ${file.name} 超过 25 MB`);
      }
      const converted = await Promise.all(valid.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
        reader.onload = () => resolve({ id: `${Date.now()}-${Math.random()}`, name: file.name || 'clipboard.png', type: file.type || 'image/png', size: file.size, dataUrl: String(reader.result || '') });
        reader.readAsDataURL(file);
      })));
      setAttachments((xs) => [...xs, ...converted]);
    }

    const onPaste = async (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      try { await filesToAttachments(files); } catch (err) { alert(errorText(err)); }
    };
    const onDrop = async (e) => {
      e.preventDefault(); setDragging(false);
      try { await filesToAttachments(e.dataTransfer?.files || []); } catch (err) { alert(errorText(err)); }
    };

    return h('section', { className: 'hws3-conversation' },
      h('header', { className: 'hws3-chat-head' },
        h('div', { className: 'hws3-chat-title' }, h('h2', null, session ? sessionTitle(session) : '新对话'), session ? h('small', null, session.id) : h('small', null, '发送第一条消息时创建 Hermes Session')),
        modelOptions ? h(CompactRouteSelector, { options: modelOptions, route: chatRoute, onChange: setChatRoute, disabled: sending }) : null,
        modelOptions ? h(ContextMeter, { run, snapshot: contextSnapshot, options: modelOptions, route: chatRoute }) : null,
        h('div', { className: 'hws3-chat-actions' },
          session ? h('button', { title: '重命名', onClick: onRename }, '✎') : null,
          session ? h('button', { title: session.archived ? '取消归档' : '归档', onClick: onArchive }, session.archived ? '↥' : '⌑') : null,
          session ? h('button', { className: 'danger', title: '删除', onClick: onDelete }, '⌫') : null,
        ),
      ),
      h('div', { className: 'hws3-transcript', ref: transcriptRef, onScroll: (e) => { const el = e.currentTarget; const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80; setFollowing(near); } },
        loading ? h('div', { className: 'hws3-loading' }, h(Spinner), ' 正在读取消息…') : null,
        !loading && !(messages || []).length && !run ? h('div', { className: 'hws3-welcome' }, h(HermesMark), h('h1', null, '今天想让 Hermes 做什么？'), h('p', null, '原生 Runs · 原生 Worker · 原生 Skills · 原生审批')) : null,
        (messages || []).map((msg, i) => h(MessageBubble, { msg, key: msg?.id || `${msg?.role}-${i}` })),
        run ? h(PlanCard, { run }) : null,
        run ? h(WorkTimeline, { run, expanded: timelineExpanded, setExpanded: setTimelineExpanded, now, skillDiff, onApprove }) : null,
        streamText && run && !TERMINAL_RUN_STATES.has(run.status) ? h('article', { className: 'hws3-message assistant live' }, h('div', { className: 'hws3-message-avatar' }, h(HermesMark, { compact: true })), h('div', { className: 'hws3-message-main' }, h('div', { className: 'hws3-message-meta' }, 'Hermes · 实时'), h('div', { className: 'hws3-message-content' }, streamText))) : null,
      ),
      (!following || !autoScroll) ? h('div', { className: 'hws3-scroll-tools' }, h('label', null, h('input', { type: 'checkbox', checked: autoScroll, onChange: (e) => setAutoScroll(e.target.checked) }), ' 自动滚动'), h(Button, { className: 'ghost small', onClick: () => scrollToBottom('smooth') }, '↓ 回到底部')) : null,
      h('div', { className: `hws3-composer-zone ${dragging ? 'dragging' : ''}`, onDragOver: (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); setDragging(true); } }, onDragLeave: () => setDragging(false), onDrop },
        attachments.length ? h('div', { className: 'hws3-attachments' }, attachments.map((item) => h(AttachmentChip, { key: item.id, item, onRemove: () => setAttachments((xs) => xs.filter((x) => x.id !== item.id)) }))) : null,
        h('form', { className: 'hws3-composer', onSubmit: (e) => { e.preventDefault(); onSend(); } },
          h('button', { type: 'button', className: 'hws3-plus', title: '添加图片', onClick: () => fileRef.current?.click() }, '+'),
          h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', multiple: true, hidden: true, onChange: async (e) => { try { await filesToAttachments(e.target.files || []); } catch (err) { alert(errorText(err)); } finally { e.target.value = ''; } } }),
          h('textarea', { ref: textareaRef, value: draft, onChange: (e) => setDraft(e.target.value), onPaste, rows: 1, placeholder: sending ? '输入并发送以调整正在运行的 Hermes…' : '给 Hermes 发送消息…', onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); onSend(); } } }),
          sending ? h('button', { type: 'button', className: 'hws3-stop', title: '停止 Run', onClick: onStop }, '■') : h('button', { type: 'submit', className: 'hws3-send', disabled: !draft.trim() && !attachments.length, title: '发送' }, '↑'),
        ),
        h('div', { className: 'hws3-composer-hint' }, h('span', null, 'Enter 发送 · Shift+Enter 换行 · Ctrl/Cmd+V 粘贴图片'), sending ? h('span', null, '运行中再次发送 = 调整方向') : null),
      ),
    );
  }

  function WorkerPage({ config, modelOptions, chatRoute, refreshConfig }) {
    const mode = studioMode(config);
    const fallback = normalizeRoute(modelOptions, chatRoute);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const delegation = config?.delegation || {};
    const review = config?.auxiliary?.review || {};
    const [workerInherit, setWorkerInherit] = useState(!delegation.provider && !delegation.model);
    const [workerRoute, setWorkerRoute] = useState(() => normalizeRoute(modelOptions, { provider: delegation.provider || fallback.provider, model: delegation.model || fallback.model, effort: delegation.reasoning_effort || 'auto' }));
    const [reviewInherit, setReviewInherit] = useState(!review.model && (!review.provider || review.provider === 'auto'));
    const [reviewRoute, setReviewRoute] = useState(() => normalizeRoute(modelOptions, { provider: review.provider && review.provider !== 'auto' ? review.provider : fallback.provider, model: review.model || fallback.model, effort: 'auto' }));

    async function saveMode(nextMode) {
      setBusy(true); setMessage('');
      try { const fresh = unwrapConfig(await api('/api/config')); await api('/api/config', jinit('PUT', { config: withStudioMode(fresh, nextMode) })); await refreshConfig(); setMessage(`模式已切换为 ${nextMode === 'DELEGATE' ? 'WORKER' : nextMode}`); }
      catch (err) { setMessage(errorText(err)); } finally { setBusy(false); }
    }
    async function saveRoutes() {
      setBusy(true); setMessage('');
      try {
        const cfg = clone(unwrapConfig(await api('/api/config')));
        const d = { ...(cfg.delegation || {}) };
        if (workerInherit) { delete d.provider; delete d.model; delete d.reasoning_effort; }
        else { d.provider = workerRoute.provider; d.model = workerRoute.model; if (workerRoute.effort !== 'auto') d.reasoning_effort = workerRoute.effort; else delete d.reasoning_effort; }
        cfg.delegation = d;
        cfg.auxiliary = { ...(cfg.auxiliary || {}) };
        cfg.auxiliary.review = reviewInherit ? { ...(cfg.auxiliary.review || {}), provider: 'auto', model: '' } : { ...(cfg.auxiliary.review || {}), provider: reviewRoute.provider, model: reviewRoute.model };
        await api('/api/config', jinit('PUT', { config: cfg })); await refreshConfig(); setMessage('Worker / Verifier 路由已写入 Hermes 官方配置');
      } catch (err) { setMessage(errorText(err)); } finally { setBusy(false); }
    }
    const descriptions = {
      OFFICIAL: '完全交还 Hermes 原生 delegate_task 与默认调度行为。',
      AUTO: 'Main 自主判断是否启用 Hermes child agent；Studio 不替换 planner。',
      DELEGATE: '偏好 Main 协调、Hermes child agent 执行；仍是同一个 Hermes runtime。',
      MAIN: '通过 Hermes pre_tool_call policy 阻止新 delegate_task / worker_delegate。',
    };
    return h('section', { className: 'hws3-page' },
      h('header', { className: 'hws3-page-head' }, h('div', null, h('h2', null, 'Hermes Worker'), h('p', null, 'PluginContext.subagent_lifecycle · 无第二执行内核')), h(Pill, { tone: 'good' }, 'Hermes Native')),
      h('div', { className: 'hws3-mode-tabs' }, ['OFFICIAL', 'AUTO', 'DELEGATE', 'MAIN'].map((x) => h(Button, { key: x, className: mode === x ? 'selected' : 'ghost', disabled: busy, onClick: () => saveMode(x) }, x === 'DELEGATE' ? 'WORKER' : x))),
      h('section', { className: 'hws3-card hero' }, h('strong', null, mode === 'DELEGATE' ? 'WORKER' : mode), h('p', null, descriptions[mode])),
      h('div', { className: 'hws3-two-col' },
        h('section', { className: 'hws3-card' }, h('header', null, h('div', null, h('small', null, 'WORKER'), h('h3', null, 'delegation.*')), h(Pill, null, workerInherit ? '跟随 Main' : '独立')), h('label', { className: 'hws3-check' }, h('input', { type: 'checkbox', checked: workerInherit, onChange: (e) => setWorkerInherit(e.target.checked) }), ' 跟随 Main'), !workerInherit ? h(CompactRouteSelector, { options: modelOptions, route: workerRoute, onChange: setWorkerRoute, disabled: busy }) : h('p', null, `${fallback.provider || '—'} · ${fallback.model || '—'}`)),
        h('section', { className: 'hws3-card' }, h('header', null, h('div', null, h('small', null, 'VERIFIER'), h('h3', null, 'auxiliary.review.*')), h(Pill, null, reviewInherit ? '跟随 Main' : '独立')), h('label', { className: 'hws3-check' }, h('input', { type: 'checkbox', checked: reviewInherit, onChange: (e) => setReviewInherit(e.target.checked) }), ' 跟随 Main'), !reviewInherit ? h(CompactRouteSelector, { options: modelOptions, route: reviewRoute, onChange: setReviewRoute, disabled: busy }) : h('p', null, `${fallback.provider || '—'} · ${fallback.model || '—'}`)),
      ),
      h(Button, { className: 'primary', disabled: busy, onClick: saveRoutes }, busy ? '保存中…' : '保存 Worker / Verifier 路由'),
      message ? h('div', { className: 'hws3-result' }, message) : null,
    );
  }

  function ModelsPage({ modelOptions, refreshOptions }) {
    const EMPTY = { id: '', name: '', base_url: '', api_key: '', model: '', context_length: '', discover_models: true, make_default: false };
    const [form, setForm] = useState(EMPTY);
    const [endpoints, setEndpoints] = useState([]);
    const [discovered, setDiscovered] = useState([]);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [query, setQuery] = useState('');
    const [tests, setTests] = useState({});

    const refreshEndpoints = useCallback(async () => {
      try { const data = await api('/api/providers/custom-endpoints'); setEndpoints(data.endpoints || []); return data.endpoints || []; }
      catch (err) { setMessage(errorText(err)); return []; }
    }, []);
    useEffect(() => { refreshEndpoints(); }, [refreshEndpoints]);

    function editEndpoint(endpoint) {
      setForm({ id: endpoint.id || '', name: endpoint.name || '', base_url: endpoint.base_url || '', api_key: '', model: endpoint.model || '', context_length: endpoint.context_length ? String(endpoint.context_length) : '', discover_models: endpoint.discover_models !== false, make_default: Boolean(endpoint.is_current) });
      setDiscovered(endpoint.models || []); setMessage('');
    }
    async function validate() {
      setBusy('validate'); setMessage('');
      try {
        const payload = { id: form.id || undefined, name: form.name.trim() || 'Custom Endpoint', base_url: normalizeEndpointUrl(form.base_url), api_key: form.api_key || undefined, model: form.model.trim(), discover_models: form.discover_models, make_default: form.make_default };
        const result = await api('/api/providers/custom-endpoints/validate', jinit('POST', payload));
        const models = Array.isArray(result?.models) ? result.models : [];
        setDiscovered(models); if (!form.model && models[0]) setForm((x) => ({ ...x, model: models[0] }));
        setMessage(result?.ok === false ? result?.message || '验证失败' : `连接成功${models.length ? ` · 发现 ${models.length} 个模型` : ''}`);
      } catch (err) { setMessage(errorText(err)); } finally { setBusy(''); }
    }
    async function save() {
      if (!form.name.trim() || !form.base_url.trim() || !form.model.trim()) { setMessage('Name、Base URL、Model 为必填。'); return; }
      setBusy('save'); setMessage('');
      try {
        const n = Number.parseInt(form.context_length, 10);
        const payload = { id: form.id || undefined, name: form.name.trim(), base_url: normalizeEndpointUrl(form.base_url), api_key: form.api_key || undefined, model: form.model.trim(), context_length: Number.isFinite(n) && n > 0 ? n : undefined, discover_models: form.discover_models, make_default: form.make_default, models: discovered.length ? discovered : undefined };
        await api('/api/providers/custom-endpoints', jinit('POST', payload)); await refreshEndpoints(); await refreshOptions(true); setForm(EMPTY); setDiscovered([]); setMessage('已保存到 Hermes Custom Endpoint');
      } catch (err) { setMessage(errorText(err)); } finally { setBusy(''); }
    }
    async function remove(endpoint) {
      if (!confirm(`删除 ${endpoint.name}？`)) return;
      setBusy(`delete:${endpoint.id}`);
      try { await api(`/api/providers/custom-endpoints/${encodeURIComponent(endpoint.id)}`, jinit('DELETE')); await refreshEndpoints(); await refreshOptions(true); if (form.id === endpoint.id) setForm(EMPTY); }
      catch (err) { setMessage(errorText(err)); } finally { setBusy(''); }
    }
    async function activate(endpoint) {
      setBusy(`activate:${endpoint.id}`);
      try { await api(`/api/providers/custom-endpoints/${encodeURIComponent(endpoint.id)}/activate`, jinit('POST', {})); await refreshEndpoints(); await refreshOptions(true); setMessage(`已切换到 ${endpoint.name}`); }
      catch (err) { setMessage(errorText(err)); } finally { setBusy(''); }
    }
    async function testModel(provider, model) {
      const key = `${provider}:${model}`; setTests((x) => ({ ...x, [key]: { loading: true } }));
      try { const result = await plugin('/hermes/model-probe', jinit('POST', { provider, model })); setTests((x) => ({ ...x, [key]: result })); }
      catch (err) { setTests((x) => ({ ...x, [key]: { ok: false, error: errorText(err) } })); }
    }
    const needle = query.trim().toLowerCase();
    const rows = authenticatedProviders(modelOptions);
    return h('section', { className: 'hws3-page' },
      h('header', { className: 'hws3-page-head' }, h('div', null, h('h2', null, '模型'), h('p', null, '唯一真相源：Hermes /api/model/options + Custom Endpoint API')), h(Button, { className: 'ghost', onClick: () => { refreshOptions(true); refreshEndpoints(); } }, '刷新')),
      h('section', { className: 'hws3-card' }, h('header', null, h('div', null, h('small', null, 'CUSTOM ENDPOINTS'), h('h3', null, '已保存连接')), h(Pill, null, endpoints.length)), endpoints.length ? h('div', { className: 'hws3-endpoints' }, endpoints.map((ep) => h('div', { className: 'hws3-endpoint', key: ep.id }, h('button', { className: 'main', onClick: () => editEndpoint(ep) }, h('strong', null, ep.name), h('small', null, ep.base_url), h('span', null, ep.model)), ep.is_current ? h(Pill, { tone: 'good' }, '当前') : h(Button, { className: 'ghost small', disabled: busy === `activate:${ep.id}`, onClick: () => activate(ep) }, '使用'), ep.source !== 'direct-config' ? h(Button, { className: 'danger small', disabled: busy === `delete:${ep.id}`, onClick: () => remove(ep) }, '删除') : null))) : h(Empty, { title: '暂无 Custom Endpoint', body: '可以添加 OpenAI-compatible endpoint。' })),
      h('section', { className: 'hws3-card' }, h('header', null, h('div', null, h('small', null, form.id ? 'EDIT' : 'NEW'), h('h3', null, form.id ? '编辑 Endpoint' : '新增 Endpoint'))),
        h('div', { className: 'hws3-form-grid' },
          h('label', null, 'Name', h('input', { value: form.name, onChange: (e) => setForm((x) => ({ ...x, name: e.target.value })), placeholder: 'My API' })),
          h('label', null, 'Provider ID（可选）', h('input', { value: form.id, onChange: (e) => setForm((x) => ({ ...x, id: e.target.value })), placeholder: '自动生成或自定义' })),
          h('label', { className: 'wide' }, 'Base URL', h('input', { value: form.base_url, onChange: (e) => setForm((x) => ({ ...x, base_url: e.target.value })), onBlur: () => setForm((x) => ({ ...x, base_url: normalizeEndpointUrl(x.base_url) })), placeholder: 'https://example.com/v1 · 粘贴 /responses 也会自动归一化' })),
          h('label', null, 'Model', h('input', { value: form.model, list: 'hws3-models', onChange: (e) => setForm((x) => ({ ...x, model: e.target.value })), placeholder: '验证后自动发现' }), h('datalist', { id: 'hws3-models' }, discovered.map((m) => h('option', { key: m, value: m })))),
          h('label', null, 'Context（可选）', h('input', { value: form.context_length, inputMode: 'numeric', onChange: (e) => setForm((x) => ({ ...x, context_length: e.target.value })), placeholder: 'Auto' })),
          h('label', { className: 'wide' }, 'API Key', h('input', { type: 'password', autoComplete: 'off', value: form.api_key, onChange: (e) => setForm((x) => ({ ...x, api_key: e.target.value })), placeholder: form.id ? '留空保留现有 Key' : '可选' })),
        ),
        h('div', { className: 'hws3-inline-options' }, h('label', null, h('input', { type: 'checkbox', checked: form.discover_models, onChange: (e) => setForm((x) => ({ ...x, discover_models: e.target.checked })) }), ' 自动发现模型'), h('label', null, h('input', { type: 'checkbox', checked: form.make_default, onChange: (e) => setForm((x) => ({ ...x, make_default: e.target.checked })) }), ' 用于新对话')),
        h('div', { className: 'hws3-actions' }, h(Button, { className: 'ghost', disabled: busy === 'validate' || !form.base_url.trim(), onClick: validate }, busy === 'validate' ? '测试中…' : '测试'), h(Button, { className: 'primary', disabled: busy === 'save', onClick: save }, busy === 'save' ? '保存中…' : '保存'), form.id ? h(Button, { className: 'ghost', onClick: () => { setForm(EMPTY); setDiscovered([]); } }, '新建') : null),
      ),
      message ? h('div', { className: 'hws3-result' }, message) : null,
      h('input', { className: 'hws3-search', value: query, onChange: (e) => setQuery(e.target.value), placeholder: '搜索 Provider / Model…' }),
      h('div', { className: 'hws3-model-catalog' }, rows.map((provider) => { const models = (provider.models || []).filter((m) => !needle || `${provider.name} ${provider.slug} ${m}`.toLowerCase().includes(needle)); if (!models.length) return null; return h('section', { className: 'hws3-card', key: provider.slug }, h('header', null, h('div', null, h('small', null, provider.slug), h('h3', null, provider.name || provider.slug)), provider.is_current ? h(Pill, { tone: 'good' }, '当前') : null), models.slice(0, 80).map((model) => { const key = `${provider.slug}:${model}`; const test = tests[key]; return h('div', { className: 'hws3-model-row', key: model }, h('div', null, h('strong', null, model), h('small', null, reasoningOptions(modelOptions, provider.slug, model).map((x) => x.value).join(' · '))), test?.loading ? h(Spinner) : test ? h(Pill, { tone: test.ok ? 'good' : 'bad' }, test.ok ? 'Run 通过' : '失败') : null, h(Button, { className: 'ghost small', disabled: test?.loading, onClick: () => testModel(provider.slug, model) }, '真实 Run 测试')); })); })),
    );
  }

  function UnattendedPage({ config, refreshConfig }) {
    const ready = unattendedReady(config);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    async function enable() {
      setBusy(true); setMessage('');
      try {
        let cfg = clone(unwrapConfig(await api('/api/config')));
        if (!unattendedReady(cfg)) {
          const snapshot = {
            approvals: {
              mode: cfg?.approvals?.mode,
              cron_mode: cfg?.approvals?.cron_mode,
              single_query_mode: cfg?.approvals?.single_query_mode,
              unattended_mode: cfg?.approvals?.unattended_mode,
              mcp_reload_confirm: cfg?.approvals?.mcp_reload_confirm,
              destructive_slash_confirm: cfg?.approvals?.destructive_slash_confirm,
            },
            subagent_auto_approve: cfg?.delegation?.subagent_auto_approve,
          };
          cfg = withStudioSettings(cfg, { unattended_restore: snapshot });
        }
        cfg.approvals = { ...(cfg.approvals || {}), mode: 'off', cron_mode: 'approve', single_query_mode: 'approve', unattended_mode: 'approve', mcp_reload_confirm: false, destructive_slash_confirm: false };
        cfg.delegation = { ...(cfg.delegation || {}), subagent_auto_approve: true };
        await api('/api/config', jinit('PUT', { config: cfg }));
        const readback = await refreshConfig();
        if (!unattendedReady(readback)) throw new Error('Hermes 配置读回未达到完全访问条件');
        const probe = await plugin('/hermes/unattended/probe', jinit('POST', { confirm: 'RUN_SAFE_UNATTENDED_PROBE' }));
        if (probe?.status !== 'UNATTENDED_READY' || probe?.marker_verified !== true) throw new Error('真实 Hermes Run marker 未通过');
        setMessage(`完全访问已开启并实测通过 · ${probe.run_id}`);
      } catch (err) { setMessage(errorText(err)); } finally { setBusy(false); }
    }
    async function disable() {
      setBusy(true); setMessage('');
      try {
        let cfg = clone(unwrapConfig(await api('/api/config')));
        const restore = studioSettings(cfg)?.unattended_restore;
        if (restore?.approvals) cfg.approvals = { ...(cfg.approvals || {}), ...restore.approvals };
        else cfg.approvals = { ...(cfg.approvals || {}), mode: 'smart' };
        cfg.delegation = { ...(cfg.delegation || {}), subagent_auto_approve: restore?.subagent_auto_approve === true };
        cfg = withStudioSettings(cfg, { unattended_restore: null });
        await api('/api/config', jinit('PUT', { config: cfg }));
        await refreshConfig(); setMessage('完全访问已关闭，已恢复开启前的 Hermes 审批配置');
      } catch (err) { setMessage(errorText(err)); } finally { setBusy(false); }
    }
    return h('section', { className: 'hws3-page' },
      h('header', { className: 'hws3-page-head' }, h('div', null, h('h2', null, '完全访问'), h('p', null, '像 ChatGPT“完全访问”一样简单，但底层仍是 Hermes 官方 approvals / delegation')), h(Pill, { tone: ready ? 'good' : 'neutral' }, ready ? '已开启' : '已关闭')),
      h('section', { className: `hws3-access-card ${ready ? 'on' : 'off'}` }, h('div', null, h('span', { className: 'hws3-access-icon' }, '⚡'), h('div', null, h('h3', null, ready ? 'Hermes 可无人值守执行' : 'Hermes 使用受控审批'), h('p', null, ready ? '已关闭可配置的人机审批，并允许子代理自动批准。' : '危险操作按 Hermes 当前审批配置进行确认。'))), h('button', { className: `hws3-switch ${ready ? 'on' : ''}`, disabled: busy, onClick: () => ready ? disable() : enable(), 'aria-pressed': ready }, h('span'))),
      h('section', { className: 'hws3-card' }, h('h3', null, '永久边界'), h('p', null, '完全访问不会修改、绕过或弱化 Hermes Hardline Blocklist。Studio 只控制 Hermes 本来就允许配置的审批项。')),
      message ? h('div', { className: 'hws3-result' }, message) : null,
    );
  }

  function HistoryPage({ onOpenSession, onSessionMutation }) {
    const [kind, setKind] = useState('include');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [state, setState] = useState({ loading: true, rows: [], total: 0, error: '' });
    const load = useCallback(async () => {
      setState((s) => ({ ...s, loading: true, error: '' }));
      try {
        const value = q.trim();
        if (value) { const data = await api(`/api/sessions/search?q=${encodeURIComponent(value)}&limit=100`); setState({ loading: false, rows: data.results || [], total: (data.results || []).length, error: '' }); }
        else { const offset = (page - 1) * HISTORY_SESSION_LIMIT; const data = await api(`/api/sessions?limit=${HISTORY_SESSION_LIMIT}&offset=${offset}&order=recent&archived=${kind}`); setState({ loading: false, rows: data.sessions || [], total: Number(data.total || 0), error: '' }); }
      } catch (err) { setState({ loading: false, rows: [], total: 0, error: errorText(err) }); }
    }, [q, page, kind]);
    useEffect(() => { const t = setTimeout(load, q.trim() ? 180 : 0); return () => clearTimeout(t); }, [load]);
    async function toggle(row) { const id = row.id || row.session_id; await api(`/api/sessions/${encodeURIComponent(id)}`, jinit('PATCH', { archived: !row.archived })); await load(); onSessionMutation?.(); }
    async function remove(row) { const id = row.id || row.session_id; if (!confirm(`删除 ${sessionTitle(row)}？`)) return; await api(`/api/sessions/${encodeURIComponent(id)}`, jinit('DELETE')); await load(); onSessionMutation?.(); }
    const pages = Math.max(1, Math.ceil(state.total / HISTORY_SESSION_LIMIT));
    return h('section', { className: 'hws3-page' },
      h('header', { className: 'hws3-page-head' }, h('div', null, h('h2', null, '完整历史'), h('p', null, 'Hermes 官方分页 + FTS 搜索 + 归档/恢复/删除'))),
      h('div', { className: 'hws3-history-controls' }, h('input', { className: 'hws3-search', value: q, onChange: (e) => { setQ(e.target.value); setPage(1); }, placeholder: '搜索完整会话…' }), h('select', { value: kind, onChange: (e) => { setKind(e.target.value); setPage(1); } }, h('option', { value: 'include' }, '全部'), h('option', { value: 'exclude' }, '未归档'), h('option', { value: 'only' }, '已归档'))),
      h(ErrorBar, { error: state.error }),
      h('div', { className: 'hws3-history-list' }, state.loading ? h('div', { className: 'hws3-loading' }, h(Spinner)) : state.rows.map((row) => h('div', { className: 'hws3-history-row', key: row.id || row.session_id }, h('button', { className: 'main', onClick: () => onOpenSession(row) }, h('strong', null, sessionTitle(row)), h('small', null, [fmtTime(row.last_active || row.started_at), row.model, row.archived ? '已归档' : ''].filter(Boolean).join(' · ')), row.snippet ? h('p', null, shortText(row.snippet, 180)) : null), h(Button, { className: 'ghost small', onClick: () => toggle(row) }, row.archived ? '恢复' : '归档'), h(Button, { className: 'danger small', onClick: () => remove(row) }, '删除')))),
      !q.trim() ? h('div', { className: 'hws3-pagination' }, h(Button, { className: 'ghost', disabled: page <= 1, onClick: () => setPage(page - 1) }, '上一页'), h('span', null, `${page} / ${pages}`), h(Button, { className: 'ghost', disabled: page >= pages, onClick: () => setPage(page + 1) }, '下一页')) : null,
    );
  }

  function Sidebar({ view, setView, recent, current, openSession, newConversation, refreshRecent, ready, mode, mobileOpen, setMobileOpen, onRename, onArchive, onDelete, search, setSearch, searchResults }) {
    const sessions = search.trim() ? searchResults : recent.sessions;
    return h(React.Fragment, null,
      mobileOpen ? h('button', { className: 'hws3-mobile-scrim', onClick: () => setMobileOpen(false), 'aria-label': '关闭侧边栏' }) : null,
      h('aside', { className: `hws3-sidebar ${mobileOpen ? 'mobile-open' : ''}` },
        h('div', { className: 'hws3-brand' }, h(HermesMark), h('div', null, h('strong', null, 'Hermes Worker Studio'), h('small', null, 'Hermes Native · Product 3.0')), h('button', { className: 'hws3-mobile-close', onClick: () => setMobileOpen(false) }, '×')),
        h(Button, { className: 'new', onClick: () => { newConversation(); setMobileOpen(false); } }, '＋ 新对话'),
        h('div', { className: 'hws3-side-search' }, h('span', null, '⌕'), h('input', { value: search, onChange: (e) => setSearch(e.target.value), placeholder: '搜索会话' })),
        h('nav', { className: 'hws3-nav' }, PRIMARY_NAV.map(([id, label, icon]) => h('button', { key: id, className: view === id ? 'active' : '', onClick: () => { setView(id); setMobileOpen(false); } }, h('span', null, icon), label, id === 'unattended' ? h('i', { className: `hws3-status ${ready ? 'good' : ''}` }) : null))),
        h('div', { className: 'hws3-recent-head' }, h('span', null, search.trim() ? '搜索结果' : '最近对话'), h('button', { onClick: refreshRecent, title: '刷新' }, '↻')),
        h('div', { className: 'hws3-recents' }, recent.loading && !search.trim() ? h('div', { className: 'hws3-loading' }, h(Spinner)) : sessions.length ? sessions.map((s) => h(SessionMenu, { key: s.id || s.session_id, session: s, onOpen: () => { openSession(s); setMobileOpen(false); }, onRename: () => onRename(s), onArchive: () => onArchive(s), onDelete: () => onDelete(s) })) : h('p', { className: 'hws3-muted' }, '暂无会话')),
        h('nav', { className: 'hws3-hermes-nav' }, HERMES_PRIMARY.map(([path, label, icon]) => h('a', { href: baseHref(path), key: path }, h('span', null, icon), label))),
        h('details', { className: 'hws3-advanced' }, h('summary', null, h('span', null, '⋯'), '高级'), h('div', null, HERMES_ADVANCED.map(([path, label]) => h('a', { href: baseHref(path), key: path, target: /^https?:\/\//.test(path) ? '_blank' : undefined, rel: /^https?:\/\//.test(path) ? 'noreferrer' : undefined }, label)))),
        h('footer', { className: 'hws3-side-foot' }, h(Pill, { tone: 'good' }, 'Hermes'), h(Pill, { tone: ready ? 'good' : 'neutral' }, ready ? '完全访问' : '受控'), h(Pill, null, mode === 'DELEGATE' ? 'WORKER' : mode)),
      ),
    );
  }

  function StudioApp() {
    const [view, setView] = useState('chat');
    const [recent, setRecent] = useState({ loading: true, sessions: [], error: '' });
    const [current, setCurrent] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [draft, setDraft] = useState('');
    const [attachments, setAttachments] = useState([]);
    const [run, setRun] = useState(null);
    const [contextSnapshot, setContextSnapshot] = useState(null);
    const [streamText, setStreamText] = useState('');
    const [timelineExpanded, setTimelineExpanded] = useState(true);
    const [skillDiff, setSkillDiff] = useState(null);
    const [config, setConfig] = useState({});
    const [modelOptions, setModelOptions] = useState(null);
    const [chatRoute, setChatRoute] = useState({ provider: '', model: '', effort: 'auto' });
    const [health, setHealth] = useState(null);
    const [globalError, setGlobalError] = useState('');
    const [now, setNow] = useState(Date.now());
    const [mobileOpen, setMobileOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [modal, setModal] = useState(null);
    const [modalInput, setModalInput] = useState('');
    const runPollRef = useRef(null);
    const skillBeforeRef = useRef([]);
    const sending = Boolean(run && !TERMINAL_RUN_STATES.has(run.status));

    useEffect(() => { ensureBranding(); document.documentElement.dataset.hwsStudio = 'true'; return () => { delete document.documentElement.dataset.hwsStudio; }; }, []);
    const refreshConfig = useCallback(async () => { const cfg = unwrapConfig(await api('/api/config')); setConfig(cfg); return cfg; }, []);
    const refreshOptions = useCallback(async (refresh = false) => { const data = await api(`/api/model/options${refresh ? '?refresh=1' : ''}`); setModelOptions(data); setChatRoute((route) => normalizeRoute(data, route?.model ? route : defaultRoute(data))); return data; }, []);
    const refreshRecent = useCallback(async () => {
      setRecent((x) => ({ ...x, loading: true, error: '' }));
      try { const data = await api(`/api/sessions?limit=${RECENT_LIMIT}&offset=0&order=recent&archived=exclude`); const sessions = data.sessions || []; setRecent({ loading: false, sessions, error: '' }); return sessions; }
      catch (err) { setRecent((x) => ({ ...x, loading: false, error: errorText(err) })); return []; }
    }, []);
    const loadMessages = useCallback(async (session) => {
      if (!session?.id) { setMessages([]); return; }
      setMessagesLoading(true); setGlobalError('');
      try { const data = await api(`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=${CHAT_MESSAGE_LIMIT}&order=latest`); setMessages(data.messages || data.data || []); }
      catch (err) { setGlobalError(errorText(err)); } finally { setMessagesLoading(false); }
    }, []);
    const loadContext = useCallback(async (session) => {
      if (!session?.id) { setContextSnapshot(null); return null; }
      try {
        const data = await plugin(`/hermes/sessions/${encodeURIComponent(session.id)}/context`);
        setContextSnapshot(data?.available === false ? null : data);
        return data;
      } catch (_) {
        setContextSnapshot(null);
        return null;
      }
    }, []);
    const openSession = useCallback((row) => { const id = row?.id || row?.session_id; if (!id) return; const s = { ...row, id }; setCurrent(s); setView('chat'); setRun(null); setContextSnapshot(null); setStreamText(''); setSkillDiff(null); setTimelineExpanded(false); setAttachments([]); loadMessages(s); loadContext(s); }, [loadMessages, loadContext]);
    useEffect(() => { Promise.all([refreshRecent(), refreshConfig(), refreshOptions(false), plugin('/health').then(setHealth)]).catch((err) => setGlobalError(errorText(err))); }, []);
    useEffect(() => { if (!sending) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [sending]);
    useEffect(() => () => { if (runPollRef.current?.timer) clearTimeout(runPollRef.current.timer); }, []);
    useEffect(() => {
      if (!search.trim()) { setSearchResults([]); return; }
      const t = setTimeout(async () => { try { const data = await api(`/api/sessions/search?q=${encodeURIComponent(search.trim())}&limit=40`); setSearchResults((data.results || []).map((x) => ({ ...x, id: x.id || x.session_id }))); } catch (_) { setSearchResults([]); } }, 180);
      return () => clearTimeout(t);
    }, [search]);

    const pollRun = useCallback((runId, initial) => {
      runPollRef.current = { runId, seq: 0, timer: null };
      setRun({ ...initial, events: [], elapsed_ms: 0, last_seq: 0 });
      if (initial?.context) setContextSnapshot(initial.context);
      const tick = async () => {
        const ref = runPollRef.current; if (!ref || ref.runId !== runId) return;
        try {
          const data = await plugin(`/hermes/runs/${encodeURIComponent(runId)}?after=${ref.seq}`);
          const incoming = data.events || [];
          if (incoming.length) { ref.seq = Math.max(ref.seq, ...incoming.map((e) => Number(e.seq || 0))); const delta = incoming.filter((e) => ['assistant.delta', 'message.delta'].includes(e.event)).map((e) => deltaText(e.data)).join(''); if (delta) setStreamText((x) => x + delta); const contextEvent = [...incoming].reverse().find((e) => String(e.event || '').startsWith('context.')); if (contextEvent) { const normalized = normalizeContextPayload(contextEvent.data); if (normalized) setContextSnapshot((old) => mergeContext(normalizeContextPayload(old), normalized)); } }
          setRun((prev) => ({ ...(prev || initial), ...data, events: [...(prev?.events || []), ...incoming].slice(-10000) }));
          if (TERMINAL_RUN_STATES.has(String(data.status || '').toLowerCase())) {
            setTimelineExpanded(false); runPollRef.current = null;
            if (data.session_id) { await loadMessages({ id: data.session_id }); await loadContext({ id: data.session_id }); }
            const sessions = await refreshRecent(); setCurrent((cur) => sessions.find((s) => s.id === cur?.id) || cur);
            try { const afterSkills = await api('/api/skills'); setSkillDiff(diffSkills(skillBeforeRef.current, afterSkills)); } catch (_) { setSkillDiff(null); }
            return;
          }
          ref.timer = setTimeout(tick, 650); runPollRef.current = ref;
        } catch (err) { setRun((prev) => ({ ...(prev || initial), status: 'failed', ended_at: Date.now() / 1000, events: [...(prev?.events || []), { seq: Date.now(), event: 'studio.error', data: { error: errorText(err) }, at: Date.now() / 1000 }] })); setTimelineExpanded(false); runPollRef.current = null; }
      };
      tick();
    }, [loadMessages, loadContext, refreshRecent]);

    const createSession = useCallback(async (text) => {
      const title = titleFromPrompt(text);
      const out = await plugin('/hermes/sessions', jinit('POST', { title, source: 'hermes_browser' }));
      const id = getSessionId(out); if (!id) throw new Error('Hermes did not return a session id');
      const session = out.session || { id, title, source: 'hermes_browser' }; setCurrent(session); setMessages([]); setContextSnapshot(null); await refreshRecent(); return session;
    }, [refreshRecent]);
    const lockRuntime = useCallback(async (session, route) => { const normalized = normalizeRoute(modelOptions, route); if (!session?.id || !normalized.model || !normalized.provider) return normalized; await plugin(`/hermes/sessions/${encodeURIComponent(session.id)}/model`, jinit('POST', { provider: normalized.provider, model: normalized.model, require_model_lock: true })); return normalized; }, [modelOptions]);

    const send = useCallback(async () => {
      const text = draft.trim();
      if (sending) {
        if (!text) return;
        try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/steer`, jinit('POST', { input: text })); setDraft(''); }
        catch (err) { setGlobalError(`调整方向失败：${errorText(err)}`); }
        return;
      }
      if (!text && !attachments.length) return;
      setGlobalError(''); setTimelineExpanded(true); setStreamText(''); setSkillDiff(null);
      try {
        try { skillBeforeRef.current = await api('/api/skills'); } catch (_) { skillBeforeRef.current = []; }
        const session = current?.id ? current : await createSession(text || '图片对话');
        const route = await lockRuntime(session, chatRoute);
        const localContent = text || `[${attachments.length} 张图片]`;
        setMessages((xs) => [...xs, { role: 'user', content: localContent, id: `local-${Date.now()}` }]);
        const parts = [];
        if (text) parts.push({ type: 'text', text });
        for (const item of attachments) parts.push({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'high' } });
        const input = attachments.length ? [{ role: 'user', content: parts }] : text;
        setDraft(''); setAttachments([]);
        const body = { session_id: session.id, input, provider: route.provider, model: route.model };
        if (route.effort && route.effort !== 'auto') body.model_options = { reasoning_effort: route.effort };
        const started = await plugin('/hermes/runs-v3', jinit('POST', body)); pollRun(started.id, started);
      } catch (err) { setGlobalError(errorText(err)); }
    }, [draft, sending, run?.id, attachments, current, createSession, lockRuntime, chatRoute, pollRun]);

    const stopRun = useCallback(async () => { if (!run?.id) return; try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/stop`, jinit('POST', {})); } catch (err) { setGlobalError(`停止 Run 失败：${errorText(err)}`); } }, [run?.id]);
    const approveRun = useCallback(async (choice) => { if (!run?.id) return; try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/approval`, jinit('POST', { choice })); } catch (err) { setGlobalError(`审批提交失败：${errorText(err)}`); } }, [run?.id]);
    const newConversation = useCallback(() => { setCurrent(null); setMessages([]); setRun(null); setContextSnapshot(null); setStreamText(''); setDraft(''); setAttachments([]); setSkillDiff(null); setView('chat'); }, []);

    function askRename(session = current) { if (!session?.id) return; setModalInput(sessionTitle(session)); setModal({ type: 'rename', session }); }
    function askDelete(session = current) { if (!session?.id) return; setModal({ type: 'delete', session }); }
    async function toggleArchive(session = current) {
      if (!session?.id) return;
      try { await api(`/api/sessions/${encodeURIComponent(session.id)}`, jinit('PATCH', { archived: !session.archived })); if (current?.id === session.id) setCurrent((x) => ({ ...x, archived: !session.archived })); await refreshRecent(); }
      catch (err) { setGlobalError(errorText(err)); }
    }
    async function confirmModal() {
      if (!modal?.session?.id) return;
      try {
        if (modal.type === 'rename') { await api(`/api/sessions/${encodeURIComponent(modal.session.id)}`, jinit('PATCH', { title: modalInput.trim() })); if (current?.id === modal.session.id) setCurrent((x) => ({ ...x, title: modalInput.trim() })); }
        if (modal.type === 'delete') { await api(`/api/sessions/${encodeURIComponent(modal.session.id)}`, jinit('DELETE')); if (current?.id === modal.session.id) newConversation(); }
        setModal(null); await refreshRecent();
      } catch (err) { setGlobalError(errorText(err)); }
    }

    const ready = unattendedReady(config);
    const mode = studioMode(config);
    const content = view === 'worker' ? h(WorkerPage, { config, modelOptions, chatRoute, refreshConfig })
      : view === 'models' ? h(ModelsPage, { modelOptions, refreshOptions })
      : view === 'unattended' ? h(UnattendedPage, { config, refreshConfig })
      : view === 'history' ? h(HistoryPage, { onOpenSession: openSession, onSessionMutation: refreshRecent })
      : h(Conversation, { session: current, messages, loading: messagesLoading, run, contextSnapshot, streamText, draft, setDraft, onSend: send, sending, modelOptions, chatRoute, setChatRoute: (route) => setChatRoute(normalizeRoute(modelOptions, route)), now, onStop: stopRun, onApprove: approveRun, skillDiff, timelineExpanded, setTimelineExpanded, attachments, setAttachments, onRename: () => askRename(current), onArchive: () => toggleArchive(current), onDelete: () => askDelete(current) });

    return h('div', { className: 'hws3-root' },
      h(Sidebar, { view, setView, recent, current, openSession, newConversation, refreshRecent, ready, mode, mobileOpen, setMobileOpen, onRename: askRename, onArchive: toggleArchive, onDelete: askDelete, search, setSearch, searchResults }),
      h('main', { className: 'hws3-main' },
        h('div', { className: 'hws3-mobile-bar' }, h('button', { onClick: () => setMobileOpen(true), title: '菜单' }, '☰'), h('div', null, h(HermesMark, { compact: true }), h('strong', null, 'Hermes Worker Studio')), h(Pill, { tone: ready ? 'good' : 'neutral' }, ready ? '完全访问' : '受控')),
        h(ErrorBar, { error: globalError || recent.error || (health?.ok === false ? 'Hermes 服务异常' : ''), onClear: () => setGlobalError('') }),
        content,
      ),
      modal ? h(Modal, { title: modal.type === 'rename' ? '重命名会话' : '删除会话？', body: modal.type === 'delete' ? `将永久删除“${sessionTitle(modal.session)}”。此操作调用 Hermes 官方 DELETE Session API。` : null, inputValue: modal.type === 'rename' ? modalInput : undefined, setInputValue: setModalInput, confirmText: modal.type === 'rename' ? '保存' : '删除', destructive: modal.type === 'delete', onConfirm: confirmModal, onClose: () => setModal(null) }) : null,
    );
  }

  window.__HERMES_PLUGINS__.register('hermes-worker-studio', StudioApp);
  if (typeof window.__HERMES_PLUGINS__.registerSlot === 'function') {
    window.__HERMES_PLUGINS__.registerSlot('hermes-worker-studio', 'header-left', ReturnToStudioSlot);
  }
})();