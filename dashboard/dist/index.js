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
  // Resolve the SDK method at call time so dynamically installed capability
  // layers are honored even when this bundle executes before they finish.
  function fetchJSON(path, init) { return SDK.fetchJSON(path, init); }
  const PLUGIN = '/api/plugins/hermes-worker-studio';
  const RECENT_LIMIT = 10;
  const CHAT_MESSAGE_LIMIT = 40;
  const HISTORY_SESSION_LIMIT = 20;
  const HISTORY_MESSAGE_LIMIT = 100;
  const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'incomplete', 'cancelled', 'stopped']);

  const PRIMARY_NAV = [
    ['chat', '对话', '✦'],
    ['worker', 'Worker', '⇄'],
    ['models', '模型', '◫'],
    ['unattended', '无人值守', '⚡'],
    ['history', '完整历史', '☷'],
  ];
  const HERMES_PRIMARY = [
    ['/skills', '技能', '◇'],
    ['/plugins', '插件', '⬡'],
    ['/mcp', 'MCP', '⌘'],
  ];
  const HERMES_SECONDARY = [
    ['/cron', '自动化 / Cron'],
    ['/profiles', 'Profiles'],
    ['/analytics', 'Analytics'],
    ['/logs', 'Logs'],
    ['/config', 'Config'],
    ['https://github.com/NousResearch/hermes-agent/tree/main/website/docs', 'Docs'],
  ];

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
    return text.replace(/^\d+:\s*/, '').slice(0, 2000);
  }

  function fmtDuration(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (total < 60) return `${total}秒`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return `${m}分${s ? `${s}秒` : ''}`;
    return `${Math.floor(m / 60)}小时${m % 60}分`;
  }

  function fmtTime(value) {
    if (!value) return '';
    const n = Number(value);
    const date = Number.isFinite(n) ? new Date(n > 1e12 ? n : n * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function shortText(value, max = 120) {
    const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    const one = text.replace(/\s+/g, ' ').trim();
    return one.length > max ? one.slice(0, max - 1) + '…' : one;
  }

  function clone(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : {};
  }

  function unwrapConfig(raw) {
    return raw?.config && typeof raw.config === 'object' ? raw.config : (raw && typeof raw === 'object' ? raw : {});
  }

  function studioMode(cfg) {
    const raw = String(cfg?.plugins?.entries?.['hermes-worker-studio']?.settings?.mode || 'AUTO').toUpperCase();
    return raw === 'WORKER' ? 'DELEGATE' : ['OFFICIAL', 'AUTO', 'DELEGATE', 'MAIN'].includes(raw) ? raw : 'MAIN';
  }

  function withStudioMode(cfg, mode) {
    const next = clone(cfg);
    next.plugins = { ...(next.plugins || {}) };
    next.plugins.entries = { ...(next.plugins.entries || {}) };
    const old = next.plugins.entries['hermes-worker-studio'] || {};
    next.plugins.entries['hermes-worker-studio'] = {
      ...old,
      settings: { ...(old.settings || {}), mode },
    };
    return next;
  }

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

  function skillsArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.skills)) return payload.skills;
    return [];
  }

  function skillKey(skill) {
    return String(skill?.name || skill?.id || skill?.path || '').trim();
  }

  function diffSkills(before, after) {
    const left = new Map(skillsArray(before).map((x) => [skillKey(x), x]).filter(([key]) => key));
    const right = new Map(skillsArray(after).map((x) => [skillKey(x), x]).filter(([key]) => key));
    return {
      added: [...right.keys()].filter((key) => !left.has(key)),
      removed: [...left.keys()].filter((key) => !right.has(key)),
      toggled: [...right.keys()].filter((key) => left.has(key) && Boolean(left.get(key)?.enabled) !== Boolean(right.get(key)?.enabled)),
    };
  }

  function sessionTitle(session) {
    return session?.title || session?.preview || session?.id || '未命名对话';
  }

  function getSessionId(payload) {
    return payload?.session?.id || payload?.session_id || payload?.id || null;
  }

  function providerRows(options) {
    return Array.isArray(options?.providers) ? options.providers : [];
  }

  function providerBySlug(options, slug) {
    return providerRows(options).find((p) => p.slug === slug || (Array.isArray(p.aliases) && p.aliases.includes(slug)));
  }

  function modelsFor(options, slug) {
    const row = providerBySlug(options, slug);
    return Array.isArray(row?.models) ? row.models : [];
  }

  function authenticatedProviders(options) {
    const rows = providerRows(options).filter((p) => p.authenticated !== false && Array.isArray(p.models) && p.models.length);
    return rows.length ? rows : providerRows(options).filter((p) => Array.isArray(p.models) && p.models.length);
  }

  function defaultRoute(options) {
    const rows = authenticatedProviders(options);
    let provider = String(options?.provider || '');
    let row = providerBySlug(options, provider);
    if (!row || !Array.isArray(row.models) || !row.models.length) row = rows.find((x) => x.is_current) || rows[0];
    provider = row?.slug || '';
    const models = Array.isArray(row?.models) ? row.models : [];
    const model = models.includes(options?.model) ? options.model : (models[0] || '');
    return { provider, model, effort: 'auto' };
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

  function modelCapability(options, provider, model) {
    return providerBySlug(options, provider)?.capabilities?.[model] || {};
  }

  function reasoningOptions(options, provider, model) {
    const cap = modelCapability(options, provider, model);
    const candidates = [
      cap?.reasoning?.options,
      cap?.reasoning_efforts,
      cap?.reasoningEfforts,
      cap?.supported_reasoning_efforts,
      cap?.supportedReasoningEfforts,
    ];
    const exact = [];
    for (const values of candidates) {
      if (!Array.isArray(values)) continue;
      for (const item of values) {
        const value = typeof item === 'string' ? item : item?.value;
        if (value && value !== 'auto' && !exact.some((x) => x.value === String(value))) {
          exact.push({ value: String(value), description: typeof item === 'object' ? String(item.description || '') : '' });
        }
      }
    }
    return [{ value: 'auto', description: '上游未指定时使用 Hermes/provider 默认值' }, ...exact];
  }

  function deltaText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    for (const key of ['delta', 'text', 'content', 'output_text']) {
      if (typeof data[key] === 'string') return data[key];
    }
    return '';
  }

  function toolName(data) {
    return data?.tool_name || data?.name || data?.tool?.name || data?.function?.name || data?.tool_call?.function?.name || 'tool';
  }

  function eventSummary(event) {
    const name = String(event?.event || 'event');
    const data = event?.data || {};
    if (name === 'run.started') return 'Hermes Run 开始';
    if (name === 'run.completed') return '任务执行完成';
    if (['run.failed', 'run.error'].includes(name)) return '任务执行失败';
    if (['run.cancelled', 'run.canceled', 'run.stopped'].includes(name)) return '任务已停止';
    if (name === 'message.delta') return 'Hermes 文本流';
    if (name === 'tool.started') return `执行工具 · ${toolName(data)}`;
    if (name === 'tool.completed') return `工具完成 · ${toolName(data)}`;
    if (name === 'tool.failed') return `工具失败 · ${toolName(data)}`;
    if (name === 'todo.updated' || name.includes('todo')) return 'Hermes 计划更新';
    if (name.includes('approval')) return '审批事件';
    if (name.includes('subagent') || name.includes('delegat')) return `Hermes 子代理 · ${name}`;
    return name;
  }

  function eventDetail(event) {
    const data = event?.data || {};
    const name = String(event?.event || '');
    if (name === 'tool.started') return shortText(data.arguments || data.args || data.input || '', 280);
    if (name === 'tool.completed' || name === 'tool.failed') return shortText(data.result || data.output || data.error || '', 280);
    if (name.includes('todo')) return shortText(data, 360);
    if (name.includes('error') || name.includes('failed')) return shortText(data.error || data.message || data, 360);
    return '';
  }

  function approvalChoices(event) {
    const name = String(event?.event || '').toLowerCase();
    if (!name.includes('approval')) return [];
    const values = Array.isArray(event?.data?.choices) ? event.data.choices : [];
    return values.map((x) => String(x).toLowerCase()).filter((x) => ['once', 'session', 'always', 'deny'].includes(x));
  }

  function Button({ children, className = '', ...props }) {
    return h('button', { ...props, className: `hws-button ${className}`.trim() }, children);
  }

  function Pill({ children, tone = 'neutral' }) {
    return h('span', { className: `hws-pill ${tone}` }, children);
  }

  function Spinner() {
    return h('span', { className: 'hws-spinner', 'aria-hidden': 'true' });
  }

  function Empty({ children }) {
    return h('div', { className: 'hws-empty' }, children);
  }

  function ErrorBar({ error, onClear }) {
    if (!error) return null;
    return h('div', { className: 'hws-error' },
      h('span', null, error),
      onClear ? h('button', { onClick: onClear, title: '关闭' }, '×') : null,
    );
  }

  function SessionRow({ session, active, onClick }) {
    return h('button', { className: `hws-session-row ${active ? 'active' : ''}`, onClick },
      h('span', { className: 'hws-session-dot', 'aria-hidden': 'true' }, session?.is_active ? '●' : '○'),
      h('span', { className: 'hws-session-copy' },
        h('strong', null, shortText(sessionTitle(session), 58)),
        h('small', null, [session?.model, fmtTime(session?.last_active || session?.started_at)].filter(Boolean).join(' · ')),
      ),
    );
  }

  function MessageBubble({ msg }) {
    const role = msg?.role || 'system';
    if (role === 'tool') {
      return h('details', { className: 'hws-tool-message' },
        h('summary', null, `工具结果${msg?.tool_name ? ` · ${msg.tool_name}` : ''}`),
        h('pre', null, typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg?.content, null, 2)),
      );
    }
    if (msg?.display_kind === 'hidden') return null;
    const content = typeof msg?.display_content === 'string' ? msg.display_content : msg?.content;
    const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    return h('div', { className: `hws-message ${role}` },
      h('div', { className: 'hws-message-meta' }, role === 'user' ? '你' : role === 'assistant' ? 'Hermes' : role),
      content ? h('div', { className: 'hws-message-content' }, typeof content === 'string' ? content : JSON.stringify(content, null, 2)) : null,
      calls.length ? h('details', { className: 'hws-tool-calls' },
        h('summary', null, `工作调用 ${calls.length} 项`),
        calls.map((call, i) => h('div', { className: 'hws-call', key: call?.id || i },
          h('strong', null, call?.function?.name || call?.name || 'tool'),
          h('pre', null, call?.function?.arguments || call?.arguments || ''),
        )),
      ) : null,
    );
  }

  function RouteSelector({ options, route, onChange, disabled, label = '模型' }) {
    const normalized = normalizeRoute(options, route);
    const providers = authenticatedProviders(options);
    const models = modelsFor(options, normalized.provider);
    const efforts = reasoningOptions(options, normalized.provider, normalized.model);
    const effortIndex = Math.max(0, efforts.findIndex((x) => x.value === normalized.effort));
    return h('div', { className: 'hws-chat-route' },
      h('label', null, 'Provider',
        h('select', {
          value: normalized.provider,
          disabled: disabled || !providers.length,
          onChange: (e) => {
            const provider = e.target.value;
            onChange({ provider, model: modelsFor(options, provider)[0] || '', effort: 'auto' });
          },
        }, providers.map((p) => h('option', { key: p.slug, value: p.slug }, p.name || p.slug))),
      ),
      h('label', null, label,
        h('select', {
          value: normalized.model,
          disabled: disabled || !models.length,
          onChange: (e) => onChange({ ...normalized, model: e.target.value, effort: 'auto' }),
        }, models.map((model) => h('option', { key: model, value: model }, model))),
      ),
      h('label', { className: 'hws-effort-inline' },
        h('span', null, `思考强度 · ${efforts[effortIndex]?.value || 'auto'}`),
        h('input', {
          type: 'range',
          min: 0,
          max: Math.max(0, efforts.length - 1),
          step: 1,
          value: effortIndex,
          disabled: disabled || efforts.length <= 1,
          onChange: (e) => onChange({ ...normalized, effort: efforts[Number(e.target.value)]?.value || 'auto' }),
        }),
        h('small', null, efforts.length <= 1
          ? '该模型未通过官方元数据声明 reasoning 档位；Studio 严格保持 Auto。'
          : efforts.map((x) => x.value).join(' · ')),
      ),
    );
  }

  function WorkTimeline({ run, expanded, setExpanded, now, skillDiff, onApprove }) {
    if (!run) return null;
    const done = TERMINAL_RUN_STATES.has(run.status);
    const started = Number(run.started_at || 0) * 1000;
    const ended = run.ended_at ? Number(run.ended_at) * 1000 : null;
    const duration = run.elapsed_ms != null ? run.elapsed_ms : Math.max(0, (ended || now) - started);
    const lifecycle = (run.events || []).filter((e) => !['assistant.delta', 'message.delta'].includes(e.event));
    return h('section', { className: `hws-work ${done ? 'done' : 'running'}` },
      h('button', { className: 'hws-work-head', type: 'button', onClick: () => setExpanded(!expanded) },
        h('span', { className: 'hws-work-state' }, done ? (run.status === 'completed' ? '✓' : '!') : h(Spinner)),
        h('strong', null, done ? `工作过程 · ${run.status === 'completed' ? '已完成' : run.status}` : '工作进行中'),
        h('span', { className: 'hws-work-duration' }, fmtDuration(duration)),
        h('span', { className: 'hws-work-count' }, `${lifecycle.length} 项`),
        h('span', { className: 'hws-chevron' }, expanded ? '⌃' : '⌄'),
      ),
      expanded ? h('div', { className: 'hws-work-body' },
        lifecycle.length ? lifecycle.map((event) => h('div', { className: 'hws-work-event', key: event.seq },
          h('span', { className: 'hws-event-dot' }),
          h('div', null,
            h('strong', null, eventSummary(event)),
            eventDetail(event) ? h('small', null, eventDetail(event)) : null,
            approvalChoices(event).length ? h('div', { className: 'hws-approval-actions' },
              approvalChoices(event).map((choice) => h(Button, {
                key: choice,
                className: choice === 'deny' ? 'danger small' : 'ghost small',
                onClick: () => onApprove?.(choice),
              }, choice)),
            ) : null,
          ),
          h('time', null, fmtTime(event.at)),
        )) : h('div', { className: 'hws-muted' }, '等待 Hermes 返回真实 Run lifecycle 事件…'),
        skillDiff && (skillDiff.added.length || skillDiff.removed.length || skillDiff.toggled.length)
          ? h('details', { className: 'hws-skill-diff', open: true },
              h('summary', null, 'Hermes Skills 变化'),
              skillDiff.added.length ? h('p', null, `新增: ${skillDiff.added.join(' · ')}`) : null,
              skillDiff.removed.length ? h('p', null, `移除: ${skillDiff.removed.join(' · ')}`) : null,
              skillDiff.toggled.length ? h('p', null, `启停变化: ${skillDiff.toggled.join(' · ')}`) : null,
            )
          : null,
        run.truncated ? h('div', { className: 'hws-warning-note' }, '展示事件超过本地上限；Hermes 上游会话记录未被修改。') : null,
      ) : null,
    );
  }

  function Conversation({
    session, messages, loading, onArchive, run, timelineExpanded, setTimelineExpanded,
    streamText, draft, setDraft, onSend, sending, modelOptions, chatRoute, setChatRoute,
    now, onStop, onSteer, onApprove, skillDiff,
  }) {
    const [steer, setSteer] = useState('');
    return h('section', { className: 'hws-conversation' },
      h('header', { className: 'hws-conversation-head' },
        h('div', null,
          h('h2', null, session ? sessionTitle(session) : '新对话'),
          h('p', null, session ? `${session.id} · 首屏仅读取最近 ${CHAT_MESSAGE_LIMIT} 条消息` : '发送第一条消息时创建 Hermes Session'),
        ),
        session ? h(Button, { className: 'ghost', onClick: onArchive, disabled: sending }, session.archived ? '取消归档' : '归档') : null,
      ),
      modelOptions ? h(RouteSelector, { options: modelOptions, route: chatRoute, onChange: setChatRoute, disabled: sending }) : null,
      h('div', { className: 'hws-transcript' },
        loading ? h(Empty, null, h(Spinner), ' 正在读取最近消息…') : null,
        !loading && !(messages || []).length && !run ? h(Empty, null, '这是一个干净的新对话。') : null,
        (messages || []).map((msg, i) => h(MessageBubble, { msg, key: msg?.id || `${msg?.role}-${i}` })),
        run ? h(WorkTimeline, { run, expanded: timelineExpanded, setExpanded: setTimelineExpanded, now, skillDiff, onApprove }) : null,
        streamText && run && !TERMINAL_RUN_STATES.has(run.status)
          ? h('div', { className: 'hws-message assistant live' },
              h('div', { className: 'hws-message-meta' }, 'Hermes · 实时'),
              h('div', { className: 'hws-message-content' }, streamText),
            )
          : null,
      ),
      sending && run?.id ? h('div', { className: 'hws-run-controls' },
        h(Button, { className: 'danger small', type: 'button', onClick: onStop }, '停止 Run'),
        h('input', { value: steer, onChange: (e) => setSteer(e.target.value), placeholder: '给正在运行的 Hermes 追加 steering…' }),
        h(Button, {
          className: 'ghost small',
          type: 'button',
          disabled: !steer.trim(),
          onClick: async () => {
            const value = steer.trim();
            if (!value) return;
            await onSteer?.(value);
            setSteer('');
          },
        }, 'Steer'),
      ) : null,
      h('form', { className: 'hws-composer', onSubmit: (e) => { e.preventDefault(); onSend(); } },
        h('textarea', {
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          placeholder: '给 Hermes 发送消息…',
          rows: 3,
          disabled: sending,
          onKeyDown: (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
          },
        }),
        h(Button, { type: 'submit', className: 'primary send', disabled: sending || !draft.trim() },
          sending ? h(React.Fragment, null, h(Spinner), ' 执行中') : '发送'),
      ),
    );
  }

  function HistoryPage({ onBackToChat }) {
    const [kind, setKind] = useState('exclude');
    const [page, setPage] = useState(1);
    const [q, setQ] = useState('');
    const [state, setState] = useState({ loading: true, rows: [], total: 0, error: '' });
    const [detail, setDetail] = useState({ session: null, loading: false, messages: [], page: 1, error: '' });

    const load = useCallback(async () => {
      const value = q.trim();
      setState((s) => ({ ...s, loading: true, error: '' }));
      try {
        if (value) {
          const data = await api(`/api/sessions/search?q=${encodeURIComponent(value)}&limit=50`);
          setState({ loading: false, rows: data.results || [], total: (data.results || []).length, error: '' });
        } else {
          const offset = (page - 1) * HISTORY_SESSION_LIMIT;
          const data = await api(`/api/sessions?limit=${HISTORY_SESSION_LIMIT}&offset=${offset}&order=recent&archived=${kind}`);
          setState({ loading: false, rows: data.sessions || [], total: Number(data.total || 0), error: '' });
        }
      } catch (error) {
        setState({ loading: false, rows: [], total: 0, error: errorText(error) });
      }
    }, [q, page, kind]);

    useEffect(() => {
      const timer = setTimeout(load, q.trim() ? 220 : 0);
      return () => clearTimeout(timer);
    }, [load]);

    const open = useCallback(async (row, messagePage = 1) => {
      const session = { ...row, id: row.id || row.session_id };
      if (!session.id) return;
      setDetail({ session, loading: true, messages: [], page: messagePage, error: '' });
      try {
        const offset = (messagePage - 1) * HISTORY_MESSAGE_LIMIT;
        const data = await api(`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=${HISTORY_MESSAGE_LIMIT}&offset=${offset}&order=oldest`);
        setDetail({ session, loading: false, messages: data.messages || data.data || [], page: messagePage, error: '' });
      } catch (error) {
        setDetail((d) => ({ ...d, loading: false, error: errorText(error) }));
      }
    }, []);

    const totalPages = Math.max(1, Math.ceil(state.total / HISTORY_SESSION_LIMIT));
    const messageCount = Number(detail.session?.message_count || 0);
    const messagePages = Math.max(1, Math.ceil(messageCount / HISTORY_MESSAGE_LIMIT));

    return h('section', { className: 'hws-page-grid' },
      h('div', { className: 'hws-list-pane' },
        h('div', { className: 'hws-section-head' },
          h('div', null, h('h2', null, '完整历史'), h('p', null, '分页读取 + Hermes 官方 FTS 搜索，不扫描浏览器内存')),
        ),
        h('div', { className: 'hws-mode-tabs' },
          h(Button, { className: kind === 'exclude' ? 'selected' : 'ghost', onClick: () => { setKind('exclude'); setPage(1); } }, '对话'),
          h(Button, { className: kind === 'only' ? 'selected' : 'ghost', onClick: () => { setKind('only'); setPage(1); } }, '已归档'),
        ),
        h('input', {
          className: 'hws-search-input',
          value: q,
          onChange: (e) => { setQ(e.target.value); setPage(1); },
          placeholder: '搜索消息内容或 Session ID…',
        }),
        h(ErrorBar, { error: state.error }),
        state.loading ? h(Empty, null, h(Spinner), ' 加载中…') : null,
        !state.loading && !state.rows.length ? h(Empty, null, q.trim() ? '没有匹配结果' : '暂无历史') : null,
        state.rows.map((row, i) => {
          const session = { ...row, id: row.id || row.session_id };
          return h(SessionRow, {
            key: session.id || i,
            session,
            active: detail.session?.id === session.id,
            onClick: () => open(session, 1),
          });
        }),
        !q.trim() ? h('div', { className: 'hws-pagination' },
          h(Button, { className: 'ghost', disabled: page <= 1, onClick: () => setPage(page - 1) }, '上一页'),
          h('span', null, `${page} / ${totalPages}`),
          h(Button, { className: 'ghost', disabled: page >= totalPages, onClick: () => setPage(page + 1) }, '下一页'),
        ) : null,
      ),
      h('div', { className: 'hws-detail-pane' },
        !detail.session ? h(Empty, null, '选择一个对话查看消息') : h(React.Fragment, null,
          h('div', { className: 'hws-section-head' },
            h('div', null, h('h2', null, sessionTitle(detail.session)), h('p', null, `${messageCount || '—'} 条消息`)),
            h(Button, { className: 'primary', onClick: () => onBackToChat(detail.session) }, '回到对话'),
          ),
          h(ErrorBar, { error: detail.error }),
          detail.loading ? h(Empty, null, h(Spinner), ' 读取消息…') : h('div', { className: 'hws-history-messages' },
            detail.messages.map((m, i) => h(MessageBubble, { msg: m, key: m.id || i })),
          ),
          messageCount ? h('div', { className: 'hws-pagination' },
            h(Button, { className: 'ghost', disabled: detail.page <= 1 || detail.loading, onClick: () => open(detail.session, detail.page - 1) }, '上一页'),
            h('span', null, `${detail.page} / ${messagePages}`),
            h(Button, { className: 'ghost', disabled: detail.page >= messagePages || detail.loading, onClick: () => open(detail.session, detail.page + 1) }, '下一页'),
          ) : null,
        ),
      ),
    );
  }

  function WorkerPage({ config, modelOptions, chatRoute, refreshConfig }) {
    const mode = studioMode(config);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const fallback = normalizeRoute(modelOptions, chatRoute);
    const delegation = config?.delegation || {};
    const review = config?.auxiliary?.review || {};
    const [workerRoute, setWorkerRoute] = useState(() => normalizeRoute(modelOptions, {
      provider: delegation.provider || fallback.provider,
      model: delegation.model || fallback.model,
      effort: delegation.reasoning_effort || 'auto',
    }));
    const [workerInherit, setWorkerInherit] = useState(!delegation.provider && !delegation.model);
    const [reviewRoute, setReviewRoute] = useState(() => normalizeRoute(modelOptions, {
      provider: review.provider && review.provider !== 'auto' ? review.provider : fallback.provider,
      model: review.model || fallback.model,
      effort: 'auto',
    }));
    const [reviewInherit, setReviewInherit] = useState(!review.model && (!review.provider || review.provider === 'auto'));

    useEffect(() => {
      const d = config?.delegation || {};
      const r = config?.auxiliary?.review || {};
      setWorkerInherit(!d.provider && !d.model);
      setWorkerRoute(normalizeRoute(modelOptions, {
        provider: d.provider || fallback.provider,
        model: d.model || fallback.model,
        effort: d.reasoning_effort || 'auto',
      }));
      setReviewInherit(!r.model && (!r.provider || r.provider === 'auto'));
      setReviewRoute(normalizeRoute(modelOptions, {
        provider: r.provider && r.provider !== 'auto' ? r.provider : fallback.provider,
        model: r.model || fallback.model,
        effort: 'auto',
      }));
    }, [config, modelOptions, fallback.provider, fallback.model]);

    async function saveMode(nextMode) {
      setBusy(true); setMessage('');
      try {
        const fresh = unwrapConfig(await api('/api/config'));
        await api('/api/config', jinit('PUT', { config: withStudioMode(fresh, nextMode) }));
        await refreshConfig();
        setMessage(`模式已切换为 ${nextMode === 'DELEGATE' ? 'WORKER' : nextMode}。`);
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    async function saveWorker() {
      setBusy(true); setMessage('');
      try {
        const cfg = clone(unwrapConfig(await api('/api/config')));
        const d = { ...(cfg.delegation || {}) };
        if (workerInherit) {
          delete d.provider; delete d.model; delete d.reasoning_effort;
        } else {
          d.provider = workerRoute.provider;
          d.model = workerRoute.model;
          if (workerRoute.effort && workerRoute.effort !== 'auto') d.reasoning_effort = workerRoute.effort;
          else delete d.reasoning_effort;
        }
        cfg.delegation = d;
        await api('/api/config', jinit('PUT', { config: cfg }));
        await refreshConfig();
        setMessage(workerInherit ? 'Worker 已恢复跟随 Main。' : 'Worker 已保存到 Hermes delegation.*。');
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    async function saveReview() {
      setBusy(true); setMessage('');
      try {
        const cfg = clone(unwrapConfig(await api('/api/config')));
        cfg.auxiliary = { ...(cfg.auxiliary || {}) };
        cfg.auxiliary.review = reviewInherit
          ? { ...(cfg.auxiliary.review || {}), provider: 'auto', model: '' }
          : { ...(cfg.auxiliary.review || {}), provider: reviewRoute.provider, model: reviewRoute.model };
        await api('/api/config', jinit('PUT', { config: cfg }));
        await refreshConfig();
        setMessage(reviewInherit ? '官方 /review 已恢复跟随 Main。' : '官方 /review 模型已保存。');
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    const descriptions = {
      OFFICIAL: 'Studio 不发起 worker_delegate；Hermes 原生 delegate_task 完全按官方默认行为运行。',
      AUTO: '允许 Hermes 原生 delegate_task，也允许 Studio 的 Hermes lifecycle worker_delegate；不替换 Hermes planner。',
      DELEGATE: '显式 Worker 偏好。执行仍然是 Hermes 公共 subagent lifecycle，不存在第二套 Worker 内核。',
      MAIN: '只允许 Main。Studio 的 pre_tool_call policy 会真正阻止 delegate_task 与 worker_delegate 新建子代理。',
    };

    return h('section', { className: 'hws-worker-page' },
      h('div', { className: 'hws-section-head' },
        h('div', null, h('h2', null, 'Hermes Worker'), h('p', null, '原生 subagent lifecycle + delegation 配置；没有 Codex sidecar、没有第二模型注册表。')),
        h(Pill, { tone: 'good' }, 'Hermes Native'),
      ),
      h('div', { className: 'hws-mode-tabs' },
        ['OFFICIAL', 'AUTO', 'DELEGATE', 'MAIN'].map((x) => h(Button, {
          key: x,
          className: mode === x ? 'selected' : 'ghost',
          disabled: busy,
          onClick: () => saveMode(x),
        }, x === 'DELEGATE' ? 'WORKER' : x)),
      ),
      h('div', { className: 'hws-official-panel' },
        h('strong', null, mode === 'DELEGATE' ? 'WORKER' : mode),
        h('p', null, descriptions[mode]),
      ),
      h('section', { className: 'hws-route-card' },
        h('header', null, h('div', null, h('small', null, 'MAIN'), h('h3', null, '当前对话')), h(Pill, null, 'Chat')),
        h('p', null, `${fallback.provider || '—'} · ${fallback.model || '—'} · reasoning ${fallback.effort || 'auto'}`),
        h('small', null, 'Main 路由只在对话顶部选择，不在 Worker 页重复维护。'),
      ),
      h('section', { className: 'hws-route-card' },
        h('header', null, h('div', null, h('small', null, 'WORKER'), h('h3', null, 'Hermes delegation.*')), h(Pill, { tone: workerInherit ? 'neutral' : 'good' }, workerInherit ? '跟随 Main' : '独立')),
        h('label', { className: 'hws-check' },
          h('input', { type: 'checkbox', checked: workerInherit, onChange: (e) => setWorkerInherit(e.target.checked) }),
          '跟随 Main provider/model',
        ),
        !workerInherit ? h(RouteSelector, { options: modelOptions, route: workerRoute, onChange: setWorkerRoute, disabled: busy, label: 'Worker Model' }) : null,
        h(Button, { className: 'primary', disabled: busy, onClick: saveWorker }, '保存 Worker 路由'),
      ),
      h('section', { className: 'hws-route-card' },
        h('header', null, h('div', null, h('small', null, 'VERIFIER'), h('h3', null, 'Hermes 官方 /review')), h(Pill, { tone: reviewInherit ? 'neutral' : 'good' }, reviewInherit ? '跟随 Main' : '独立')),
        h('p', null, 'Lifecycle verifier 使用 Hermes child lifecycle；独立 reviewer 路由由官方 auxiliary.review.* 管理。'),
        h('label', { className: 'hws-check' },
          h('input', { type: 'checkbox', checked: reviewInherit, onChange: (e) => setReviewInherit(e.target.checked) }),
          '官方 /review 跟随 Main',
        ),
        !reviewInherit ? h(RouteSelector, { options: modelOptions, route: reviewRoute, onChange: setReviewRoute, disabled: busy, label: 'Review Model' }) : null,
        h(Button, { className: 'primary', disabled: busy, onClick: saveReview }, '保存 Verifier / Review'),
      ),
      h('section', { className: 'hws-official-panel' },
        h('strong', null, '无人值守子代理'),
        h('p', null, `delegation.subagent_auto_approve = ${config?.delegation?.subagent_auto_approve === true ? 'true' : 'false'}。完整授权请在左侧“无人值守”一级入口完成实测。`),
      ),
      message ? h('div', { className: 'hws-result' }, message) : null,
    );
  }

  function ModelsPage({ modelOptions, refreshOptions }) {
    const [form, setForm] = useState({ name: 'Worker Studio New API', base_url: '', api_key: '', model: '' });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [tests, setTests] = useState({});
    const [query, setQuery] = useState('');

    async function saveEndpoint() {
      if (!form.base_url.trim() || !form.api_key) {
        setMessage('请输入 Base URL 与 API Key。');
        return;
      }
      setBusy(true); setMessage('');
      try {
        const draft = {
          name: form.name.trim() || 'Worker Studio New API',
          base_url: form.base_url.trim(),
          api_key: form.api_key,
          model: form.model.trim(),
          discover_models: true,
          make_default: false,
        };
        const validated = await api('/api/providers/custom-endpoints/validate', jinit('POST', draft));
        const models = Array.isArray(validated?.models) ? validated.models : [];
        const model = draft.model || models[0] || '';
        if (!model) throw new Error('Hermes 未从该 endpoint 发现任何模型；请手动填写 Model。');
        await api('/api/providers/custom-endpoints', jinit('POST', { ...draft, model, models }));
        setForm((x) => ({ ...x, api_key: '', model }));
        await refreshOptions(true);
        setMessage(`已保存为 Hermes Custom Endpoint；发现 ${models.length || 1} 个模型。`);
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    async function testModel(provider, model) {
      const key = `${provider}:${model}`;
      setTests((x) => ({ ...x, [key]: { loading: true } }));
      try {
        const result = await plugin('/hermes/model-probe', jinit('POST', { provider, model }));
        setTests((x) => ({ ...x, [key]: result }));
      } catch (error) {
        setTests((x) => ({ ...x, [key]: { ok: false, error: errorText(error) } }));
      }
    }

    const needle = query.trim().toLowerCase();
    const rows = authenticatedProviders(modelOptions);

    return h('section', { className: 'hws-worker-page' },
      h('div', { className: 'hws-section-head' },
        h('div', null, h('h2', null, '模型 / New API'), h('p', null, '唯一模型目录：Hermes /api/model/options。Keys / Providers 不再重复占侧边栏。')),
        h(Button, { className: 'ghost', disabled: busy, onClick: () => refreshOptions(true) }, '刷新官方目录'),
      ),
      h('section', { className: 'hws-provider-panel' },
        h('div', { className: 'hws-section-head compact' }, h('div', null, h('h3', null, '新增 Custom Endpoint'), h('p', null, '保存、验证、模型发现全部走 Hermes 官方接口。'))),
        h('div', { className: 'hws-provider-grid' },
          h('label', null, 'Name', h('input', { value: form.name, onChange: (e) => setForm((x) => ({ ...x, name: e.target.value })) })),
          h('label', null, 'Base URL', h('input', { value: form.base_url, onChange: (e) => setForm((x) => ({ ...x, base_url: e.target.value })), placeholder: 'https://example.com/v1' })),
          h('label', null, 'API Key', h('input', { type: 'password', autoComplete: 'off', value: form.api_key, onChange: (e) => setForm((x) => ({ ...x, api_key: e.target.value })), placeholder: '仅提交给 Hermes' })),
          h('label', null, 'Model（可选）', h('input', { value: form.model, onChange: (e) => setForm((x) => ({ ...x, model: e.target.value })), placeholder: '留空则使用发现结果' })),
        ),
        h(Button, { className: 'primary', disabled: busy, onClick: saveEndpoint }, busy ? '验证中…' : '验证并保存'),
      ),
      message ? h('div', { className: 'hws-result' }, message) : null,
      h('input', { className: 'hws-search-input', value: query, onChange: (e) => setQuery(e.target.value), placeholder: '搜索 Provider / Model…' }),
      h('div', { className: 'hws-connectivity' },
        rows.map((provider) => {
          const models = (provider.models || []).filter((m) => !needle || `${provider.name} ${provider.slug} ${m}`.toLowerCase().includes(needle));
          if (!models.length) return null;
          return h('section', { key: provider.slug, className: 'hws-model-provider' },
            h('div', { className: 'hws-section-head compact' },
              h('div', null, h('h3', null, provider.name || provider.slug), h('p', null, `${provider.slug} · ${provider.models.length} models${provider.is_user_defined ? ' · Custom Endpoint' : ''}`)),
              provider.is_current ? h(Pill, { tone: 'good' }, 'Current') : null,
            ),
            models.map((model) => {
              const key = `${provider.slug}:${model}`;
              const test = tests[key];
              const efforts = reasoningOptions(modelOptions, provider.slug, model);
              return h('div', { className: 'hws-model-test', key: model },
                h('div', null,
                  h('strong', null, model),
                  h('small', null, efforts.length <= 1 ? 'reasoning: Auto（官方未声明档位）' : `reasoning: ${efforts.map((x) => x.value).join(' / ')}`),
                ),
                test?.loading ? h(Spinner) : test ? h(Pill, { tone: test.ok ? 'good' : 'bad' }, test.ok ? '真实 Run 通过' : `失败 · ${shortText(test.error || test.status, 80)}`) : null,
                h(Button, { className: 'ghost small', disabled: test?.loading, onClick: () => testModel(provider.slug, model) }, '真实 Run 测试'),
              );
            }),
          );
        }),
      ),
    );
  }

  function UnattendedPage({ config, refreshConfig }) {
    const ready = unattendedReady(config);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    async function applyAndProbe() {
      setBusy(true); setMessage('');
      try {
        const cfg = clone(unwrapConfig(await api('/api/config')));
        cfg.approvals = {
          ...(cfg.approvals || {}),
          mode: 'off',
          cron_mode: 'approve',
          single_query_mode: 'approve',
          unattended_mode: 'approve',
          mcp_reload_confirm: false,
          destructive_slash_confirm: false,
        };
        cfg.delegation = { ...(cfg.delegation || {}), subagent_auto_approve: true };
        await api('/api/config', jinit('PUT', { config: cfg }));
        const readback = await refreshConfig();
        if (!unattendedReady(readback)) throw new Error('Hermes config read-back 未达到无人值守条件。');
        const probe = await plugin('/hermes/unattended/probe', jinit('POST', { confirm: 'RUN_SAFE_UNATTENDED_PROBE' }));
        if (probe?.status !== 'UNATTENDED_READY' || probe?.marker_verified !== true) {
          throw new Error('真实 Hermes Run marker 未通过。');
        }
        setMessage(`无人值守闭环通过 · ${probe.run_id}`);
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    return h('section', { className: 'hws-worker-page' },
      h('div', { className: 'hws-section-head' },
        h('div', null, h('h2', null, '授权与无人值守'), h('p', null, '一级入口：配置读回 + 实际 approval-gated Hermes Run marker，不能只看开关。')),
        h(Pill, { tone: ready ? 'good' : 'bad' }, ready ? '配置 READY' : '未就绪'),
      ),
      h('section', { className: 'hws-unattended' },
        h('div', null,
          h('h3', null, 'Hermes 官方无人值守配置'),
          h('p', null, 'approvals.mode=off；cron/single-query/unattended=approve；关闭可关闭的确认项；delegation.subagent_auto_approve=true。'),
        ),
        h(Button, { className: 'danger', disabled: busy, onClick: applyAndProbe }, busy ? '应用并执行真实验证…' : '应用并实测无人值守'),
      ),
      h('div', { className: 'hws-official-panel' },
        h('strong', null, 'Hardline 边界永久保留'),
        h('p', null, 'Studio 不修改、不绕过 Hermes Hardline Blocklist。无人值守代表消除可配置的人机审批，不代表突破 Hermes 永久安全边界。'),
      ),
      h('div', { className: 'hws-route-card' },
        h('h3', null, '当前读回'),
        h('pre', null, JSON.stringify({
          approvals: config?.approvals || {},
          delegation: { subagent_auto_approve: config?.delegation?.subagent_auto_approve },
        }, null, 2)),
      ),
      message ? h('div', { className: 'hws-result' }, message) : null,
    );
  }

  function StudioApp() {
    const [view, setView] = useState('chat');
    const [recent, setRecent] = useState({ loading: true, sessions: [], error: '' });
    const [current, setCurrent] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [draft, setDraft] = useState('');
    const [run, setRun] = useState(null);
    const [streamText, setStreamText] = useState('');
    const [timelineExpanded, setTimelineExpanded] = useState(true);
    const [skillDiff, setSkillDiff] = useState(null);
    const [config, setConfig] = useState({});
    const [modelOptions, setModelOptions] = useState(null);
    const [chatRoute, setChatRoute] = useState({ provider: '', model: '', effort: 'auto' });
    const [health, setHealth] = useState(null);
    const [integration, setIntegration] = useState(null);
    const [moreOpen, setMoreOpen] = useState(false);
    const [globalError, setGlobalError] = useState('');
    const [now, setNow] = useState(Date.now());
    const runPollRef = useRef(null);
    const skillBeforeRef = useRef([]);

    const sending = run && !TERMINAL_RUN_STATES.has(run.status);

    const refreshConfig = useCallback(async () => {
      const cfg = unwrapConfig(await api('/api/config'));
      setConfig(cfg);
      return cfg;
    }, []);

    const refreshOptions = useCallback(async (refresh = false) => {
      const data = await api(`/api/model/options${refresh ? '?refresh=1' : ''}`);
      setModelOptions(data);
      setChatRoute((route) => normalizeRoute(data, route?.model ? route : defaultRoute(data)));
      return data;
    }, []);

    const refreshRecent = useCallback(async (keepCurrent = true) => {
      setRecent((x) => ({ ...x, loading: true, error: '' }));
      try {
        const data = await api(`/api/sessions?limit=${RECENT_LIMIT}&offset=0&order=recent&archived=exclude`);
        const sessions = data.sessions || [];
        setRecent({ loading: false, sessions, error: '' });
        if (!keepCurrent && sessions[0]) setCurrent(sessions[0]);
        return sessions;
      } catch (error) {
        setRecent((x) => ({ ...x, loading: false, error: errorText(error) }));
        return [];
      }
    }, []);

    const loadMessages = useCallback(async (session) => {
      if (!session?.id) { setMessages([]); return; }
      setMessagesLoading(true); setGlobalError('');
      try {
        const data = await api(`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=${CHAT_MESSAGE_LIMIT}&order=latest`);
        setMessages(data.messages || data.data || []);
      } catch (error) { setGlobalError(errorText(error)); }
      finally { setMessagesLoading(false); }
    }, []);

    const openSession = useCallback((session) => {
      const id = session?.id || session?.session_id;
      if (!id) return;
      const normalized = { ...session, id };
      setCurrent(normalized);
      setView('chat');
      setRun(null);
      setStreamText('');
      setSkillDiff(null);
      setTimelineExpanded(false);
      loadMessages(normalized);
    }, [loadMessages]);

    useEffect(() => {
      Promise.all([
        refreshRecent(false),
        refreshConfig(),
        refreshOptions(false),
        plugin('/health').then(setHealth),
        plugin('/integration').then(setIntegration),
      ]).catch((error) => setGlobalError(errorText(error)));
    }, []);

    useEffect(() => {
      if (current?.id) loadMessages(current);
    }, [current?.id]);

    useEffect(() => {
      if (!sending) return;
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }, [sending]);

    useEffect(() => () => {
      if (runPollRef.current?.timer) clearTimeout(runPollRef.current.timer);
    }, []);

    const pollRun = useCallback((runId, initial) => {
      runPollRef.current = { runId, seq: 0, timer: null };
      setRun({ ...initial, events: [], elapsed_ms: 0, last_seq: 0 });
      const tick = async () => {
        const ref = runPollRef.current;
        if (!ref || ref.runId !== runId) return;
        try {
          const data = await plugin(`/hermes/runs/${encodeURIComponent(runId)}?after=${ref.seq}`);
          const incoming = data.events || [];
          if (incoming.length) {
            ref.seq = Math.max(ref.seq, ...incoming.map((e) => Number(e.seq || 0)));
            const delta = incoming.filter((e) => ['assistant.delta', 'message.delta'].includes(e.event)).map((e) => deltaText(e.data)).join('');
            if (delta) setStreamText((x) => x + delta);
          }
          setRun((prev) => ({
            ...(prev || initial),
            ...data,
            events: [...(prev?.events || []), ...incoming].slice(-10000),
          }));
          if (TERMINAL_RUN_STATES.has(data.status)) {
            setTimelineExpanded(false);
            runPollRef.current = null;
            if (data.session_id) await loadMessages({ id: data.session_id });
            const sessions = await refreshRecent(true);
            setCurrent((cur) => sessions.find((s) => s.id === cur?.id) || cur);
            try {
              const afterSkills = await api('/api/skills');
              setSkillDiff(diffSkills(skillBeforeRef.current, afterSkills));
            } catch (_) { setSkillDiff(null); }
            return;
          }
          ref.timer = setTimeout(tick, 650);
          runPollRef.current = ref;
        } catch (error) {
          setRun((prev) => ({
            ...(prev || initial),
            status: 'failed',
            ended_at: Date.now() / 1000,
            events: [...(prev?.events || []), {
              seq: Date.now(),
              event: 'studio.error',
              data: { error: errorText(error) },
              at: Date.now() / 1000,
            }],
          }));
          setTimelineExpanded(false);
          runPollRef.current = null;
        }
      };
      tick();
    }, [loadMessages, refreshRecent]);

    const createSession = useCallback(async () => {
      const out = await plugin('/hermes/sessions', jinit('POST', { title: 'New conversation', source: 'hermes_browser' }));
      const id = getSessionId(out);
      if (!id) throw new Error('Hermes did not return a session id');
      const session = out.session || { id, title: 'New conversation', source: 'hermes_browser' };
      setCurrent(session);
      setMessages([]);
      await refreshRecent(true);
      return session;
    }, [refreshRecent]);

    const lockRuntime = useCallback(async (session, route) => {
      const normalized = normalizeRoute(modelOptions, route);
      if (!session?.id || !normalized.model || !normalized.provider) return normalized;
      await plugin(`/hermes/sessions/${encodeURIComponent(session.id)}/model`, jinit('POST', {
        provider: normalized.provider,
        model: normalized.model,
        require_model_lock: true,
      }));
      return normalized;
    }, [modelOptions]);

    const send = useCallback(async () => {
      const text = draft.trim();
      if (!text || sending) return;
      setGlobalError('');
      setTimelineExpanded(true);
      setStreamText('');
      setSkillDiff(null);
      try {
        try { skillBeforeRef.current = await api('/api/skills'); } catch (_) { skillBeforeRef.current = []; }
        const session = current?.id ? current : await createSession();
        const route = await lockRuntime(session, chatRoute);
        setMessages((xs) => [...xs, { role: 'user', content: text, id: `local-${Date.now()}` }]);
        setDraft('');
        const body = {
          session_id: session.id,
          message: text,
          provider: route.provider,
          model: route.model,
        };
        if (route.effort && route.effort !== 'auto') body.model_options = { reasoning_effort: route.effort };
        const started = await plugin('/hermes/runs', jinit('POST', body));
        pollRun(started.id, started);
      } catch (error) { setGlobalError(errorText(error)); }
    }, [draft, sending, current, createSession, chatRoute, lockRuntime, pollRun]);

    const toggleArchive = useCallback(async () => {
      if (!current?.id) return;
      try {
        const archived = !current.archived;
        await api(`/api/sessions/${encodeURIComponent(current.id)}`, jinit('PATCH', { archived }));
        if (archived) {
          const sessions = await refreshRecent(true);
          const next = sessions[0] || null;
          setCurrent(next);
          if (next) await loadMessages(next); else setMessages([]);
        } else {
          setCurrent((x) => ({ ...x, archived: false }));
          await refreshRecent(true);
        }
      } catch (error) { setGlobalError(errorText(error)); }
    }, [current, refreshRecent, loadMessages]);

    const stopRun = useCallback(async () => {
      if (!run?.id) return;
      try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/stop`, jinit('POST', {})); }
      catch (error) { setGlobalError(`停止 Run 失败：${errorText(error)}`); }
    }, [run?.id]);

    const steerRun = useCallback(async (input) => {
      if (!run?.id || !String(input || '').trim()) return;
      try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/steer`, jinit('POST', { input: String(input).trim() })); }
      catch (error) { setGlobalError(`Steer 失败：${errorText(error)}`); }
    }, [run?.id]);

    const approveRun = useCallback(async (choice) => {
      if (!run?.id) return;
      try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/approval`, jinit('POST', { choice })); }
      catch (error) { setGlobalError(`审批提交失败：${errorText(error)}`); }
    }, [run?.id]);

    const newConversation = useCallback(() => {
      setCurrent(null);
      setMessages([]);
      setRun(null);
      setStreamText('');
      setDraft('');
      setSkillDiff(null);
      setView('chat');
    }, []);

    const content = view === 'worker'
      ? h(WorkerPage, { config, modelOptions, chatRoute, refreshConfig })
      : view === 'models'
        ? h(ModelsPage, { modelOptions, refreshOptions })
        : view === 'unattended'
          ? h(UnattendedPage, { config, refreshConfig })
          : view === 'history'
            ? h(HistoryPage, { onBackToChat: openSession })
            : h(Conversation, {
                session: current,
                messages,
                loading: messagesLoading,
                onArchive: toggleArchive,
                run,
                timelineExpanded,
                setTimelineExpanded,
                streamText,
                draft,
                setDraft,
                onSend: send,
                sending,
                modelOptions,
                chatRoute,
                setChatRoute: (route) => setChatRoute(normalizeRoute(modelOptions, route)),
                now,
                onStop: stopRun,
                onSteer: steerRun,
                onApprove: approveRun,
                skillDiff,
              });

    const ready = unattendedReady(config);
    const mode = studioMode(config);
    return h('div', { className: 'hws-root' },
      h('aside', { className: 'hws-sidebar' },
        h('div', { className: 'hws-brand' },
          h('span', { className: 'hws-logo' }, 'H'),
          h('div', null, h('strong', null, 'Hermes Worker Studio'), h('small', null, 'Hermes Native · 2.0')),
        ),
        h(Button, { className: 'primary new', onClick: newConversation }, '+ 新建对话'),
        h('nav', { className: 'hws-nav' },
          PRIMARY_NAV.map(([id, label, icon]) => h('button', {
            key: id,
            className: view === id ? 'active' : '',
            onClick: () => setView(id),
          },
            h('span', null, icon),
            label,
            id === 'unattended' ? h('i', { className: `hws-status-dot ${ready ? 'ready' : 'pending'}`, title: ready ? '无人值守配置已就绪' : '无人值守尚未就绪' }) : null,
          )),
        ),
        h('div', { className: 'hws-recents-head' },
          h('span', null, `最近 ${RECENT_LIMIT} 条`),
          h('button', { onClick: () => refreshRecent(true), title: '刷新' }, '↻'),
        ),
        h(ErrorBar, { error: recent.error }),
        h('div', { className: 'hws-recents' },
          recent.loading ? h(Empty, null, h(Spinner)) : recent.sessions.map((s) => h(SessionRow, {
            key: s.id,
            session: s,
            active: current?.id === s.id && view === 'chat',
            onClick: () => openSession(s),
          })),
        ),
        h('div', { className: 'hws-native-nav' },
          HERMES_PRIMARY.map(([path, label, icon]) => h('a', { href: baseHref(path), key: path }, h('span', null, icon), label)),
        ),
        h('div', { className: 'hws-more' },
          h('button', { className: 'hws-more-toggle', onClick: () => setMoreOpen(!moreOpen) },
            h('span', null, '⋯'), '更多', h('span', { className: 'hws-more-chevron' }, moreOpen ? '⌃' : '⌄')),
          moreOpen ? h('div', { className: 'hws-more-menu' },
            HERMES_SECONDARY.map(([path, label]) => h('a', {
              href: baseHref(path),
              key: path,
              target: /^https?:\/\//.test(path) ? '_blank' : undefined,
              rel: /^https?:\/\//.test(path) ? 'noreferrer' : undefined,
            }, label)),
          ) : null,
        ),
        h('footer', { className: 'hws-sidebar-foot' },
          h(Pill, { tone: health?.ok === false ? 'bad' : 'good' }, health?.ok === false ? 'Hermes 异常' : 'Hermes'),
          h(Pill, { tone: mode === 'MAIN' ? 'neutral' : 'good' }, mode === 'DELEGATE' ? 'WORKER' : mode),
          h('small', null, integration?.hermes?.worker_plane || 'PluginContext.subagent_lifecycle'),
        ),
      ),
      h('main', { className: 'hws-main' },
        h(ErrorBar, { error: globalError, onClear: () => setGlobalError('') }),
        content,
      ),
    );
  }

  window.__HERMES_PLUGINS__.register('hermes-worker-studio', StudioApp);
})();
