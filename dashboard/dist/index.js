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
  const RECENT_LIMIT = 10;
  const CHAT_MESSAGE_LIMIT = 40;
  const HISTORY_SESSION_LIMIT = 20;
  const HISTORY_MESSAGE_LIMIT = 100;
  const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'incomplete', 'cancelled', 'stopped']);

  const PRIMARY_NAV = [
    ['chat', '新建 / 当前对话', '✦'],
    ['search', '搜索对话', '⌕'],
    ['history', '完整历史对话', '☷'],
    ['archive', '已归档对话', '▣'],
    ['worker', 'Worker 路由', '⇄'],
  ];
  const HERMES_PRIMARY = [
    ['/skills', 'Skills', '◇'],
    ['/plugins', 'Plugins', '⬡'],
    ['/mcp', 'MCP', '⌘'],
  ];
  const HERMES_SECONDARY = [
    ['/models', 'Models'], ['/cron', 'Cron'], ['/files', 'Files'], ['/logs', 'Logs'],
    ['/analytics', 'Analytics'], ['/channels', 'Channels'], ['/webhooks', 'Webhooks'],
    ['/profiles', 'Profiles'], ['/env', 'Keys'], ['/config', 'Config'], ['/system', 'System'],
  ];

  function jinit(method, body) {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  }

  function api(path, init) {
    return fetchJSON(path, init);
  }

  function plugin(path, init) {
    return fetchJSON(PLUGIN + path, init);
  }

  function baseHref(path) {
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
    const hr = Math.floor(m / 60);
    return `${hr}小时${m % 60}分`;
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

  function sessionTitle(session) {
    return session?.title || session?.preview || session?.id || '未命名对话';
  }

  function getSessionId(payload) {
    return payload?.session?.id || payload?.session_id || payload?.id || null;
  }

  function deepTaskId(value, depth = 0) {
    if (depth > 8 || value == null) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deepTaskId(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== 'object') {
      if (typeof value === 'string' && value.length < 2000 && value.trim().startsWith('{')) {
        try { return deepTaskId(JSON.parse(value), depth + 1); } catch (_) { return null; }
      }
      return null;
    }
    for (const key of ['task_id', 'taskId', 'worker_task_id', 'workerTaskId']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    for (const child of Object.values(value)) {
      const found = deepTaskId(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function toolName(data) {
    return data?.tool_name || data?.name || data?.tool?.name || data?.function?.name || data?.tool_call?.function?.name || 'tool';
  }

  function eventSummary(event) {
    const data = event?.data || {};
    const name = event?.event || 'event';
    if (name === 'tool.started') return `执行工具 · ${toolName(data)}`;
    if (name === 'tool.completed') return `工具完成 · ${toolName(data)}`;
    if (name === 'tool.failed') return `工具失败 · ${toolName(data)}`;
    if (name === 'run.completed') return '任务执行完成';
    if (name === 'run.failed' || name === 'run.error' || name === 'studio.error') return '任务执行失败';
    if (name === 'run.started') return '任务开始';
    if (name.includes('approval')) return '审批事件';
    if (name.includes('worker')) return `Worker · ${name}`;
    return name;
  }

  function eventDetail(event) {
    const data = event?.data || {};
    if (event?.event === 'tool.started') {
      return shortText(data.arguments || data.args || data.input || data.tool?.arguments || '', 260);
    }
    if (event?.event === 'tool.completed' || event?.event === 'tool.failed') {
      return shortText(data.result || data.output || data.error || '', 260);
    }
    if (event?.event === 'studio.error' || event?.event === 'run.error' || event?.event === 'run.failed') {
      return shortText(data.error || data.message || data, 300);
    }
    return '';
  }

  function deltaText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    for (const key of ['delta', 'text', 'content']) {
      if (typeof data[key] === 'string') return data[key];
    }
    if (typeof data.output_text === 'string') return data.output_text;
    return '';
  }

  function approvalChoices(event) {
    const name = String(event?.event || '').toLowerCase();
    if (!name.includes('approval')) return [];
    const values = Array.isArray(event?.data?.choices) ? event.data.choices : [];
    return values.map((x) => String(x).toLowerCase()).filter((x) => ['once', 'session', 'always', 'deny'].includes(x));
  }

  function skillKey(skill) {
    return String(skill?.name || skill?.id || skill?.path || '').trim();
  }

  function diffSkills(before, after) {
    const left = new Map((Array.isArray(before) ? before : []).map((x) => [skillKey(x), x]).filter(([key]) => key));
    const right = new Map((Array.isArray(after) ? after : []).map((x) => [skillKey(x), x]).filter(([key]) => key));
    const added = [...right.keys()].filter((key) => !left.has(key));
    const removed = [...left.keys()].filter((key) => !right.has(key));
    const toggled = [...right.keys()].filter((key) => left.has(key) && Boolean(left.get(key)?.enabled) !== Boolean(right.get(key)?.enabled));
    return { added, removed, toggled };
  }

  function modelRows(catalog, provider) {
    const rows = catalog?.registry?.providers?.[provider]?.models;
    return Array.isArray(rows) ? rows : [];
  }

  function modelId(model) {
    return String(model?.id || model?.catalogId || model?.name || '').trim();
  }

  function modelLabel(model) {
    return model?.displayName || model?.name || modelId(model);
  }

  function reasoningOptions(model) {
    const actual = [];
    const advertised = model?.reasoning?.options;
    if (Array.isArray(advertised)) {
      for (const item of advertised) {
        const value = typeof item === 'string' ? item : item?.value;
        if (value && !actual.some((x) => x.value === value)) {
          actual.push({ value: String(value), description: typeof item === 'object' ? (item.description || '') : '' });
        }
      }
    }
    if (!actual.length && Array.isArray(model?.supportedReasoningEfforts)) {
      for (const value of model.supportedReasoningEfforts) {
        if (value && !actual.some((x) => x.value === String(value))) actual.push({ value: String(value), description: '' });
      }
    }
    return [{ value: 'auto', description: '使用上游真实默认值' }, ...actual.filter((x) => x.value !== 'auto')];
  }

  function normalizeRoute(catalog, route, role) {
    const copy = { provider: route?.provider || 'official', model: route?.model || '', effort: route?.effort || 'auto' };
    if (role === 'main' && catalog?.registry?.mainPolicy?.providerLocked) copy.provider = 'official';
    const models = modelRows(catalog, copy.provider);
    if (!models.some((m) => modelId(m) === copy.model)) copy.model = modelId(models[0]);
    const selected = models.find((m) => modelId(m) === copy.model);
    const efforts = reasoningOptions(selected).map((x) => x.value);
    if (!efforts.includes(copy.effort)) copy.effort = 'auto';
    return copy;
  }

  function rolesForMode(mode) {
    if (mode === 'AUTO' || mode === 'DELEGATE') return ['main', 'worker', 'verifier'];
    if (mode === 'MAIN') return ['main'];
    return [];
  }

  function savedRoute(state, catalog, mode, role) {
    const effective = catalog?.runtime?.effectiveRouting;
    const raw = mode === state?.mode && effective?.[role] ? effective[role] : state?.routing?.[mode]?.[role];
    return normalizeRoute(catalog, raw || {}, role);
  }

  function matchingHermesProvider(options, route, workerState) {
    if (!route?.model || !Array.isArray(options?.providers)) return null;
    const candidates = options.providers.filter((p) => Array.isArray(p.models) && p.models.includes(route.model) && p.authenticated !== false);
    if (!candidates.length) return null;
    if (route.provider === 'third_party') {
      const base = String(workerState?.provider?.baseUrl || '').replace(/\/$/, '');
      const byUrl = candidates.find((p) => p.is_user_defined && String(p.api_url || '').replace(/\/$/, '') === base);
      if (byUrl) return byUrl.slug;
      const custom = candidates.filter((p) => p.is_user_defined);
      return custom.length === 1 ? custom[0].slug : null;
    }
    const nonCustom = candidates.filter((p) => !p.is_user_defined);
    if (nonCustom.length === 1) return nonCustom[0].slug;
    const current = nonCustom.find((p) => p.is_current);
    return current?.slug || null;
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
    const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    const content = typeof msg?.display_content === 'string' ? msg.display_content : msg?.content;
    if (msg?.display_kind === 'hidden') return null;
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

  function WorkTimeline({ run, workerSnapshot, expanded, setExpanded, now, skillDiff, onApprove }) {
    if (!run) return null;
    const ended = run.ended_at ? Number(run.ended_at) * 1000 : null;
    const started = Number(run.started_at || 0) * 1000;
    const duration = run.elapsed_ms != null ? run.elapsed_ms : Math.max(0, (ended || now) - started);
    const done = TERMINAL_RUN_STATES.has(run.status);
    const lifecycle = (run.events || []).filter((e) => e.event !== 'assistant.delta');
    return h('section', { className: `hws-work ${done ? 'done' : 'running'}` },
      h('button', { className: 'hws-work-head', onClick: () => setExpanded(!expanded), type: 'button' },
        h('span', { className: 'hws-work-state' }, done ? (run.status === 'completed' ? '✓' : '!') : h(Spinner)),
        h('strong', null, done ? `工作过程 · ${run.status === 'completed' ? '已完成' : run.status}` : '工作进行中'),
        h('span', { className: 'hws-work-duration' }, fmtDuration(duration)),
        h('span', { className: 'hws-work-count' }, `${lifecycle.length}${workerSnapshot ? ' + Worker' : ''} 项`),
        h('span', { className: 'hws-chevron' }, expanded ? '⌃' : '⌄'),
      ),
      expanded ? h('div', { className: 'hws-work-body' },
        lifecycle.length ? lifecycle.map((event) => h('div', { className: 'hws-work-event', key: event.seq },
          h('span', { className: 'hws-event-dot' }),
          h('div', null,
            h('strong', null, eventSummary(event)),
            eventDetail(event) ? h('small', null, eventDetail(event)) : null,
            approvalChoices(event).length ? h('div', { className: 'hws-approval-actions' }, approvalChoices(event).map((choice) =>
              h(Button, { key: choice, className: choice === 'deny' ? 'danger small' : 'ghost small', onClick: () => onApprove?.(choice) }, choice)
            )) : null,
          ),
          h('time', null, fmtTime(event.at)),
        )) : h('div', { className: 'hws-muted' }, '等待 Hermes 返回真实 lifecycle 事件…'),
        workerSnapshot ? h('details', { className: 'hws-worker-snapshot', open: !done },
          h('summary', null, `Worker 实时状态 · ${workerSnapshot.taskId}`),
          h('pre', null, JSON.stringify(workerSnapshot.data, null, 2)),
        ) : null,
        skillDiff && (skillDiff.added.length || skillDiff.removed.length || skillDiff.toggled.length) ? h('details', { className: 'hws-skill-diff', open: true },
          h('summary', null, 'Hermes Skills 变化'),
          skillDiff.added.length ? h('p', null, `新增: ${skillDiff.added.join(' · ')}`) : null,
          skillDiff.removed.length ? h('p', null, `移除: ${skillDiff.removed.join(' · ')}`) : null,
          skillDiff.toggled.length ? h('p', null, `启停变化: ${skillDiff.toggled.join(' · ')}`) : null,
        ) : null,
        run.truncated ? h('div', { className: 'hws-warning-note' }, '事件数量超过本地展示上限；上游会话记录未被修改。') : null,
      ) : null,
    );
  }

  function MainRouteSelector({ workerState, catalog, route, onChange, disabled }) {
    const providers = ['official', 'third_party'].filter((p) => modelRows(catalog, p).length);
    const models = modelRows(catalog, route?.provider);
    const selected = models.find((m) => modelId(m) === route?.model);
    const efforts = reasoningOptions(selected);
    const effortIndex = Math.max(0, efforts.findIndex((x) => x.value === (route?.effort || 'auto')));
    if (!route) return null;
    return h('div', { className: 'hws-chat-route' },
      h('label', null, '路由',
        h('select', {
          value: route.provider,
          disabled: disabled || workerState?.mode === 'OFFICIAL' || (catalog?.registry?.mainPolicy?.providerLocked === true),
          onChange: (e) => {
            const provider = e.target.value;
            const first = modelRows(catalog, provider)[0];
            onChange({ provider, model: modelId(first), effort: 'auto' });
          },
        }, providers.map((p) => h('option', { value: p, key: p }, p === 'official' ? 'Official' : 'New API'))),
      ),
      h('label', null, '模型',
        h('select', {
          value: route.model,
          disabled: disabled || workerState?.mode === 'OFFICIAL' || !models.length,
          onChange: (e) => onChange({ ...route, model: e.target.value, effort: 'auto' }),
        }, models.map((m) => h('option', { value: modelId(m), key: modelId(m) }, modelLabel(m)))),
      ),
      h('label', { className: 'hws-effort-inline' },
        h('span', null, `思考强度 · ${efforts[effortIndex]?.value || 'auto'}`),
        h('input', {
          type: 'range', min: 0, max: Math.max(0, efforts.length - 1), step: 1, value: effortIndex,
          disabled: disabled || workerState?.mode === 'OFFICIAL' || efforts.length <= 1,
          onChange: (e) => onChange({ ...route, effort: efforts[Number(e.target.value)]?.value || 'auto' }),
        }),
        h('small', null, efforts.length <= 1 ? '上游未声明 reasoning 档位，仅 Auto' : efforts.map((x) => x.value).join(' · ')),
      ),
    );
  }

  function Conversation({ session, messages, loading, onArchive, run, workerSnapshot, timelineExpanded, setTimelineExpanded, streamText, draft, setDraft, onSend, sending, workerState, catalog, chatRoute, onChatRoute, now, onStop, onSteer, onApprove, skillDiff }) {
    const [steer, setSteer] = useState('');
    return h('section', { className: 'hws-conversation' },
      h('header', { className: 'hws-conversation-head' },
        h('div', null,
          h('h2', null, session ? sessionTitle(session) : '新对话'),
          h('p', null, session ? `${session.id} · 首屏仅加载最近 ${CHAT_MESSAGE_LIMIT} 条` : '发送第一条消息时创建 Hermes Session'),
        ),
        h('div', { className: 'hws-head-actions' },
          session ? h(Button, { className: 'ghost', onClick: onArchive, disabled: sending }, session.archived ? '取消归档' : '归档') : null,
        ),
      ),
      workerState && catalog ? h(MainRouteSelector, { workerState, catalog, route: chatRoute, onChange: onChatRoute, disabled: sending }) : null,
      h('div', { className: 'hws-transcript' },
        loading ? h(Empty, null, h(Spinner), ' 正在读取最近消息…') : null,
        !loading && !(messages || []).length && !run ? h(Empty, null, '这是一个干净的新对话。') : null,
        (messages || []).map((msg, i) => h(MessageBubble, { msg, key: msg?.id || `${msg?.role}-${i}` })),
        run ? h(WorkTimeline, { run, workerSnapshot, expanded: timelineExpanded, setExpanded: setTimelineExpanded, now, skillDiff, onApprove }) : null,
        streamText && run && !TERMINAL_RUN_STATES.has(run.status) ? h('div', { className: 'hws-message assistant live' },
          h('div', { className: 'hws-message-meta' }, 'Hermes · 实时'),
          h('div', { className: 'hws-message-content' }, streamText),
        ) : null,
      ),
      sending && run?.id ? h('div', { className: 'hws-run-controls' },
        h(Button, { className: 'danger small', type: 'button', onClick: onStop }, '停止 Run'),
        h('input', { value: steer, onChange: (e) => setSteer(e.target.value), placeholder: '给正在运行的 Hermes 追加 steering…' }),
        h(Button, { className: 'ghost small', type: 'button', disabled: !steer.trim(), onClick: async () => {
          const value = steer.trim();
          if (!value) return;
          await onSteer?.(value);
          setSteer('');
        } }, 'Steer'),
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
        h(Button, { type: 'submit', className: 'primary send', disabled: sending || !draft.trim() }, sending ? h(React.Fragment, null, h(Spinner), ' 执行中') : '发送'),
      ),
    );
  }

  function PagedSessions({ title, archived, page, setPage, selectedId, onSelect, onBackToChat }) {
    const [state, setState] = useState({ loading: true, sessions: [], total: 0, error: '' });
    const [detail, setDetail] = useState({ loading: false, messages: [], session: null, page: 1, error: '' });
    const offset = (page - 1) * HISTORY_SESSION_LIMIT;

    const load = useCallback(async () => {
      setState((s) => ({ ...s, loading: true, error: '' }));
      try {
        const data = await api(`/api/sessions?limit=${HISTORY_SESSION_LIMIT}&offset=${offset}&order=recent&archived=${archived}`);
        setState({ loading: false, sessions: data.sessions || [], total: Number(data.total || 0), error: '' });
      } catch (error) {
        setState((s) => ({ ...s, loading: false, error: errorText(error) }));
      }
    }, [archived, offset]);

    useEffect(() => { load(); }, [load]);

    const open = useCallback(async (session, messagePage = 1) => {
      setDetail({ loading: true, messages: [], session, page: messagePage, error: '' });
      try {
        const msgOffset = (messagePage - 1) * HISTORY_MESSAGE_LIMIT;
        const data = await api(`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=${HISTORY_MESSAGE_LIMIT}&offset=${msgOffset}&order=oldest`);
        setDetail({ loading: false, messages: data.messages || data.data || [], session, page: messagePage, error: '' });
      } catch (error) {
        setDetail((d) => ({ ...d, loading: false, error: errorText(error) }));
      }
    }, []);

    useEffect(() => {
      const match = state.sessions.find((x) => x.id === selectedId);
      if (match) open(match, 1);
    }, [selectedId]);

    const totalPages = Math.max(1, Math.ceil(state.total / HISTORY_SESSION_LIMIT));
    const messageCount = Number(detail.session?.message_count || 0);
    const messagePages = Math.max(1, Math.ceil(messageCount / HISTORY_MESSAGE_LIMIT));

    return h('section', { className: 'hws-page-grid' },
      h('div', { className: 'hws-list-pane' },
        h('div', { className: 'hws-section-head' }, h('div', null, h('h2', null, title), h('p', null, `${HISTORY_SESSION_LIMIT} 个会话/页`))),
        h(ErrorBar, { error: state.error, onClear: () => setState((s) => ({ ...s, error: '' })) }),
        state.loading ? h(Empty, null, h(Spinner), ' 加载中…') : state.sessions.map((s) => h(SessionRow, { key: s.id, session: s, active: detail.session?.id === s.id, onClick: () => open(s, 1) })),
        h('div', { className: 'hws-pagination' },
          h(Button, { className: 'ghost', disabled: page <= 1, onClick: () => setPage(Math.max(1, page - 1)) }, '上一页'),
          h('span', null, `${page} / ${totalPages}`),
          h(Button, { className: 'ghost', disabled: page >= totalPages, onClick: () => setPage(Math.min(totalPages, page + 1)) }, '下一页'),
        ),
      ),
      h('div', { className: 'hws-detail-pane' },
        !detail.session ? h(Empty, null, '选择一个对话查看完整历史') : h(React.Fragment, null,
          h('div', { className: 'hws-section-head' },
            h('div', null, h('h2', null, sessionTitle(detail.session)), h('p', null, `${messageCount} 条消息 · ${HISTORY_MESSAGE_LIMIT} 条/页`)),
            h(Button, { className: 'primary', onClick: () => onBackToChat(detail.session) }, '回到对话'),
          ),
          h(ErrorBar, { error: detail.error }),
          detail.loading ? h(Empty, null, h(Spinner), ' 读取消息…') : h('div', { className: 'hws-history-messages' }, detail.messages.map((m, i) => h(MessageBubble, { msg: m, key: m.id || i }))),
          h('div', { className: 'hws-pagination' },
            h(Button, { className: 'ghost', disabled: detail.page <= 1 || detail.loading, onClick: () => open(detail.session, detail.page - 1) }, '上一页'),
            h('span', null, `${detail.page} / ${messagePages}`),
            h(Button, { className: 'ghost', disabled: detail.page >= messagePages || detail.loading, onClick: () => open(detail.session, detail.page + 1) }, '下一页'),
          ),
        ),
      ),
    );
  }

  function SearchPage({ onOpen }) {
    const [q, setQ] = useState('');
    const [result, setResult] = useState({ loading: false, rows: [], error: '' });
    const seq = useRef(0);
    useEffect(() => {
      const value = q.trim();
      const mine = ++seq.current;
      if (!value) { setResult({ loading: false, rows: [], error: '' }); return; }
      const timer = setTimeout(async () => {
        setResult((r) => ({ ...r, loading: true, error: '' }));
        try {
          const data = await api(`/api/sessions/search?q=${encodeURIComponent(value)}&limit=50`);
          if (mine === seq.current) setResult({ loading: false, rows: data.results || [], error: '' });
        } catch (error) {
          if (mine === seq.current) setResult({ loading: false, rows: [], error: errorText(error) });
        }
      }, 220);
      return () => clearTimeout(timer);
    }, [q]);
    return h('section', { className: 'hws-search-page' },
      h('div', { className: 'hws-section-head' }, h('div', null, h('h2', null, '搜索对话记录'), h('p', null, 'Hermes 官方 FTS5 搜索 · 不在浏览器扫描完整历史'))),
      h('input', { className: 'hws-search-input', value: q, onChange: (e) => setQ(e.target.value), autoFocus: true, placeholder: '搜索消息内容或 Session ID…' }),
      h(ErrorBar, { error: result.error }),
      result.loading ? h(Empty, null, h(Spinner), ' 搜索中…') : null,
      !result.loading && q.trim() && !result.rows.length ? h(Empty, null, '没有匹配结果') : null,
      h('div', { className: 'hws-search-results' }, result.rows.map((row, i) => h('button', { className: 'hws-search-result', key: row.session_id || row.id || i, onClick: () => onOpen({ ...row, id: row.session_id || row.id }) },
        h('strong', null, row.title || row.id || row.session_id),
        h('p', null, row.snippet || row.preview || ''),
        h('small', null, [row.source, row.model, fmtTime(row.last_active || row.session_started)].filter(Boolean).join(' · ')),
      ))),
    );
  }

  function ReasoningSlider({ model, value, onChange }) {
    const values = reasoningOptions(model);
    const index = Math.max(0, values.findIndex((x) => x.value === value));
    return h('div', { className: 'hws-reasoning' },
      h('div', { className: 'hws-reasoning-head' },
        h('span', null, '思考强度'),
        h('strong', null, values[index]?.value || 'auto'),
      ),
      h('input', { type: 'range', min: 0, max: Math.max(0, values.length - 1), step: 1, value: index, disabled: values.length <= 1, onChange: (e) => onChange(values[Number(e.target.value)]?.value || 'auto') }),
      h('div', { className: 'hws-reasoning-ticks' }, values.map((x) => h('span', { key: x.value }, x.value))),
      h('small', null, values.length <= 1 ? '上游未声明思考强度，严格保持 Auto。' : (values[index]?.description || '来自上游实际 capability。')),
    );
  }

  function RouteCard({ role, route, catalog, onChange }) {
    const locked = role === 'main' && catalog?.registry?.mainPolicy?.providerLocked;
    const providers = ['official', 'third_party'].filter((p) => modelRows(catalog, p).length);
    const models = modelRows(catalog, route.provider);
    const selected = models.find((m) => modelId(m) === route.model);
    return h('article', { className: 'hws-route-card' },
      h('header', null, h('div', null, h('small', null, role.toUpperCase()), h('h3', null, role === 'main' ? 'Main' : role === 'worker' ? 'Worker' : 'Verifier')), h(Pill, { tone: locked ? 'good' : 'neutral' }, locked ? 'Official 🔒' : route.provider === 'official' ? 'Official' : 'New API')),
      h('div', { className: 'hws-route-fields' },
        h('label', null, 'Provider',
          h('select', { value: route.provider, disabled: locked, onChange: (e) => {
            const p = e.target.value; const first = modelRows(catalog, p)[0];
            onChange({ provider: p, model: modelId(first), effort: 'auto' });
          } }, providers.map((p) => h('option', { value: p, key: p }, p === 'official' ? 'Official' : 'New API'))),
        ),
        h('label', null, 'Model',
          h('select', { value: route.model, disabled: !models.length, onChange: (e) => onChange({ ...route, model: e.target.value, effort: 'auto' }) }, models.map((m) => h('option', { value: modelId(m), key: modelId(m) }, modelLabel(m)))),
        ),
      ),
      h(ReasoningSlider, { model: selected, value: route.effort || 'auto', onChange: (effort) => onChange({ ...route, effort }) }),
    );
  }

  function WorkerPage({ state, catalog, health, refresh, setShared, onUnattended }) {
    const [mode, setMode] = useState(state?.mode || 'OFFICIAL');
    const [draft, setDraft] = useState({});
    const [provider, setProvider] = useState({ baseUrl: state?.provider?.baseUrl || '', apiKey: '', protocol: state?.provider?.protocol || 'auto' });
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [tests, setTests] = useState({});

    useEffect(() => {
      setMode(state?.mode || 'OFFICIAL');
      setProvider((p) => ({ ...p, baseUrl: state?.provider?.baseUrl || '', protocol: state?.provider?.protocol || 'auto' }));
    }, [state]);

    useEffect(() => {
      const next = {};
      for (const role of rolesForMode(mode)) next[role] = savedRoute(state, catalog, mode, role);
      setDraft(next);
    }, [mode, state, catalog]);

    async function changeMode(next) {
      setBusy(true); setMessage('');
      try {
        await plugin('/worker/mode', jinit('PUT', { mode: next }));
        setMode(next); await refresh(); setMessage(`已切换到 ${next}。`);
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    async function saveRoutes() {
      if (mode === 'OFFICIAL') return;
      setBusy(true); setMessage('');
      try {
        await plugin('/worker/routing', jinit('PUT', { mode, roles: draft }));
        await refresh(); setShared?.(); setMessage('Main / Worker / Verifier 路由已按真实 capability 保存。');
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    async function saveProvider() {
      if (!provider.baseUrl.trim() || !provider.apiKey) { setMessage('请输入 New API Base URL 与 API Key。'); return; }
      setBusy(true); setMessage('');
      try {
        await plugin('/worker/provider', jinit('PUT', { baseUrl: provider.baseUrl.trim(), apiKey: provider.apiKey, protocol: provider.protocol }));
        const fresh = await refresh();
        const cat = fresh?.catalog || catalog;
        const models = modelRows(cat, 'third_party').map(modelId).filter(Boolean);
        let hermesNote = '';
        if (models.length) {
          try {
            const existing = await api('/api/providers/custom-endpoints');
            const row = (existing?.endpoints || []).find((x) => x.name === 'Worker Studio New API' || String(x.base_url || '').replace(/\/$/, '') === provider.baseUrl.trim().replace(/\/$/, ''));
            const endpoint = {
              ...(row?.id ? { id: row.id } : {}),
              name: 'Worker Studio New API',
              base_url: provider.baseUrl.trim(),
              api_key: provider.apiKey,
              model: models[0],
              models,
              discover_models: true,
              make_default: false,
            };
            await api('/api/providers/custom-endpoints/validate', jinit('POST', endpoint));
            await api('/api/providers/custom-endpoints', jinit('POST', endpoint));
            hermesNote = '；已同步 Hermes 官方 Custom Endpoint';
          } catch (error) {
            hermesNote = `；Worker 已保存，但 Hermes Custom Endpoint 同步失败：${errorText(error)}`;
          }
        }
        setProvider((p) => ({ ...p, apiKey: '' }));
        setMessage(`New API 已保存，发现 ${models.length} 个真实模型${hermesNote}。`);
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    async function probe() {
      setBusy(true); setMessage('');
      try {
        const out = await plugin('/worker/provider/probe', jinit('POST', {}));
        setMessage(out?.ok === false ? `探测失败：${out.error || out.status}` : `探测通过 · ${out?.protocol || 'upstream'}${out?.status ? ` · HTTP ${out.status}` : ''}`);
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    async function testModel(id) {
      setTests((x) => ({ ...x, [id]: { loading: true } }));
      try {
        const data = await plugin('/worker/provider/connectivity', jinit('POST', { models: [id] }));
        setTests((x) => ({ ...x, [id]: data?.results?.[0] || { ok: false, error: '无结果' } }));
      } catch (error) { setTests((x) => ({ ...x, [id]: { ok: false, error: errorText(error) } })); }
    }

    async function unattended() {
      setBusy(true); setMessage('');
      try {
        const out = await onUnattended();
        setMessage(`无人值守闭环通过 · ${out?.status || 'UNATTENDED_READY'} · 配置已读回 · 实际 Run marker 已验证。`);
      } catch (error) { setMessage(errorText(error)); }
      finally { setBusy(false); }
    }

    const third = modelRows(catalog, 'third_party');
    return h('section', { className: 'hws-worker-page' },
      h('div', { className: 'hws-section-head' },
        h('div', null, h('h2', null, 'Hermes 派工系统'), h('p', null, '路由、模型、reasoning 均来自 codex-worker-delegation 实际 registry；不硬编码模型能力。')),
        h('div', { className: 'hws-health-row' }, h(Pill, { tone: health?.hermes?.ok === false ? 'bad' : 'good' }, 'Hermes'), h(Pill, { tone: health?.worker?.ok === false ? 'bad' : 'good' }, 'Worker')),
      ),
      h('div', { className: 'hws-mode-tabs' }, ['OFFICIAL', 'AUTO', 'DELEGATE', 'MAIN'].map((x) => h(Button, { key: x, className: mode === x ? 'selected' : 'ghost', disabled: busy, onClick: () => changeMode(x) }, x === 'DELEGATE' ? 'WORKER' : x))),
      mode === 'OFFICIAL' ? h('div', { className: 'hws-official-panel' }, h('strong', null, '官方默认模式'), h('p', null, '不保存自定义 Main / Worker / Verifier 覆盖，直接服从上游 Hermes/Codex runtime。')) : h(React.Fragment, null,
        h('div', { className: 'hws-routes' }, rolesForMode(mode).map((role) => h(RouteCard, { key: role, role, route: draft[role] || savedRoute(state, catalog, mode, role), catalog, onChange: (route) => setDraft((d) => ({ ...d, [role]: route })) }))),
        h(Button, { className: 'primary', disabled: busy, onClick: saveRoutes }, '保存统一路由'),
      ),
      h('hr'),
      h('section', { className: 'hws-provider-panel' },
        h('div', { className: 'hws-section-head compact' }, h('div', null, h('h3', null, 'New API'), h('p', null, 'API Key 仅提交给 Worker 与 Hermes 官方 Custom Endpoint；页面保存后立即清空输入框。'))),
        h('div', { className: 'hws-provider-grid' },
          h('label', null, 'Base URL', h('input', { value: provider.baseUrl, onChange: (e) => setProvider((p) => ({ ...p, baseUrl: e.target.value })), placeholder: 'https://example.com/v1' })),
          h('label', null, 'API Key', h('input', { type: 'password', value: provider.apiKey, onChange: (e) => setProvider((p) => ({ ...p, apiKey: e.target.value })), autoComplete: 'off', placeholder: 'sk-…' })),
          h('label', null, '协议', h('select', { value: provider.protocol, onChange: (e) => setProvider((p) => ({ ...p, protocol: e.target.value })) }, h('option', { value: 'auto' }, 'Auto'), h('option', { value: 'responses' }, 'Responses'), h('option', { value: 'chat' }, 'Chat Completions'))),
        ),
        h('div', { className: 'hws-actions' }, h(Button, { className: 'primary', disabled: busy, onClick: saveProvider }, '保存并刷新模型'), h(Button, { className: 'ghost', disabled: busy, onClick: probe }, '测试上游')),
      ),
      h('section', { className: 'hws-connectivity' },
        h('h3', null, `New API 模型 · ${third.length}`),
        !third.length ? h(Empty, null, '尚未从上游获得模型列表。') : third.map((m) => {
          const id = modelId(m); const test = tests[id]; const efforts = reasoningOptions(m);
          return h('div', { className: 'hws-model-test', key: id },
            h('div', null, h('strong', null, modelLabel(m)), h('small', null, `${id} · reasoning: ${efforts.map((x) => x.value).join(' / ')}`)),
            test?.loading ? h(Spinner) : test ? h(Pill, { tone: test.ok ? 'good' : 'bad' }, test.ok ? `通过${test.latencyMs ? ` · ${test.latencyMs}ms` : ''}` : `失败 · ${shortText(test.error, 80)}`) : null,
            h(Button, { className: 'ghost small', disabled: test?.loading, onClick: () => testModel(id) }, '测试'),
          );
        }),
      ),
      h('hr'),
      h('section', { className: 'hws-unattended' },
        h('div', null, h('h3', null, '无人值守 / 全授权'), h('p', null, '仅写入 Hermes 官方 approvals 配置：mode=off，cron/single-query/unattended=approve，并关闭官方可关闭的确认项；Hermes hardline blocklist 仍永久有效。')),
        h(Button, { className: 'danger', disabled: busy, onClick: unattended }, busy ? '正在验证无人值守…' : '应用并实测无人值守'),
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
    const [workerSnapshot, setWorkerSnapshot] = useState(null);
    const [worker, setWorker] = useState({ loading: true, state: null, catalog: null, health: null, error: '' });
    const [chatRoute, setChatRoute] = useState(null);
    const [historyPage, setHistoryPage] = useState(1);
    const [archivePage, setArchivePage] = useState(1);
    const [moreOpen, setMoreOpen] = useState(false);
    const [globalError, setGlobalError] = useState('');
    const [now, setNow] = useState(Date.now());
    const [skillDiff, setSkillDiff] = useState(null);
    const runPollRef = useRef(null);
    const workerPollRef = useRef(null);
    const skillBeforeRef = useRef([]);

    const sending = run && !TERMINAL_RUN_STATES.has(run.status);

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

    const refreshWorker = useCallback(async () => {
      try {
        const [state, catalog, health] = await Promise.all([
          plugin('/worker/state'), plugin('/worker/catalog'), plugin('/health'),
        ]);
        setWorker({ loading: false, state, catalog, health, error: '' });
        const mode = state?.mode || 'OFFICIAL';
        const route = mode === 'OFFICIAL'
          ? normalizeRoute(catalog, { provider: 'official', model: modelId(modelRows(catalog, 'official')[0]), effort: 'auto' }, 'main')
          : savedRoute(state, catalog, mode, 'main');
        setChatRoute(route);
        return { state, catalog, health };
      } catch (error) {
        setWorker((x) => ({ ...x, loading: false, error: errorText(error) }));
        return null;
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
      if (!session?.id) return;
      setCurrent(session); setView('chat'); setRun(null); setStreamText(''); setWorkerSnapshot(null); setTimelineExpanded(false);
      loadMessages(session);
    }, [loadMessages]);

    useEffect(() => {
      Promise.all([refreshRecent(false), refreshWorker()]).catch(() => {});
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
      if (runPollRef.current) clearTimeout(runPollRef.current);
      if (workerPollRef.current) clearTimeout(workerPollRef.current);
    }, []);

    const pollWorkerTask = useCallback((taskId, activeRunId) => {
      if (!taskId) return;
      const tick = async () => {
        try {
          const data = await plugin(`/worker/status/${encodeURIComponent(taskId)}`);
          setWorkerSnapshot({ taskId, data });
          const status = String(data?.status || data?.state || '').toLowerCase();
          if (!['completed', 'failed', 'error', 'cancelled', 'stopped'].includes(status) && activeRunId === runPollRef.current?.runId) {
            workerPollRef.current = setTimeout(tick, 1200);
          }
        } catch (_) {
          if (activeRunId === runPollRef.current?.runId) workerPollRef.current = setTimeout(tick, 1800);
        }
      };
      tick();
    }, []);

    const pollRun = useCallback((runId, initial) => {
      runPollRef.current = { runId, seq: 0 };
      setRun({ ...initial, events: [], elapsed_ms: 0, last_seq: 0 });
      const tick = async () => {
        const ref = runPollRef.current;
        if (!ref || ref.runId !== runId) return;
        try {
          const data = await plugin(`/hermes/runs/${encodeURIComponent(runId)}?after=${ref.seq}`);
          const incoming = data.events || [];
          if (incoming.length) {
            ref.seq = Math.max(ref.seq, ...incoming.map((e) => Number(e.seq || 0)));
            let discovered = null;
            let deltas = '';
            for (const event of incoming) {
              if (event.event === 'assistant.delta') deltas += deltaText(event.data);
              discovered = discovered || deepTaskId(event.data);
            }
            if (deltas) setStreamText((x) => x + deltas);
            if (discovered && !workerSnapshot?.taskId) pollWorkerTask(discovered, runId);
          }
          setRun((prev) => ({
            ...prev,
            ...data,
            events: [...(prev?.events || []), ...incoming].slice(-10000),
          }));
          if (TERMINAL_RUN_STATES.has(data.status)) {
            setTimelineExpanded(false);
            runPollRef.current = null;
            await loadMessages({ id: data.session_id });
            const sessions = await refreshRecent(true);
            setCurrent((cur) => sessions.find((s) => s.id === cur?.id) || cur);
            await refreshWorker();
            try {
              const afterSkills = await api('/api/skills');
              setSkillDiff(diffSkills(skillBeforeRef.current, Array.isArray(afterSkills) ? afterSkills : []));
            } catch (_) { setSkillDiff(null); }
            return;
          }
          runPollRef.current = ref;
          runPollRef.current.timer = setTimeout(tick, 650);
        } catch (error) {
          setRun((prev) => ({ ...(prev || initial), status: 'failed', ended_at: Date.now() / 1000, events: [...(prev?.events || []), { seq: Date.now(), event: 'studio.error', data: { error: errorText(error) }, at: Date.now() / 1000 }] }));
          setTimelineExpanded(false);
          runPollRef.current = null;
        }
      };
      tick();
    }, [loadMessages, refreshRecent, refreshWorker, pollWorkerTask, workerSnapshot?.taskId]);

    const createSession = useCallback(async () => {
      const out = await plugin('/hermes/sessions', jinit('POST', { title: 'New conversation', source: 'hermes_browser' }));
      const id = getSessionId(out);
      if (!id) throw new Error('Hermes did not return a session id');
      const session = out.session || { id, title: 'New conversation', source: 'hermes_browser' };
      setCurrent(session); setMessages([]);
      await refreshRecent(true);
      return session;
    }, [refreshRecent]);

    const persistMainRoute = useCallback(async (route) => {
      setChatRoute(route);
      const state = worker.state; const catalog = worker.catalog;
      if (!state || !catalog || state.mode === 'OFFICIAL') return;
      const roles = {};
      for (const role of rolesForMode(state.mode)) roles[role] = role === 'main' ? normalizeRoute(catalog, route, 'main') : savedRoute(state, catalog, state.mode, role);
      try {
        await plugin('/worker/routing', jinit('PUT', { mode: state.mode, roles }));
        await refreshWorker();
      } catch (error) { setGlobalError(`路由保存失败：${errorText(error)}`); }
    }, [worker.state, worker.catalog, refreshWorker]);

    const lockRuntimeIfResolvable = useCallback(async (session, route) => {
      if (!session?.id || !route?.model || worker.state?.mode === 'OFFICIAL') return;
      try {
        const options = await plugin('/hermes/model-options?refresh=0');
        const provider = matchingHermesProvider(options, route, worker.state);
        if (!provider) return;
        await plugin(`/hermes/sessions/${encodeURIComponent(session.id)}/model`, jinit('POST', { provider, model: route.model, require_model_lock: true }));
      } catch (error) {
        setGlobalError(`Hermes Session 模型锁未应用（对话仍可继续）：${errorText(error)}`);
      }
    }, [worker.state]);

    const send = useCallback(async () => {
      const text = draft.trim();
      if (!text || sending) return;
      setGlobalError(''); setTimelineExpanded(true); setWorkerSnapshot(null); setStreamText(''); setSkillDiff(null);
      try {
        try {
          const beforeSkills = await api('/api/skills');
          skillBeforeRef.current = Array.isArray(beforeSkills) ? beforeSkills : [];
        } catch (_) { skillBeforeRef.current = []; }
        const session = current?.id ? current : await createSession();
        await lockRuntimeIfResolvable(session, chatRoute);
        setMessages((xs) => [...xs, { role: 'user', content: text, id: `local-${Date.now()}` }]);
        setDraft('');
        const started = await plugin('/hermes/runs', jinit('POST', { session_id: session.id, message: text }));
        pollRun(started.id, started);
      } catch (error) { setGlobalError(errorText(error)); }
    }, [draft, sending, current, createSession, chatRoute, lockRuntimeIfResolvable, pollRun]);

    const toggleArchive = useCallback(async () => {
      if (!current?.id) return;
      try {
        const archived = !current.archived;
        await api(`/api/sessions/${encodeURIComponent(current.id)}`, jinit('PATCH', { archived }));
        if (archived) {
          const sessions = await refreshRecent(true);
          const next = sessions.find((s) => !s.archived) || null;
          setCurrent(next); if (next) await loadMessages(next); else setMessages([]);
        } else setCurrent((x) => ({ ...x, archived: false }));
      } catch (error) { setGlobalError(errorText(error)); }
    }, [current, refreshRecent, loadMessages]);

    const stopRun = useCallback(async () => {
      if (!run?.id) return;
      setGlobalError('');
      try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/stop`, jinit('POST', {})); }
      catch (error) { setGlobalError(`停止 Run 失败：${errorText(error)}`); }
    }, [run?.id]);

    const steerRun = useCallback(async (input) => {
      if (!run?.id || !String(input || '').trim()) return;
      setGlobalError('');
      try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/steer`, jinit('POST', { input: String(input).trim() })); }
      catch (error) { setGlobalError(`Steer 失败：${errorText(error)}`); }
    }, [run?.id]);

    const approveRun = useCallback(async (choice) => {
      if (!run?.id) return;
      setGlobalError('');
      try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/approval`, jinit('POST', { choice })); }
      catch (error) { setGlobalError(`审批提交失败：${errorText(error)}`); }
    }, [run?.id]);

    const newConversation = useCallback(() => {
      setCurrent(null); setMessages([]); setRun(null); setStreamText(''); setWorkerSnapshot(null); setDraft(''); setSkillDiff(null); setView('chat');
    }, []);

    const applyUnattended = useCallback(async () => {
      setGlobalError('');
      try {
        const raw = await api('/api/config');
        const cfg = raw?.config && typeof raw.config === 'object' ? { ...raw.config } : { ...raw };
        cfg.approvals = {
          ...(cfg.approvals && typeof cfg.approvals === 'object' ? cfg.approvals : {}),
          mode: 'off',
          cron_mode: 'approve',
          single_query_mode: 'approve',
          unattended_mode: 'approve',
          mcp_reload_confirm: false,
          destructive_slash_confirm: false,
        };
        await api('/api/config', jinit('PUT', { config: cfg }));
        const readbackRaw = await api('/api/config');
        const readback = readbackRaw?.config && typeof readbackRaw.config === 'object' ? readbackRaw.config : readbackRaw;
        const approvals = readback?.approvals || {};
        const expected = {
          mode: 'off', cron_mode: 'approve', single_query_mode: 'approve', unattended_mode: 'approve',
          mcp_reload_confirm: false, destructive_slash_confirm: false,
        };
        for (const [key, value] of Object.entries(expected)) {
          if (approvals[key] !== value) throw new Error(`Hermes config read-back mismatch: approvals.${key}`);
        }
        const probe = await plugin('/hermes/unattended/probe', jinit('POST', { confirm: 'RUN_SAFE_UNATTENDED_PROBE' }));
        if (probe?.status !== 'UNATTENDED_READY' || probe?.marker_verified !== true) {
          throw new Error('Hermes unattended probe did not return UNATTENDED_READY + marker_verified');
        }
        return probe;
      } catch (error) {
        setGlobalError(errorText(error));
        throw error;
      }
    }, []);

    const content = view === 'search'
      ? h(SearchPage, { onOpen: openSession })
      : view === 'history'
        ? h(PagedSessions, { title: '完整历史对话', archived: 'exclude', page: historyPage, setPage: setHistoryPage, selectedId: current?.id, onSelect: openSession, onBackToChat: openSession })
        : view === 'archive'
          ? h(PagedSessions, { title: '已归档对话', archived: 'only', page: archivePage, setPage: setArchivePage, selectedId: null, onSelect: openSession, onBackToChat: openSession })
          : view === 'worker'
            ? h(WorkerPage, { state: worker.state, catalog: worker.catalog, health: worker.health, refresh: refreshWorker, setShared: refreshWorker, onUnattended: applyUnattended })
            : h(Conversation, {
              session: current, messages, loading: messagesLoading, onArchive: toggleArchive,
              run, workerSnapshot, timelineExpanded, setTimelineExpanded, streamText,
              draft, setDraft, onSend: send, sending, workerState: worker.state,
              catalog: worker.catalog, chatRoute, onChatRoute: persistMainRoute, now,
              onStop: stopRun, onSteer: steerRun, onApprove: approveRun, skillDiff,
            });

    return h('div', { className: 'hws-root' },
      h('aside', { className: 'hws-sidebar' },
        h('div', { className: 'hws-brand' }, h('span', { className: 'hws-logo' }, 'H'), h('div', null, h('strong', null, 'Hermes Worker Studio'), h('small', null, 'Official-surface-first'))),
        h(Button, { className: 'primary new', onClick: newConversation }, '+ 新建对话'),
        h('nav', { className: 'hws-nav' }, PRIMARY_NAV.map(([id, label, icon]) => h('button', { key: id, className: view === id ? 'active' : '', onClick: () => setView(id) }, h('span', null, icon), label))),
        h('div', { className: 'hws-recents-head' }, h('span', null, `最近 ${RECENT_LIMIT} 条`), h('button', { onClick: () => refreshRecent(true), title: '刷新' }, '↻')),
        h(ErrorBar, { error: recent.error }),
        h('div', { className: 'hws-recents' }, recent.loading ? h(Empty, null, h(Spinner)) : recent.sessions.map((s) => h(SessionRow, { key: s.id, session: s, active: current?.id === s.id && view === 'chat', onClick: () => openSession(s) }))),
        h('div', { className: 'hws-native-nav' }, HERMES_PRIMARY.map(([path, label, icon]) => h('a', { href: baseHref(path), key: path }, h('span', null, icon), label))),
        h('div', { className: 'hws-more' },
          h('button', { className: 'hws-more-toggle', onClick: () => setMoreOpen(!moreOpen) }, h('span', null, '⋯'), '更多', h('span', { className: 'hws-more-chevron' }, moreOpen ? '⌃' : '⌄')),
          moreOpen ? h('div', { className: 'hws-more-menu' }, HERMES_SECONDARY.map(([path, label]) => h('a', { href: baseHref(path), key: path }, label))) : null,
        ),
        h('footer', { className: 'hws-sidebar-foot' },
          worker.loading ? h(React.Fragment, null, h(Spinner), ' 连接中') : h(React.Fragment, null,
            h(Pill, { tone: worker.error ? 'bad' : 'good' }, worker.error ? 'Worker 异常' : (worker.state?.mode || 'Worker')),
            h('small', null, worker.error || 'Hermes 官方 API + Worker 控制面'),
          ),
        ),
      ),
      h('main', { className: 'hws-main' },
        h(ErrorBar, { error: globalError, onClear: () => setGlobalError('') }),
        worker.error && view !== 'worker' ? h('div', { className: 'hws-warning-note top' }, `Worker 控制面暂不可用：${worker.error}。Hermes 历史与搜索仍可继续使用。`) : null,
        content,
      ),
    );
  }

  window.__HERMES_PLUGINS__.register('hermes-worker-studio', StudioApp);
})();
