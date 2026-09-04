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
  const PROJECT_MARK_PATH = '/dashboard-plugins/hermes-worker-studio/dist/project-mark.png';
  const RECENT_LIMIT = 10;
  const CHAT_MESSAGE_LIMIT = 10;
  const HISTORY_SESSION_LIMIT = 30;
  const HISTORY_MESSAGE_LIMIT = 100;
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'incomplete', 'cancelled', 'canceled', 'stopped', 'interrupted']);
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
  const ADVANCED_MARKER = 'hws3:advanced-hermes-dashboard';

  const PRIMARY_NAV = [
    ['chat', '对话', '✦'],
    ['worker', 'Worker', '⇄'],
    ['models', '模型', '◫'],
    ['moa', 'MOA', '◈'],
    ['unattended', '完全访问', '⚡'],
    ['history', '完整历史', '☷'],
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
  function markAdvancedNavigation() { try { sessionStorage.setItem(ADVANCED_MARKER, '1'); } catch (_) {} }
  function clearAdvancedNavigation() { try { sessionStorage.removeItem(ADVANCED_MARKER); } catch (_) {} }
  function projectMarkHref() { return baseHref(PROJECT_MARK_PATH); }
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
  const GENERATED_TITLE_SUFFIX = /\s·\s[a-z0-9]{5}$/i;
  function sessionTitle(session) {
    const raw = session?.title || session?.preview || session?.id || '未命名对话';
    return String(raw).replace(GENERATED_TITLE_SUFFIX, '') || '未命名对话';
  }
  function getSessionId(payload) { return payload?.session?.id || payload?.session_id || payload?.id || null; }
  function isMoaSession(session) {
    const provider = String(session?.provider || session?.model_provider || session?.route?.provider || session?.model_config?.provider || session?.browser_model_lock?.provider || '').toLowerCase();
    const model = String(session?.model || session?.model_name || session?.route?.model || session?.model_config?.model || session?.browser_model_lock?.model || '').toLowerCase();
    const title = String(sessionTitle(session)).toLowerCase();
    const lock = session?.model_config?.browser_model_lock || session?.browser_model_lock || {};
    return session?.studio_moa === true || session?.studio_moa?.provider === 'moa' || provider === 'moa' || model === 'moa' || model.includes('mixture of agents') || String(lock.provider || '').toLowerCase() === 'moa' || String(lock.model || '').toLowerCase() === 'moa' || title.startsWith('◈ moa') || title.startsWith('moa ·');
  }
  function moaSessionLabel(session) { return isMoaSession(session) ? `MOA · ${session?.preset || session?.model || 'Mixture of Agents'}` : ''; }
  const SLASH_ZH = {
    '/compress': '压缩当前会话上下文（Hermes 官方）',
    '/compact': '压缩当前会话上下文（Hermes 官方别名）',
    '/help': '显示 Hermes 官方帮助',
    '/title': '设置当前会话标题',
    '/new': '创建新的 Hermes 会话',
    '/resume': '恢复 Hermes 会话',
    '/model': '切换当前 Hermes 模型',
    '/skills': '查看或管理 Hermes Skills',
  };
  Object.assign(SLASH_ZH, {
    '/start': '确认 Hermes 启动探测（官方）', '/reset': '新建会话（官方别名）', '/save': '导出当前会话', '/retry': '重试上一条消息', '/undo': '撤回若干轮并重新提示', '/handoff': '将会话交接到消息平台', '/branch': '创建当前会话分支', '/fork': '创建当前会话分支（官方别名）', '/stop': '停止后台运行任务', '/pause': '暂停或恢复全局新任务', '/approve': '批准待确认的危险命令', '/deny': '拒绝待确认的危险命令', '/bg': '在后台会话运行提示', '/btw': '提出旁支问题且不打断当前任务', '/agents': '查看活动 Agent 与任务', '/tasks': '查看活动 Agent 与任务（官方别名）', '/queue': '排队下一轮提示', '/q': '排队下一轮提示（官方别名）', '/steer': '在下一次工具调用后注入提示', '/goal': '设置跨轮持续目标', '/subgoal': '管理当前目标的附加条件', '/heartbeat': '设置空闲时周期性提示', '/hb': '设置空闲时周期性提示（官方别名）', '/refine': '复盘当前会话并保存经验', '/review': '启动独立 Agent 审查当前工作', '/loop': '按周期重复运行提示', '/proactive': '按周期重复运行提示（官方别名）', '/plan': '写入实现计划但不执行', '/moa': '通过官方 MOA preset 运行一次提示', '/status': '显示会话、模型、Token 与上下文状态', '/context': '显示详细上下文与压缩统计', '/ctx': '显示详细上下文（官方别名）', '/whoami': '显示当前斜杠命令权限', '/profile': '显示当前 Profile 与目录', '/sessions': '浏览并恢复历史会话', '/config': '显示当前配置', '/model': '切换当前会话模型', '/reasoning': '管理思考强度与显示', '/fast': '切换快速模式', '/voice': '切换语音模式', '/busy': '控制工作中收到新消息的行为', '/tools': '管理工具启用状态', '/toolsets': '列出可用工具集', '/memory': '查看或管理待处理记忆写入', '/bundles': '列出 Skill bundles', '/learn': '从描述内容学习可复用 Skill', '/init': '扫描项目并生成或更新 AGENTS.md', '/cron': '管理定时任务', '/suggestions': '管理自动化建议', '/suggest': '管理自动化建议（官方别名）', '/blueprint': '从模板设置自动化', '/bp': '从模板设置自动化（官方别名）', '/reload': '重新载入环境变量', '/reload-mcp': '重新载入 MCP 服务', '/reload-skills': '重新扫描 Skills', '/plugins': '列出已安装插件及状态', '/commands': '浏览全部命令与 Skills', '/palette': '打开模糊命令面板', '/restart': '排空运行任务后重启 Gateway', '/usage': '显示 Token 用量与限额', '/insights': '显示用量分析', '/platforms': '显示 Gateway 与消息平台状态', '/gateway': '显示 Gateway 与消息平台状态（官方别名）', '/copy': '复制上一条助手回复', '/paste': '附加剪贴板图片', '/image': '附加本地图片文件', '/update': '更新 Hermes Agent', '/version': '显示 Hermes Agent 版本', '/v': '显示 Hermes Agent 版本（官方别名）', '/debug': '上传调试报告并获取链接', '/quit': '退出 CLI', '/exit': '退出 CLI（官方别名）', '/clear': '清屏并新建会话', '/redraw': '强制重绘界面', '/history': '显示会话历史', '/topic': '管理 Telegram DM 主题会话', '/sethome': '将当前会话设为 Home channel', '/set-home': '将当前会话设为 Home channel（官方别名）', '/codex-runtime': '切换 Codex app-server runtime', '/codex_runtime': '切换 Codex runtime（官方别名）', '/statusbar': '切换上下文与模型状态栏', '/sb': '切换状态栏（官方别名）', '/timestamps': '切换消息时间戳', '/ts': '切换消息时间戳（官方别名）', '/diff': '显示工作区 Git 变更', '/verbose': '循环切换工具进度显示', '/focus': '切换只显示提示与最终回复', '/footer': '切换最终回复的 Gateway 元数据尾部', '/yolo': '切换免审批模式', '/approvals': '显示或设置危险命令审批模式', '/skin': '显示或切换界面主题', '/indicator': '选择忙碌指示器样式', '/wake': '切换 Hey Hermes 唤醒词监听', '/egress': '显示 Docker 出站代理状态', '/pet': '切换或领养 Petdex 吉祥物', '/hatch': '从描述生成 Petdex 吉祥物', '/generate-pet': '从描述生成 Petdex 吉祥物（官方别名）', '/curator': '管理后台 Skill 维护任务', '/kanban': '管理多 Profile 协作看板', '/reload_mcp': '重新载入 MCP 服务（官方别名）', '/reload_skills': '重新扫描 Skills（官方别名）',
  });
  function slashDescription(item) {
    const name = slashCommandText(item).toLowerCase();
    return SLASH_ZH[name] || (item?.kind === 'plugin' || item?.kind === 'skill' ? `Hermes 官方扩展：${item?.meta || name}` : `Hermes 官方命令：${name}`);
  }
  function slashCommandText(item) {
    const text = String(item?.text || '').trim();
    const display = String(item?.display || '').trim();
    const candidate = [text, display].find((value) => value.startsWith('/')) || text || display;
    const token = candidate.split(/\s+/, 1)[0].trim();
    if (!token) return '';
    return token.startsWith('/') ? token : `/${token}`;
  }

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
    const href = projectMarkHref();
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

  function isManagedProtocolProvider(row) {
    return String(row?.slug || '').toLowerCase().startsWith('hws-protocol-') || row?.hws_protocol_bridge?.managed_by === 'hermes-worker-studio';
  }
  function providerRows(options) { return (Array.isArray(options?.providers) ? options.providers : []).filter((row) => !isManagedProtocolProvider(row)); }
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
  function sessionModelValue(session) {
    const lock = session?.model_config?.browser_model_lock || session?.browser_model_lock || {};
    return [session?.model, session?.model_name, session?.route?.model, lock.model, session?.model_config?.model]
      .map((value) => String(value || '').trim()).find(Boolean) || '';
  }
  function sessionProviderHints(session, projection) {
    const lock = session?.model_config?.browser_model_lock || session?.browser_model_lock || {};
    const turns = Array.isArray(projection?.turns) ? projection.turns : [];
    const projected = [...turns].reverse()
      .map((turn) => turn?.studio_route || turn?.requested_route || turn?.source_route)
      .find((route) => route && typeof route === 'object');
    return [
      session?.provider,
      session?.model_provider,
      session?.route?.provider,
      session?.model_config?.provider,
      lock.provider,
      projected?.source_provider,
      projected?.provider,
    ].map((value) => String(value || '').trim()).filter(Boolean);
  }
  function sessionEffortValue(session, projection) {
    const lock = session?.model_config?.browser_model_lock || session?.browser_model_lock || {};
    const lockOptions = lock.model_options && typeof lock.model_options === 'object' ? lock.model_options : {};
    const turns = Array.isArray(projection?.turns) ? projection.turns : [];
    const projected = [...turns].reverse()
      .map((turn) => turn?.studio_route || turn?.requested_route || turn?.source_route)
      .find((route) => route && typeof route === 'object');
    return [
      session?.effort,
      session?.reasoning_effort,
      session?.route?.effort,
      lockOptions.reasoning_effort,
      lockOptions.reasoning?.effort,
      projected?.effort,
      projected?.reasoning,
    ].map((value) => typeof value === 'string' ? value.trim() : '').find(Boolean) || 'auto';
  }
  function routeForSession(options, session, projection = null, preferredProvider = '') {
    const model = sessionModelValue(session);
    if (!model) return null;
    const matches = authenticatedProviders(options).filter((provider) => Array.isArray(provider.models) && provider.models.includes(model));
    if (!matches.length) return null;
    const hints = sessionProviderHints(session, projection);
    const hinted = hints.map((hint) => providerBySlug(options, hint)).find((provider) => provider && provider.models?.includes(model));
    const preferred = providerBySlug(options, preferredProvider);
    const selected = hinted || (preferred && matches.some((provider) => provider.slug === preferred.slug) ? preferred : null) || matches.find((provider) => provider.is_current) || matches[0];
    return normalizeRoute(options, { provider: selected.slug, model, effort: sessionEffortValue(session, projection) });
  }
  function routeIdentity(route) { return `${String(route?.provider || '').trim()}\u0000${String(route?.model || '').trim()}`; }
  function modelCapability(options, provider, model) { return providerBySlug(options, provider)?.capabilities?.[model] || {}; }
  function modelApiMode(options, provider, model) {
    const cap = modelCapability(options, provider, model);
    return canonicalApiMode(cap?.api_mode || cap?.transport || cap?.protocol || cap?.apiMode || '');
  }
  function reasoningOptions(options, provider, model) {
    const cap = modelCapability(options, provider, model);
    const candidates = [cap?.reasoning?.options, cap?.reasoning?.efforts, cap?.reasoning?.supported_efforts, cap?.reasoning?.supportedEfforts, cap?.reasoning_efforts, cap?.reasoningEfforts, cap?.supported_reasoning_efforts, cap?.supportedReasoningEfforts];
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
  function reasoningSummary(options, provider, model) {
    const efforts = reasoningOptions(options, provider, model).filter((item) => item.value !== 'auto');
    if (efforts.length) return efforts.map((item) => item.value).join(' · ');
    const cap = modelCapability(options, provider, model);
    const raw = cap?.reasoning;
    const rich = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (raw === false || rich.supported === false || cap?.supports_reasoning === false) return '不支持';
    if (raw === true || (raw && typeof raw === 'object') || cap?.supports_reasoning === true) return 'Hermes 返回思考支持 · 档位未公开';
    return '上游未声明';
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
  async function assertMoaReady(options, route) {
    if (String(route?.provider || '').trim().toLowerCase() !== 'moa') return;
    let config;
    try {
      try { config = await plugin('/hermes/moa-config'); }
      catch (_) { config = await api('/api/model/moa'); }
    } catch (error) {
      throw new Error(`MOA 官方配置读取失败：${errorText(error)}`);
    }
    const presetName = String(route.model || config?.default_preset || 'default');
    const preset = config?.presets?.[presetName];
    if (!preset || typeof preset !== 'object') {
      throw new Error(`MOA preset “${presetName}” 不存在，请先在侧边栏 MOA 中选择并保存官方配置。`);
    }
    const references = Array.isArray(preset.reference_models)
      ? preset.reference_models.filter((slot) => slot?.enabled !== false)
      : [];
    const aggregator = preset.aggregator && typeof preset.aggregator === 'object' ? preset.aggregator : {};
    const slots = [...references, aggregator];
    const incomplete = slots.some((slot) => !String(slot?.provider || '').trim() || !String(slot?.model || '').trim());
    if (!references.length || incomplete) {
      throw new Error(`MOA preset “${presetName}” 未就绪：请进入侧边栏 MOA，为至少一个 Reference 和 Aggregator 选择 Provider/Model 并保存。`);
    }
    const missingProviders = [...new Set(slots.map((slot) => String(slot.provider).trim()))].filter((provider) => {
      const row = providerBySlug(options, provider);
      return !row || row.authenticated !== true;
    });
    if (missingProviders.length) {
      throw new Error(`MOA preset “${presetName}” 未就绪：Hermes 尚未确认这些 Provider 已配置：${missingProviders.join('、')}。请先完成官方 hermes setup/provider 配置，再运行。`);
    }
    // Native Hermes reads the persisted official MoA slots when the Gateway
    // starts the virtual `moa` session. Ask the bridge to resolve any mixed
    // custom-endpoint slots immediately before prompt.submit, so the native
    // runtime receives the same per-model protocol decision as Studio's model
    // page. This call is deliberately not made while merely rendering MOA.
    try {
      await plugin('/hermes/moa-runtime', jinit('POST', { preset: presetName }));
    } catch (error) {
      if (/Unhandled fetchJSON call|404|Not Found/i.test(errorText(error))) return;
      throw new Error(`MOA 官方运行配置解析失败：${errorText(error)}`);
    }
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
    if (name === 'run.reconciled') return data?.status === 'incomplete' ? 'Hermes 官方核验：会话已空闲，未收到完整终态' : 'Hermes 官方核验：会话已收口';
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
    if (name === 'run.reconciled') return shortText(data.detail || '', 360);
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

  // Historical projections created before assistant_message_id was persisted
  // still need to attach their official Hermes lifecycle to the right
  // assistant message.  Every fallback below is deliberately conservative:
  // an ambiguous turn remains in the archive section instead of being
  // silently attached to the wrong message.
  function projectionTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed / 1000 : null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric > 100000000000 ? numeric / 1000 : numeric;
  }
  function officialMessageTimestamp(message) {
    for (const key of ['timestamp', 'created_at', 'createdAt', 'time']) {
      const timestamp = projectionTimestamp(message?.[key]);
      if (timestamp !== null) return timestamp;
    }
    return null;
  }
  function officialRunTimestamp(run) {
    for (const key of ['ended_at', 'completed_at', 'finished_at', 'started_at']) {
      const timestamp = projectionTimestamp(run?.[key]);
      if (timestamp !== null) return timestamp;
    }
    const events = Array.isArray(run?.events) ? run.events : [];
    for (let i = events.length - 1; i >= 0; i--) {
      const timestamp = projectionTimestamp(events[i]?.at || events[i]?.timestamp);
      if (timestamp !== null) return timestamp;
    }
    return null;
  }
  function comparableProjectionText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
  function projectionOutputText(run) {
    const output = run?.output;
    if (typeof output === 'string') return output;
    if (!output || typeof output !== 'object') return '';
    if (typeof output.output_text === 'string') return output.output_text;
    if (typeof output.text === 'string') return output.text;
    if (typeof output.content === 'string') return output.content;
    return messageText({ content: output });
  }
  function projectedTurnIsActive(turn) {
    return Boolean(turn) && !TERMINAL_RUN_STATES.has(String(turn.status || '').toLowerCase());
  }
  const RECONCILIATION_SOURCE = 'hermes.gateway.session.resume_reconciliation';
  function reconciliationEvents(turn) {
    return (Array.isArray(turn?.events) ? turn.events : []).filter((event) => event?.event === 'run.reconciled'
      && event?.data?.source === RECONCILIATION_SOURCE);
  }
  function hasCompletedReconciliation(turn) {
    return reconciliationEvents(turn).some((event) => event?.data?.status === 'completed');
  }
  function hasStaleIncompleteReconciliation(turn) {
    const status = String(turn?.status || '').toLowerCase();
    const hasIncomplete = reconciliationEvents(turn).some((event) => event?.data?.status === 'incomplete');
    return hasIncomplete && (status === 'completed' || hasCompletedReconciliation(turn));
  }
  function projectedTurnTerminalEvent(turn) {
    const events = Array.isArray(turn?.events) ? turn.events : [];
    const terminalNames = new Set(['message.complete', 'run.completed', 'run.failed', 'run.error', 'run.cancelled', 'run.canceled', 'run.stopped', 'run.interrupted']);
    return events
      .filter((event) => terminalNames.has(String(event?.event || '').toLowerCase()))
      .sort((left, right) => (projectionTimestamp(left?.at || left?.timestamp) || 0) - (projectionTimestamp(right?.at || right?.timestamp) || 0))
      .pop() || null;
  }
  function officialAssistantForProjectedTurn(turn, messages) {
    const assistantMessages = (messages || []).filter((message) => message?.role === 'assistant'
      && message?.id
      && comparableProjectionText(messageText(message)));
    if (!assistantMessages.length) return null;
    const ids = new Set(projectionMessageIds(turn));
    const byId = assistantMessages.find((message) => ids.has(String(message.id)));
    if (byId) return byId;
    const output = comparableProjectionText(projectionOutputText(turn));
    if (output) {
      const exact = assistantMessages.filter((message) => comparableProjectionText(messageText(message)) === output);
      if (exact.length === 1) return exact[0];
    }
    // A refresh can restore the projection before the UI has persisted the
    // assistant_message_id.  Match the official assistant record by the
    // official timestamp only when it is the unique nearest response in a
    // short window; an ambiguous turn stays unresolved rather than being
    // attached to the wrong answer.
    const startedAt = projectionTimestamp(turn?.started_at);
    if (startedAt === null) return null;
    const pairs = assistantMessages.map((message) => {
      const messageAt = officialMessageTimestamp(message);
      return messageAt === null ? null : { message, distance: Math.abs(messageAt - startedAt), messageAt };
    }).filter((pair) => pair && pair.messageAt >= startedAt - 2 && pair.distance <= 120)
      .sort((left, right) => left.distance - right.distance);
    if (!pairs.length || (pairs[1] && pairs[1].distance - pairs[0].distance < 2)) return null;
    return pairs[0].message;
  }
  function projectedTurnNeedsReconciliation(turn, messages) {
    if (projectedTurnIsActive(turn)) return true;
    if (hasCompletedReconciliation(turn) && String(turn?.status || '').toLowerCase() !== 'completed') return true;
    if (hasStaleIncompleteReconciliation(turn)) return true;
    return String(turn?.status || '').toLowerCase() === 'incomplete'
      && Boolean(officialAssistantForProjectedTurn(turn, messages));
  }
  function reconcileProjectedTurns(turns, snapshot, messages) {
    if (!Array.isArray(turns) || snapshot?.active !== false) return { turns, changed: false };
    const checkedAt = projectionTimestamp(snapshot?.checked_at) || Date.now() / 1000;
    let changed = false;
    const next = turns.map((turn) => {
      const officialAssistant = officialAssistantForProjectedTurn(turn, messages);
      const turnStatus = String(turn?.status || '').toLowerCase();
      const rawEvents = Array.isArray(turn.events) ? [...turn.events] : [];
      const priorCompleted = [...reconciliationEvents(turn)].reverse().find((event) => event?.data?.status === 'completed') || null;
      const terminalEvent = projectedTurnTerminalEvent(turn);
      const eventName = String(terminalEvent?.event || '').toLowerCase();
      const failureEvent = eventName.includes('fail') || eventName === 'run.error';
      const interruptedEvent = ['run.cancelled', 'run.canceled', 'run.stopped', 'run.interrupted'].includes(eventName);
      const output = comparableProjectionText(projectionOutputText(turn));
      const hasCompletionEvidence = turnStatus === 'completed' || Boolean(priorCompleted) || Boolean(terminalEvent) || Boolean(output) || Boolean(officialAssistant);
      const recoverableIncomplete = turnStatus === 'incomplete' && hasCompletionEvidence && !failureEvent && !interruptedEvent;
      const staleIncomplete = hasStaleIncompleteReconciliation(turn);
      const needsNormalization = hasCompletedReconciliation(turn) && turnStatus !== 'completed';
      if (!projectedTurnIsActive(turn) && !recoverableIncomplete && !staleIncomplete && !needsNormalization) return turn;
      // An early refresh may have recorded an idle-without-terminal
      // observation just before Hermes persisted its official assistant
      // message.  Once the turn is known to be complete, that provisional
      // observation is no longer a lifecycle fact and must not remain beside
      // the final reconciliation event.
      const events = rawEvents.filter((event) => !((hasCompletionEvidence && !failureEvent && !interruptedEvent)
        && event?.event === 'run.reconciled'
        && event?.data?.source === RECONCILIATION_SOURCE
        && event?.data?.status === 'incomplete'));
      const status = failureEvent
        ? 'failed'
        : interruptedEvent
          ? 'interrupted'
          : hasCompletionEvidence ? 'completed' : 'incomplete';
      const officialMessageAt = officialMessageTimestamp(officialAssistant);
      // `run.reconciled.at` is the observation time, not the completion time.
      // It is valid evidence that the official session was idle, but it must
      // never become a fabricated duration when the older projection did not
      // retain a lifecycle terminal timestamp or the matching message is not
      // in the current recent-message window.
      const terminalAt = projectionTimestamp(terminalEvent?.at || terminalEvent?.timestamp) || officialMessageAt;
      const startedAt = projectionTimestamp(turn.started_at);
      const durationKnown = terminalAt !== null && startedAt !== null && terminalAt >= startedAt;
      const reconciliationSource = RECONCILIATION_SOURCE;
      const priorReconciliation = [...events].reverse().find((event) => event?.event === 'run.reconciled' && event?.data?.source === reconciliationSource);
      const alreadyRecorded = priorReconciliation?.data?.status === status
        && (!officialAssistant || !priorReconciliation?.data?.official_message_id || String(priorReconciliation?.data?.official_message_id) === String(officialAssistant.id));
      const maxSeq = events.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0);
      const nextElapsed = durationKnown
        ? Math.round((terminalAt - startedAt) * 1000)
        : status === 'completed' ? (turn.elapsed_ms ?? null) : null;
      const nextElapsedSource = durationKnown
        ? terminalEvent
          ? 'hermes.gateway.resume.reconciliation.lifecycle.timestamps'
          : 'hermes.gateway.resume.reconciliation.official_message_timestamp'
        : status === 'completed' ? (turn.elapsed_source || 'hermes.gateway.resume.reconciliation.observed_idle') : 'hermes.gateway.resume.reconciliation.observed_idle';
      const nextEndedAt = status === 'completed'
        ? terminalAt || (turn.elapsed_source === 'hermes.gateway.resume.reconciliation.observed_idle' ? null : turn.ended_at) || null
        : turn.elapsed_source === 'hermes.gateway.resume.reconciliation.observed_idle' ? null : turn.ended_at || null;
      const nextEvents = [...events];
      if (!alreadyRecorded) {
        nextEvents.push({
          seq: maxSeq + 1,
          event: 'run.reconciled',
          data: {
            source: reconciliationSource,
            observed_idle: true,
            status,
            message_count: snapshot?.message_count ?? null,
            official_message_id: officialAssistant?.id ? String(officialAssistant.id) : null,
            evidence: officialAssistant ? 'hermes.session.messages.assistant' : terminalEvent || output || priorCompleted ? 'projection.terminal_evidence' : 'hermes.gateway.session.resume.idle_without_terminal',
            detail: status === 'incomplete'
              ? 'Hermes 官方 Gateway 已确认会话已空闲，但没有收到完整终态事件，也没有官方助手回答。'
              : officialAssistant
                ? 'Hermes 官方 Gateway 已确认会话已空闲，并在官方消息记录中找到该轮助手回答。'
                : 'Hermes 官方 Gateway 已确认会话已空闲，并据投影中的终态证据收口。',
          },
          at: checkedAt,
        });
      }
      const explicitIds = projectionMessageIds(turn);
      const nextAssistantId = officialAssistant?.id ? String(officialAssistant.id) : turn.assistant_message_id;
      const nextMessageIds = officialAssistant?.id ? [...new Set([...explicitIds, String(officialAssistant.id)])] : turn.message_ids;
      const stateChanged = String(turn.status || '').toLowerCase() !== status
        || Number(turn.ended_at || 0) !== Number(nextEndedAt || 0)
        || (turn.elapsed_ms ?? null) !== nextElapsed
        || String(turn.elapsed_source || '') !== nextElapsedSource
        || nextEvents.length !== rawEvents.length
        || nextEvents.some((event, index) => event !== rawEvents[index])
        || String(turn.assistant_message_id || '') !== String(nextAssistantId || '')
        || JSON.stringify(turn.message_ids || null) !== JSON.stringify(nextMessageIds || null);
      if (stateChanged) {
        changed = true;
        return {
          ...turn,
          status,
          ended_at: nextEndedAt,
          elapsed_ms: nextElapsed,
          elapsed_source: nextElapsedSource,
          ...(nextAssistantId ? { assistant_message_id: nextAssistantId } : {}),
          ...(nextMessageIds ? { message_ids: nextMessageIds } : {}),
          events: nextEvents,
        };
      }
      return turn;
    });
    return { turns: next, changed };
  }
  function projectionEventKey(event) {
    const gatewaySeq = Number(event?.gateway_seq);
    if (Number.isFinite(gatewaySeq) && gatewaySeq > 0) return `gateway:${gatewaySeq}`;
    return `${String(event?.event || '')}:${String(event?.at || event?.timestamp || '')}:${JSON.stringify(event?.data || {})}`;
  }
  function mergeProjectedRunEvents(projected, attached) {
    const rows = [];
    const seen = new Set();
    for (const event of [...(Array.isArray(projected?.events) ? projected.events : []), ...(Array.isArray(attached?.events) ? attached.events : [])]) {
      const key = projectionEventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(event);
    }
    return rows.sort((left, right) => (Number(left?.seq) || 0) - (Number(right?.seq) || 0));
  }
  function projectedGatewaySeq(turn) {
    return Math.max(
      Number(turn?.gateway_last_seq) || 0,
      ...(Array.isArray(turn?.events) ? turn.events.map((event) => Number(event?.gateway_seq) || 0) : []),
    );
  }
  function projectedLocalSeq(turn) {
    return Math.max(
      Number(turn?.last_seq) || 0,
      ...(Array.isArray(turn?.events) ? turn.events.map((event) => Number(event?.seq) || 0) : []),
    );
  }
  function projectionMessageIds(run) {
    const values = [];
    for (const key of ['assistant_message_id', 'message_id', 'message_ids']) {
      const raw = run?.[key];
      const rows = Array.isArray(raw) ? raw : raw === null || raw === undefined || raw === '' ? [] : [raw];
      for (const value of rows) {
        const id = String(value || '').trim();
        if (id && !values.includes(id)) values.push(id);
      }
    }
    return values;
  }
  function mapTurnRunsToMessages(turnRuns, messages) {
    const assistantMessages = (messages || []).filter((message) => message?.role === 'assistant' && message?.id);
    const messageById = new Map(assistantMessages.map((message) => [String(message.id), message]));
    const mappedTurnIds = new Set();
    const mappedMessageIds = new Set();
    const byMessageId = new Map();
    const updates = [];
    const mappedRuns = new Map();
    const assign = (run, message, source) => {
      const runId = String(run?.id || '').trim();
      const messageId = String(message?.id || '').trim();
      if (!runId || !messageId || mappedTurnIds.has(runId) || mappedMessageIds.has(messageId)) return false;
      const mapped = { ...run, mapping_source: source };
      mappedTurnIds.add(runId);
      mappedMessageIds.add(messageId);
      byMessageId.set(messageId, mapped);
      mappedRuns.set(runId, mapped);
      const explicitIds = projectionMessageIds(run);
      if (String(run?.assistant_message_id || '') !== messageId || !explicitIds.includes(messageId)) {
        updates.push({ id: runId, assistant_message_id: messageId, message_ids: [...new Set([...explicitIds, messageId])] });
      }
      return true;
    };

    // 1. Prefer the IDs emitted by Hermes itself.
    for (const run of turnRuns || []) {
      const target = projectionMessageIds(run).map((id) => messageById.get(id)).find(Boolean);
      if (target) assign(run, target, 'hermes_message_id');
    }

    // 2. If an older projection retained only the final output, require an
    // exact, unique match among the loaded official assistant messages.
    for (const run of turnRuns || []) {
      const runId = String(run?.id || '').trim();
      if (!runId || mappedTurnIds.has(runId)) continue;
      const output = comparableProjectionText(projectionOutputText(run));
      if (!output) continue;
      const candidates = assistantMessages.filter((message) => !mappedMessageIds.has(String(message.id)) && comparableProjectionText(messageText(message)) === output);
      if (candidates.length === 1) assign(run, candidates[0], 'hermes_output_exact');
    }

    // 3. Finally use official timestamps only when the nearest pairing is
    // unique from both sides and falls within a short response window.
    const pairs = [];
    for (const run of turnRuns || []) {
      const runId = String(run?.id || '').trim();
      const runTime = officialRunTimestamp(run);
      if (!runId || mappedTurnIds.has(runId) || runTime === null) continue;
      for (const message of assistantMessages) {
        const messageId = String(message.id);
        const messageTime = officialMessageTimestamp(message);
        if (mappedMessageIds.has(messageId) || messageTime === null) continue;
        const distance = Math.abs(messageTime - runTime);
        if (distance <= 120) pairs.push({ run, message, distance });
      }
    }
    const nearestUnique = (rows, key) => {
      const grouped = new Map();
      for (const row of rows) {
        const id = String(row[key]?.id || '');
        if (!id) continue;
        const existing = grouped.get(id) || [];
        existing.push(row);
        grouped.set(id, existing);
      }
      const out = [];
      for (const rowsForId of grouped.values()) {
        rowsForId.sort((a, b) => a.distance - b.distance);
        if (rowsForId.length === 1 || rowsForId[1].distance - rowsForId[0].distance >= 2) out.push(rowsForId[0]);
      }
      return out;
    };
    const runNearest = nearestUnique(pairs, 'run');
    const messageNearest = new Map(nearestUnique(pairs, 'message').map((row) => [String(row.message.id), row]));
    for (const pair of runNearest.sort((a, b) => a.distance - b.distance)) {
      const messagePair = messageNearest.get(String(pair.message.id));
      if (messagePair && messagePair.run?.id === pair.run?.id) assign(pair.run, pair.message, 'hermes_timestamp');
    }

    return { byMessageId, mappedTurnIds, mappedRuns, updates };
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
    const compactionState = String(data.compaction_state || data.compaction_status || data.compaction_phase || '').toLowerCase();
    const hasMeaningfulUsage = (used !== null && (used > 0 || (maximum !== null && maximum > 0)))
      || (maximum !== null && maximum > 0)
      || (threshold !== null && threshold > 0)
      || (compressionCount !== null && compressionCount > 0)
      || Boolean(compactionState);
    // Some Hermes builds return placeholder zeros while the session has no
    // official context snapshot.  Treat 0/0 as unavailable rather than
    // presenting it as a real measurement in the product header.
    if (!hasMeaningfulUsage) return null;
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
      compactionState,
      compacted: data.compacted === true || ['compacted', 'completed', 'complete', 'done', 'finished'].includes(compactionState),
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
    let compacting = ['compacting', 'started', 'start', 'running', 'compressing'].includes(String(telemetry?.compactionState || '').toLowerCase());
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

  // Hermes stores a provider base URL and its wire transport separately. A
  // pasted route suffix is therefore a safe, deterministic hint, not a claim
  // that a generic proxy can be introspected without making a billable call.
  function inferApiModeFromEndpointInput(value) {
    const path = String(value || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    if (/(?:^|\/)v1\/responses$/.test(path) || /\/responses$/.test(path)) return 'codex_responses';
    if (/(?:^|\/)v1\/chat\/completions$/.test(path) || /\/chat\/completions$/.test(path)) return 'chat_completions';
    if (/(?:^|\/)v1\/messages$/.test(path) || /\/messages$/.test(path)) return 'anthropic_messages';
    return '';
  }

  function canonicalApiMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'auto') return '';
    if (['responses', 'openai_responses', 'codex_responses'].includes(raw)) return 'codex_responses';
    if (['anthropic', 'messages', 'anthropic_messages'].includes(raw)) return 'anthropic_messages';
    if (['chat', 'chat_completions', 'openai_chat'].includes(raw)) return 'chat_completions';
    if (raw === 'bedrock' || raw === 'bedrock_converse') return 'bedrock_converse';
    return raw;
  }
  function apiModeLabel(value) {
    const mode = canonicalApiMode(value);
    if (mode === 'codex_responses') return 'Responses';
    if (mode === 'anthropic_messages') return 'Anthropic Messages';
    if (mode === 'chat_completions') return 'Chat Completions';
    if (mode === 'bedrock_converse') return 'Bedrock Converse';
    return 'Hermes Auto';
  }
  function protocolKey(provider, model) { return `${String(provider || '').trim()}\n${String(model || '').trim()}`; }
  function protocolStatusLabel(route) {
    if (!route) return 'Hermes 未声明';
    if (route.status === 'declared') return `Hermes 官方声明 · ${apiModeLabel(route.mode)}`;
    if (route.status === 'resolved') return `已真实探测 · ${apiModeLabel(route.mode)}`;
    if (route.status === 'manual') return `已选择 · ${apiModeLabel(route.mode)}`;
    if (route.status === 'ambiguous') return '两种协议都可用 · 请选择';
    if (route.status === 'unresolved') return '未探测 · 不会默认误判';
    if (route.status === 'native') return route.mode ? `Hermes 原生 · ${apiModeLabel(route.mode)}` : 'Hermes 原生运行时';
    return '协议状态不可用';
  }
  function protocolStatusTone(route) {
    if (route?.status === 'declared' || route?.status === 'resolved' || route?.status === 'manual' || route?.status === 'native') return 'good';
    if (route?.status === 'ambiguous') return 'neutral';
    return 'bad';
  }
  function providerConfigEntry(config, provider) {
    const entries = config?.providers;
    if (!entries || typeof entries !== 'object') return null;
    return entries[provider] || null;
  }
  function providerApiMode(config, provider) {
    const entry = providerConfigEntry(config, provider);
    const mainMode = config?.model?.provider === provider ? config?.model?.api_mode || config?.model?.transport : '';
    return canonicalApiMode(entry?.api_mode || entry?.transport || mainMode || '');
  }
  function withProviderApiMode(rawConfig, provider, value) {
    const next = clone(rawConfig);
    const mode = canonicalApiMode(value);
    next.providers = { ...(next.providers || {}) };
    const entry = { ...(next.providers[provider] || {}) };
    if (mode) {
      entry.api_mode = mode;
      delete entry.transport;
    } else {
      delete entry.api_mode;
      delete entry.transport;
    }
    next.providers[provider] = entry;
    if (next.model && typeof next.model === 'object' && next.model.provider === provider) {
      next.model = { ...next.model };
      if (mode) {
        next.model.api_mode = mode;
        delete next.model.transport;
      } else {
        delete next.model.api_mode;
        delete next.model.transport;
      }
    }
    return next;
  }

  function titleFromPrompt(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 42) || '新对话';
    return clean;
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
    return h('span', { className: `hws3-mark ${compact ? 'compact' : ''}` }, h('img', { src: projectMarkHref(), alt: '', loading: 'eager' }));
  }

  function ReturnToStudioSlot() {
    const path = String(window.location.pathname || '');
    if (path === '/' || path.endsWith('/worker-studio')) return null;
    return h('a', { className: 'hws3-return-slot', href: baseHref('/'), onClick: clearAdvancedNavigation, title: '返回 Hermes Worker Studio' }, '← Worker Studio');
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
          h('strong', null, isMoaSession(session) ? `◈ ${shortText(sessionTitle(session), 48)}` : shortText(sessionTitle(session), 52)),
          h('small', null, [moaSessionLabel(session), session?.model, fmtTime(session?.last_active || session?.started_at)].filter(Boolean).join(' · ')),
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

  function messageText(msg) {
    const raw = typeof msg?.display_content === 'string' ? msg.display_content : msg?.content;
    return typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p) => p?.text || p?.content || '').filter(Boolean).join('\n') : JSON.stringify(raw ?? '', null, 2);
  }
  function escapeRegExp(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function highlightText(value, query) {
    const text = String(value ?? '');
    const needle = String(query || '').trim();
    if (!needle || !text) return text;
    const pattern = new RegExp(`(${escapeRegExp(needle)})`, 'ig');
    const foldedNeedle = needle.toLowerCase();
    return text.split(pattern).map((part, index) => part && part.toLowerCase() === foldedNeedle
      ? h('mark', { key: `match-${index}`, 'data-search-match': 'true' }, part)
      : part);
  }
  function messageMatchesQuery(msg, query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return false;
    const haystack = messageText(msg).toLowerCase();
    if (haystack.includes(needle)) return true;
    const terms = needle.split(/\s+/).filter(Boolean);
    return terms.length > 1 && terms.every((term) => haystack.includes(term));
  }

  function transcriptRows(messages) {
    const seenSystemSync = new Set();
    return (messages || []).filter((msg) => {
      const content = messageText(msg);
      if (msg?.role !== 'user' || !/^\s*\[system:/i.test(content)) return true;
      const key = content.trim();
      if (seenSystemSync.has(key)) return false;
      seenSystemSync.add(key);
      return true;
    });
  }

  function MessageBubble({ msg, searchQuery = '' }) {
    const role = msg?.role || 'system';
    if (msg?.display_kind === 'hidden') return null;
    if (role === 'tool') return h('div', { className: 'hws3-tool-row' }, h('details', { className: 'hws3-tool-card' }, h('summary', null, `工具结果${msg?.tool_name ? ` · ${msg.tool_name}` : ''}`), h('pre', null, highlightText(typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg?.content, null, 2), searchQuery))));
    const content = messageText(msg);
    const systemSync = role === 'user' && /^\s*\[system:/i.test(content);
    const commandMessage = msg?.display_kind === 'command';
    const commandResult = msg?.display_kind === 'command-result';
    const visualRole = systemSync ? 'system' : role;
    const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    const meta = systemSync ? 'Hermes · 系统同步' : commandMessage ? 'Hermes · 官方命令' : commandResult ? 'Hermes · 命令结果' : visualRole === 'user' ? '' : visualRole === 'assistant' ? 'Hermes' : visualRole;
    return h('article', { className: `hws3-message ${visualRole}${systemSync ? ' system-sync' : ''}${commandMessage ? ' command' : ''}${commandResult ? ' command-result' : ''}` },
      h('div', { className: 'hws3-message-avatar' }, commandMessage ? '⌘' : visualRole === 'user' ? '你' : visualRole === 'assistant' ? h(HermesMark, { compact: true }) : '•'),
      h('div', { className: 'hws3-message-main' },
        meta ? h('div', { className: 'hws3-message-meta' }, meta) : null,
        content ? h('div', { className: 'hws3-message-content' }, highlightText(content, searchQuery)) : null,
        calls.length ? h('details', { className: 'hws3-tool-card' }, h('summary', null, `工具调用 ${calls.length} 项`), calls.map((call, i) => h('div', { className: 'hws3-tool-call', key: call?.id || i }, h('strong', null, call?.function?.name || call?.name || 'tool'), h('pre', null, call?.function?.arguments || call?.arguments || '')))) : null,
      ),
    );
  }

  function ToolActivityGroup({ rows, searchQuery = '', compact = false }) {
    const calls = rows.flatMap((msg) => Array.isArray(msg?.tool_calls) ? msg.tool_calls : []);
    const results = rows.filter((msg) => msg?.role === 'tool');
    const toolNames = [...new Set([
      ...calls.map((call) => call?.function?.name || call?.name || 'tool'),
      ...results.map((msg) => msg?.tool_name || msg?.name || 'tool'),
    ].map((name) => String(name).trim()).filter(Boolean))];
    const complete = calls.length > 0 ? results.length >= calls.length : results.length > 0;
    if (compact) {
      return h('section', { className: `hws3-tool-activity hws3-tool-activity-compact ${complete ? 'complete' : 'running'}`, 'data-tool-activity': 'summary', 'data-tool-detail-source': 'work-timeline' },
        h('div', { className: 'hws3-tool-compact-row' },
          h('span', { className: 'hws3-tool-compact-state', 'aria-hidden': 'true' }, complete ? '✓' : h(Spinner)),
          h('div', null,
            h('strong', null, `工具 · ${toolNames.join(' · ') || 'Hermes 工具'}`),
            h('small', null, `${complete ? '已完成' : '进行中'} · ${calls.length} 次调用 · ${results.length} 个结果 · 官方详情在下方工作过程中`),
          ),
        ),
      );
    }
    const activity = [];
    rows.forEach((msg, rowIndex) => {
      if (msg?.role === 'assistant' && Array.isArray(msg?.tool_calls)) {
        msg.tool_calls.forEach((call, callIndex) => activity.push(h('details', { className: 'hws3-tool-card', key: `call-${call?.id || `${rowIndex}-${callIndex}`}` },
          h('summary', null, `工具调用 · ${call?.function?.name || call?.name || 'tool'}`),
          h('pre', null, call?.function?.arguments || call?.arguments || ''),
        )));
      } else if (msg?.role === 'tool') {
        activity.push(h('details', { className: 'hws3-tool-card', key: `result-${msg?.id || rowIndex}` },
          h('summary', null, `工具结果${msg?.tool_name ? ` · ${msg.tool_name}` : ''}`),
          h('pre', null, highlightText(typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg?.content, null, 2), searchQuery)),
        ));
      } else if (msg?.role === 'assistant' && messageText(msg)) {
        activity.push(h('div', { className: 'hws3-tool-activity-note', key: `note-${msg?.id || rowIndex}` }, h('span', null, 'Hermes'), h('p', null, highlightText(messageText(msg), searchQuery))));
      }
    });
    return h('section', { className: 'hws3-tool-activity' },
      h('header', null, h('strong', null, 'Hermes · 工具过程'), h('small', null, `${calls.length} 次调用 · ${results.length} 个结果`)),
      activity,
    );
  }

  function ReasoningControl({ efforts, value, onChange, disabled }) {
    if (efforts.length <= 1) return h(Pill, null, '思考 Auto');
    const index = Math.max(0, efforts.findIndex((item) => item.value === value));
    const current = efforts[index] || efforts[0];
    return h('label', { className: 'hws3-reasoning-control', title: current.description || '仅使用 Hermes 上游声明的推理强度' },
      h('span', null, '思考'),
      h('input', { type: 'range', min: 0, max: efforts.length - 1, step: 1, value: index, disabled, 'aria-label': '思考强度', onChange: (e) => onChange(efforts[Number(e.target.value)]?.value || 'auto') }),
      h('b', null, current.value === 'auto' ? 'Auto' : current.value),
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
      h(ReasoningControl, { efforts, value: normalized.effort, disabled, onChange: (effort) => onChange({ ...normalized, effort }) }),
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
    const label = compacting ? `◔ ${summary} · Compact` : flash ? `✓ ${summary}` : summary;
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
    const rawStatus = String(run.status || '').toLowerCase();
    // A projection written by an older refresh race can briefly retain the
    // later `incomplete` reconciliation after an earlier official
    // `completed` reconciliation.  Render the durable positive evidence as
    // completed while the normalization pass removes the stale event.
    const recoveredComplete = hasCompletedReconciliation(run) && !['failed', 'interrupted', 'stopped', 'cancelled', 'canceled'].includes(rawStatus);
    const displayStatus = recoveredComplete ? 'completed' : run.status;
    const done = TERMINAL_RUN_STATES.has(String(displayStatus || '').toLowerCase());
    const started = Number(run.started_at || 0) * 1000;
    const ended = run.ended_at ? Number(run.ended_at) * 1000 : null;
    const duration = run.elapsed_ms != null ? run.elapsed_ms : Math.max(0, (ended || now) - started);
    const durationUnknown = String(run.elapsed_source || '') === 'hermes.gateway.resume.reconciliation.observed_idle';
    const terminalLabel = displayStatus === 'completed'
      ? '工作已完成'
      : displayStatus === 'incomplete'
        ? '工作未完成'
        : displayStatus === 'interrupted' || displayStatus === 'stopped'
          ? '工作已停止'
          : `工作结束 · ${displayStatus}`;
    const reconciledComplete = recoveredComplete;
    const events = (run.events || []).filter((e) => !(reconciledComplete
      && e?.event === 'run.reconciled'
      && e?.data?.source === 'hermes.gateway.session.resume_reconciliation'
      && e?.data?.status === 'incomplete') && !['assistant.delta', 'message.delta'].includes(e.event) && !String(e.event || '').includes('todo') && !String(e.event || '').startsWith('context.') && !['reasoning.available', 'reasoning.delta', 'thinking.delta'].includes(String(e.event || '')));
    const reasoningEvents = (run.events || []).filter((e) => ['reasoning.available', 'reasoning.delta', 'thinking.delta'].includes(String(e.event || '')));
    const reasoningText = reasoningEvents.map((event) => deltaText(event.data)).filter(Boolean).join('');
    return h('section', { className: `hws3-work ${done ? 'done' : 'running'}` },
      h('button', { className: 'hws3-work-head', onClick: () => setExpanded(!expanded) },
        h('span', { className: 'hws3-work-state' }, done ? (run.status === 'completed' ? '✓' : '!') : h(Spinner)),
        h('strong', null, done ? terminalLabel : '工作进行中'),
        h('span', null, durationUnknown ? '官方未提供时长' : fmtDuration(duration)),
        h('span', null, `${events.length} 项`),
        h('small', { className: 'hws3-work-source' }, run.elapsed_source === 'hermes.gateway.message.complete.duration_s' ? 'Hermes duration_s' : 'Hermes lifecycle'),
        h('span', null, expanded ? '⌃' : '⌄'),
      ),
      expanded ? h('div', { className: 'hws3-work-body' },
        events.length ? events.map((event) => h('div', { className: 'hws3-work-event', key: event.seq },
          h('span', { className: 'hws3-event-dot' }),
          h('div', null, h('strong', null, eventSummary(event)), eventDetail(event) ? h('small', null, eventDetail(event)) : null,
            approvalChoices(event).length ? h('div', { className: 'hws3-approval-actions' }, approvalChoices(event).map((choice) => h(Button, { key: choice, className: choice === 'deny' ? 'danger small' : 'ghost small', onClick: () => onApprove?.(choice) }, choice === 'once' ? '允许一次' : choice === 'session' ? '本会话允许' : choice === 'always' ? '始终允许' : '拒绝'))) : null),
          h('time', null, fmtTime(event.at)),
        )) : h('p', { className: 'hws3-muted' }, '等待 Hermes lifecycle 事件…'),
        reasoningEvents.length ? h('details', { className: 'hws3-reasoning-panel' }, h('summary', null, `Hermes reasoning · ${reasoningEvents.length} 个上游事件`), reasoningText ? h('pre', null, reasoningText) : h('p', { className: 'hws3-muted' }, '上游只发送了 reasoning 事件元数据，未提供可展示文本。')) : null,
        skillDiff && (skillDiff.added.length || skillDiff.removed.length || skillDiff.toggled.length) ? h('details', { className: 'hws3-skill-diff' }, h('summary', null, 'Hermes Skills 变化'), skillDiff.added.length ? h('p', null, `新增：${skillDiff.added.join(' · ')}`) : null, skillDiff.removed.length ? h('p', null, `移除：${skillDiff.removed.join(' · ')}`) : null, skillDiff.toggled.length ? h('p', null, `启停变化：${skillDiff.toggled.join(' · ')}`) : null) : null,
      ) : null,
    );
  }

  function AttachmentChip({ item, onRemove }) {
    return h('div', { className: 'hws3-attachment-chip' }, h('img', { src: item.dataUrl, alt: item.name }), h('div', null, h('strong', null, shortText(item.name, 24)), h('small', null, `${Math.max(1, Math.round(item.size / 1024))} KB`)), h('button', { onClick: onRemove, title: '移除' }, '×'));
  }

  function Conversation(props) {
    const {
      session, messages, loading, run, turnRuns = [], streamText, draft, setDraft, onSend, sending, commandBusy = false,
      modelOptions, chatRoute, setChatRoute, contextSnapshot, now, onStop, onSteer, onApprove, skillDiff,
      timelineExpanded, setTimelineExpanded, attachments, setAttachments, onRename, onArchive, onDelete,
      slashItems, slashIndex, setSlashIndex, onSlashSelect,
    } = props;
    const transcriptRef = useRef(null);
    const fileRef = useRef(null);
    const textareaRef = useRef(null);
    const [autoScroll, setAutoScroll] = useState(() => readLocal('hws3_auto_scroll', true));
    const [following, setFollowing] = useState(true);
    const [dragging, setDragging] = useState(false);
    const [expandedTurns, setExpandedTurns] = useState({});
    const followIntentRef = useRef(true);
    const transcriptVersionRef = useRef('');
    const pendingAutoFollowRef = useRef(false);
    const visibleMessages = transcriptRows(messages);

    const scrollToBottom = useCallback((behavior = 'smooth') => {
      const el = transcriptRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setFollowing(true);
    }, []);

    useEffect(() => { writeLocal('hws3_auto_scroll', autoScroll); }, [autoScroll]);
    const transcriptVersion = `${session?.id || 'new'}:${visibleMessages.length}:${streamText ? streamText.length : 0}:${run?.last_seq || ''}:${turnRuns.length}`;
    if (transcriptVersionRef.current !== transcriptVersion) {
      transcriptVersionRef.current = transcriptVersion;
      pendingAutoFollowRef.current = followIntentRef.current;
    }
    useEffect(() => {
      if (!autoScroll) { pendingAutoFollowRef.current = false; return undefined; }
      if (!pendingAutoFollowRef.current) return undefined;
      const frame = requestAnimationFrame(() => {
        pendingAutoFollowRef.current = false;
        scrollToBottom('auto');
      });
      return () => cancelAnimationFrame(frame);
    }, [transcriptVersion, autoScroll, scrollToBottom]);
    useEffect(() => { followIntentRef.current = true; pendingAutoFollowRef.current = true; setFollowing(true); }, [session?.id]);
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

    const showSlash = draft.trimStart().startsWith('/') && slashItems.length > 0 && !sending && !commandBusy;
    const runInMessages = Boolean(run && TERMINAL_RUN_STATES.has(String(run.status || '').toLowerCase()) && (messages || []).some((msg) => msg?.role === 'assistant'));
    const turnMapping = mapTurnRunsToMessages(turnRuns, messages);
    const fallbackProjectedRun = !run
      ? [...turnRuns].reverse().find((turn) => projectedTurnIsActive(turn) && !turnMapping.mappedRuns.has(String(turn?.id || '')))
      : null;
    useEffect(() => {
      if (!session?.id || !turnMapping.updates.length) return undefined;
      const updates = new Map(turnMapping.updates.map((update) => [String(update.id), update]));
      const enriched = (turnRuns || []).map((turn) => {
        const update = updates.get(String(turn?.id || ''));
        return update ? { ...turn, ...update } : turn;
      });
      plugin(`/hermes/sessions/${encodeURIComponent(session.id)}/projection`, jinit('PUT', { turns: enriched.slice(-50) })).catch(() => {});
      return undefined;
    }, [session?.id, messages, turnRuns]);
    return h('section', { className: 'hws3-conversation' },
      h('header', { className: 'hws3-chat-head' },
        h('div', { className: 'hws3-chat-title' }, h('h2', null, session ? sessionTitle(session) : '新对话'), session ? h('small', null, session.id) : h('small', null, '发送第一条消息时创建 Hermes Session')),
        session && isMoaSession(session) ? h(Pill, { tone: 'good' }, `MOA · ${session?.preset || session?.model || 'Mixture of Agents'}`) : null,
        modelOptions ? h(CompactRouteSelector, { options: modelOptions, route: chatRoute, onChange: setChatRoute, disabled: sending || commandBusy }) : null,
        commandBusy ? h(Pill, { tone: 'neutral' }, 'Hermes 命令执行中') : null,
        modelOptions ? h(ContextMeter, { run, snapshot: contextSnapshot, options: modelOptions, route: chatRoute }) : null,
        h('div', { className: 'hws3-chat-actions' },
          session ? h('button', { title: '重命名', onClick: onRename }, '✎') : null,
          session ? h('button', { title: session.archived ? '取消归档' : '归档', onClick: onArchive }, session.archived ? '↥' : '⌑') : null,
          session ? h('button', { className: 'danger', title: '删除', onClick: onDelete }, '⌫') : null,
        ),
      ),
        h('div', { className: 'hws3-transcript', ref: transcriptRef, onScroll: (e) => { const el = e.currentTarget; const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80; followIntentRef.current = near; setFollowing(near); } },
        loading ? h('div', { className: 'hws3-loading' }, h(Spinner), ' 正在读取消息…') : null,
        !loading && !(messages || []).length && !run ? h('div', { className: 'hws3-welcome' }, h(HermesMark), h('h1', null, '今天想让 Hermes 做什么？'), h('p', null, '原生 Runs · 原生 Worker · 原生 Skills · 原生审批')) : null,
        visibleMessages.flatMap((msg, i, rows) => {
          if (msg?.role === 'tool') {
            let previous = i - 1;
            while (previous >= 0 && rows[previous]?.role === 'tool') previous -= 1;
            if (previous >= 0 && rows[previous]?.role === 'assistant' && Array.isArray(rows[previous]?.tool_calls) && rows[previous].tool_calls.length) return [];
          }
          if (msg?.role === 'assistant' && Array.isArray(msg?.tool_calls) && msg.tool_calls.length) {
            let end = i + 1;
            while (end < rows.length && (rows[end]?.role === 'tool' || (rows[end]?.role === 'assistant' && Array.isArray(rows[end]?.tool_calls) && rows[end].tool_calls.length))) end += 1;
            // Hermes messages remain authoritative, but the detailed command
            // and result are already represented by the same Run lifecycle
            // below. Keep only a compact acknowledgement here so one official
            // tool event is not presented twice in the conversation.
            return [h(ToolActivityGroup, { rows: rows.slice(i, end), compact: true, key: `tools-${msg?.id || i}` })];
          }
          const nodes = [h(MessageBubble, { msg, key: msg?.id || `${msg?.role}-${i}` })];
          if (msg?.role === 'assistant') {
            const turn = turnMapping.byMessageId.get(String(msg?.id || ''));
            if (turn) {
              nodes.push(h(PlanCard, { run: turn, key: `plan-${turn.id}` }));
              nodes.push(h(WorkTimeline, { run: turn, expanded: expandedTurns[turn.id] === true, setExpanded: (value) => setExpandedTurns((old) => ({ ...old, [turn.id]: value })), now, skillDiff: null, key: `turn-${turn.id}` , onApprove }));
            }
          }
          return nodes;
        }),
        run && !runInMessages ? h(PlanCard, { run }) : null,
        run && !runInMessages ? h(WorkTimeline, { run, expanded: timelineExpanded, setExpanded: setTimelineExpanded, now, skillDiff, onApprove }) : null,
        run?.error ? h('article', { className: 'hws3-message assistant error' }, h('div', { className: 'hws3-message-avatar' }, '!'), h('div', { className: 'hws3-message-main' }, h('div', { className: 'hws3-message-meta' }, 'Hermes · 请求失败'), h('div', { className: 'hws3-message-content' }, run.error))) : null,
        run?.output && !(messages || []).some((msg) => msg?.role === 'assistant') ? h('article', { className: 'hws3-message assistant final' }, h('div', { className: 'hws3-message-avatar' }, h(HermesMark, { compact: true })), h('div', { className: 'hws3-message-main' }, h('div', { className: 'hws3-message-meta' }, 'Hermes'), h('div', { className: 'hws3-message-content' }, run.output))) : null,
        fallbackProjectedRun ? h(PlanCard, { run: fallbackProjectedRun }) : null,
        fallbackProjectedRun ? h(WorkTimeline, { run: fallbackProjectedRun, expanded: timelineExpanded, setExpanded: setTimelineExpanded, now, skillDiff, onApprove }) : null,
        streamText && run && !TERMINAL_RUN_STATES.has(run.status) ? h('article', { className: 'hws3-message assistant live' }, h('div', { className: 'hws3-message-avatar' }, h(HermesMark, { compact: true })), h('div', { className: 'hws3-message-main' }, h('div', { className: 'hws3-message-meta' }, 'Hermes · 实时'), h('div', { className: 'hws3-message-content' }, streamText))) : null,
      ),
      (!following || !autoScroll) ? h('div', { className: 'hws3-scroll-tools' }, h('label', null, h('input', { type: 'checkbox', checked: autoScroll, onChange: (e) => setAutoScroll(e.target.checked) }), ' 自动滚动'), h(Button, { className: 'ghost small', onClick: () => scrollToBottom('smooth') }, '↓ 回到底部')) : null,
      h('div', { className: `hws3-composer-zone ${dragging ? 'dragging' : ''}`, onDragOver: (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); setDragging(true); } }, onDragLeave: () => setDragging(false), onDrop },
        attachments.length ? h('div', { className: 'hws3-attachments' }, attachments.map((item) => h(AttachmentChip, { key: item.id, item, onRemove: () => setAttachments((xs) => xs.filter((x) => x.id !== item.id)) }))) : null,
        h('form', { className: 'hws3-composer', onSubmit: (e) => { e.preventDefault(); onSend(); } },
          h('button', { type: 'button', className: 'hws3-plus', title: '添加图片', onClick: () => fileRef.current?.click() }, '+'),
          h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', multiple: true, hidden: true, onChange: async (e) => { try { await filesToAttachments(e.target.files || []); } catch (err) { alert(errorText(err)); } finally { e.target.value = ''; } } }),
          h('textarea', { ref: textareaRef, value: draft, disabled: commandBusy, onChange: (e) => { setDraft(e.target.value); setSlashIndex(0); }, onPaste, rows: 1, placeholder: commandBusy ? '正在执行 Hermes 官方命令…' : sending ? '输入并发送以调整正在运行的 Hermes…' : '给 Hermes 发送消息…', onKeyDown: (e) => {
            if (showSlash && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setSlashIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % slashItems.length); return; }
            if (showSlash && e.key === 'Tab') { e.preventDefault(); const token = slashCommandText(slashItems[slashIndex]); if (token) setDraft(`${token} `); setSlashIndex(0); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); onSend(); }
          } }),
          commandBusy ? h('button', { type: 'button', className: 'hws3-stop', disabled: true, title: '正在执行 Hermes 官方命令' }, h(Spinner)) : sending ? h('button', { type: 'button', className: 'hws3-stop', title: '停止 Run', onClick: onStop }, '■') : h('button', { type: 'submit', className: 'hws3-send', disabled: !draft.trim() && !attachments.length, title: '发送' }, '↑'),
        ),
        showSlash ? h('div', { className: 'hws3-slash-menu', role: 'listbox', 'aria-label': 'Hermes 官方斜杠命令' }, slashItems.map((item, i) => h('button', { key: item.text || i, className: i === slashIndex ? 'active' : '', onMouseDown: (e) => { e.preventDefault(); }, onClick: (e) => { e.preventDefault(); e.stopPropagation(); onSlashSelect(item); }, role: 'option', 'aria-selected': i === slashIndex }, h('strong', null, item.display || item.text), h('small', null, slashDescription(item))))) : null,
        h('div', { className: 'hws3-composer-hint' }, h('span', null, 'Enter 发送 · Shift+Enter 换行 · Ctrl/Cmd+V 粘贴文件'), sending ? h('span', null, '运行中再次发送 = 调整方向') : null),
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
    const EMPTY = { id: '', name: '', base_url: '', api_key: '', model: '', context_length: '', api_mode: '', discover_models: true, make_default: false };
    const [form, setForm] = useState(EMPTY);
    const [endpoints, setEndpoints] = useState([]);
    const [discovered, setDiscovered] = useState([]);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [query, setQuery] = useState('');
    const [tests, setTests] = useState({});
    const [bulkTest, setBulkTest] = useState(null);
    const [config, setConfig] = useState({});
    const [protocolState, setProtocolState] = useState({ loading: true, routes: [], error: '' });

    const refreshEndpoints = useCallback(async () => {
      try { const data = await api('/api/providers/custom-endpoints'); setEndpoints(data.endpoints || []); return data.endpoints || []; }
      catch (err) { setMessage(errorText(err)); return []; }
    }, []);
    const refreshConfig = useCallback(async () => { try { const cfg = unwrapConfig(await api('/api/config')); setConfig(cfg); return cfg; } catch (_) { return {}; } }, []);
    const refreshProtocols = useCallback(async () => {
      setProtocolState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const data = await plugin('/hermes/protocols');
        setProtocolState({ loading: false, routes: Array.isArray(data?.routes) ? data.routes : [], error: '' });
        return data;
      } catch (err) {
        // Older installed bridges do not expose this optional projection;
        // the official model catalog remains usable and the row stays
        // explicitly "Hermes 未声明" instead of inventing a protocol.
        setProtocolState({ loading: false, routes: [], error: errorText(err) });
        return null;
      }
    }, []);
    useEffect(() => { refreshEndpoints(); refreshConfig(); refreshProtocols(); }, [refreshEndpoints, refreshConfig, refreshProtocols]);

    function editEndpoint(endpoint) {
      setForm({ id: endpoint.id || '', name: endpoint.name || '', base_url: endpoint.base_url || '', api_key: '', model: endpoint.model || '', context_length: endpoint.context_length ? String(endpoint.context_length) : '', api_mode: '', discover_models: endpoint.discover_models !== false, make_default: Boolean(endpoint.is_current) });
      setDiscovered(endpoint.models || []); setMessage('');
    }
    function updateBaseUrl(value) {
      setForm((x) => {
        return { ...x, base_url: value };
      });
    }
    async function validate() {
      setBusy('validate'); setMessage('');
      try {
        const payload = { id: form.id || undefined, name: form.name.trim() || 'Custom Endpoint', base_url: normalizeEndpointUrl(form.base_url), api_key: form.api_key || undefined, model: form.model.trim(), discover_models: form.discover_models, make_default: form.make_default };
        const result = await api('/api/providers/custom-endpoints/validate', jinit('POST', payload));
        const models = Array.isArray(result?.models) ? result.models : [];
        setDiscovered(models); if (!form.model && models[0]) setForm((x) => ({ ...x, model: models[0] }));
        setMessage(result?.ok === false ? result?.message || '验证失败' : `连接成功${models.length ? ` · 发现 ${models.length} 个模型` : ''} · ${apiModeLabel(form.api_mode)}`);
      } catch (err) { setMessage(errorText(err)); } finally { setBusy(''); }
    }
    async function save() {
      if (!form.name.trim() || !form.base_url.trim() || !form.model.trim()) { setMessage('Name、Base URL、Model 为必填。'); return; }
      setBusy('save'); setMessage('');
      try {
        const n = Number.parseInt(form.context_length, 10);
        const payload = { id: form.id || undefined, name: form.name.trim(), base_url: normalizeEndpointUrl(form.base_url), api_key: form.api_key || undefined, model: form.model.trim(), context_length: Number.isFinite(n) && n > 0 ? n : undefined, discover_models: form.discover_models, make_default: form.make_default, models: discovered.length ? discovered : undefined };
        const saved = await api('/api/providers/custom-endpoints', jinit('POST', payload));
        const provider = String(saved?.id || form.id || form.name).trim();
        if (provider) {
          const cfg = await api('/api/config');
          // Hermes owns provider configuration. No provider-global protocol
          // selector is written here; protocol capabilities are read per
          // model from official inventory when Hermes exposes them.
        }
        await refreshEndpoints(); await refreshOptions(true); await refreshConfig(); setForm(EMPTY); setDiscovered([]); setMessage('已保存到 Hermes Custom Endpoint；协议由 Hermes 按当前模型能力决定。');
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
      try { await api(`/api/providers/custom-endpoints/${encodeURIComponent(endpoint.id)}/activate`, jinit('POST', {})); await refreshEndpoints(); await refreshOptions(true); await refreshConfig(); setMessage(`已切换到 ${endpoint.name}`); }
      catch (err) { setMessage(errorText(err)); } finally { setBusy(''); }
    }
    async function testModel(provider, model, { refresh = true } = {}) {
      const key = `${provider}:${model}`; setTests((x) => ({ ...x, [key]: { loading: true } }));
      try {
        const known = protocolState.routes.find((route) => route.provider === provider && route.model === model);
        let executionProvider = provider;
        if (known && !['unresolved', 'ambiguous'].includes(known.status)) {
          // Refresh the official execution projection immediately before a
          // real model Run. This recreates a managed Responses/Chat alias if
          // the operator removed it from Hermes' config since the last page
          // refresh, while keeping the source provider/model visible here.
          const query = new URLSearchParams({ provider, model });
          try {
            const resolved = await plugin(`/hermes/protocol-route?${query.toString()}`);
            executionProvider = resolved?.execution_provider || provider;
          } catch (error) {
            // Old installed bridges have no projection route; their official
            // model probe remains a valid compatibility path. Never hide a
            // real protocol conflict or authorization failure.
            if (!/Unhandled fetchJSON call|404|Not Found/i.test(errorText(error))) throw error;
          }
        }
        const result = known && ['unresolved', 'ambiguous'].includes(known.status)
          ? await plugin('/hermes/protocols/probe', jinit('POST', { provider, model }))
          : await plugin('/hermes/model-probe', jinit('POST', { provider: executionProvider, model }));
        if (provider === 'moa' && !result?.ok) result.error = `${errorText(result.error || result.message)} · MOA 是 Hermes 官方聚合执行模式，需要先配置每个 reference 与 aggregator provider。`;
        setTests((x) => ({ ...x, [key]: result }));
        if (refresh && known && ['unresolved', 'ambiguous'].includes(known.status)) await refreshProtocols();
        return result;
      }
      catch (err) {
        const failure = { ok: false, error: provider === 'moa' ? `${errorText(err)} · MOA 是 Hermes 官方聚合执行模式，需要先配置每个 reference 与 aggregator provider。` : errorText(err) };
        setTests((x) => ({ ...x, [key]: failure }));
        return failure;
      }
    }
    async function selectProtocol(provider, model, mode) {
      const key = `${provider}:${model}`; setTests((x) => ({ ...x, [key]: { loading: true } }));
      try { await plugin('/hermes/protocols/select', jinit('POST', { provider, model, mode })); await refreshProtocols(); setTests((x) => ({ ...x, [key]: { ok: true, status: 'selected' } })); }
      catch (err) { setTests((x) => ({ ...x, [key]: { ok: false, error: errorText(err) } })); }
    }
    const needle = query.trim().toLowerCase();
    const rows = authenticatedProviders(modelOptions).filter((provider) => provider.slug !== 'moa' && !isManagedProtocolProvider(provider));
    const pendingProtocolTests = rows.flatMap((provider) => (provider.models || []).slice(0, 80).map((model) => ({
      provider: provider.slug,
      model,
      route: protocolState.routes.find((item) => item.provider === provider.slug && item.model === model),
    }))).filter((item) => item.route?.status === 'unresolved');
    async function testPendingModels() {
      if (bulkTest || !pendingProtocolTests.length) {
        if (!bulkTest && !pendingProtocolTests.length) setMessage('当前没有待测试的模型。');
        return;
      }
      const total = pendingProtocolTests.length;
      if (typeof window.confirm === 'function' && !window.confirm(`将按顺序测试 ${total} 个待确定模型；每个模型最多执行两次官方 Run，可能产生上游用量。继续？`)) return;
      setMessage('');
      setBulkTest({ done: 0, total, failures: 0, current: '' });
      let failures = 0;
      try {
        for (const target of pendingProtocolTests) {
          const key = `${target.provider}:${target.model}`;
          setBulkTest((state) => ({ ...(state || { done: 0, total, failures: 0 }), current: key }));
          const result = await testModel(target.provider, target.model, { refresh: false });
          if (result?.ok !== true && result?.route?.status !== 'resolved') failures += 1;
          setBulkTest((state) => ({ ...(state || { done: 0, total, failures: 0 }), done: (state?.done || 0) + 1, failures }));
        }
        await refreshProtocols();
        setMessage(failures ? `批量测试完成：${total - failures} 个通过，${failures} 个失败或仍未确定。` : `批量测试完成：${total} 个模型均已确定协议。`);
      } finally {
        setBulkTest(null);
      }
    }
    return h('section', { className: 'hws3-page' },
      h('header', { className: 'hws3-page-head' }, h('div', null, h('h2', null, '模型'), h('p', null, 'Hermes 官方模型目录；混合 New API 会按模型真实确认协议 · 探测 Run 结束后自动清理临时会话')), h('div', { className: 'hws3-page-head-actions' }, h(Button, { className: 'primary', disabled: Boolean(bulkTest) || !pendingProtocolTests.length, onClick: testPendingModels, title: pendingProtocolTests.length ? '按顺序对待确定模型执行官方协议探测' : '没有待确定模型' }, bulkTest ? `批量测试中 ${bulkTest.done}/${bulkTest.total}` : `一键测试待测模型${pendingProtocolTests.length ? `（${pendingProtocolTests.length}）` : ''}`), h(Button, { className: 'ghost', disabled: Boolean(bulkTest), onClick: () => { refreshOptions(true); refreshEndpoints(); refreshConfig(); refreshProtocols(); } }, '刷新'))),
      h('section', { className: 'hws3-card' }, h('header', null, h('div', null, h('small', null, 'CUSTOM ENDPOINTS'), h('h3', null, '已保存连接')), h(Pill, null, endpoints.filter((ep) => !String(ep.id || '').startsWith('hws-protocol-')).length)), endpoints.filter((ep) => !String(ep.id || '').startsWith('hws-protocol-')).length ? h('div', { className: 'hws3-endpoints' }, endpoints.filter((ep) => !String(ep.id || '').startsWith('hws-protocol-')).map((ep) => h('div', { className: 'hws3-endpoint', key: ep.id }, h('button', { className: 'main', onClick: () => editEndpoint(ep) }, h('strong', null, ep.name), h('small', null, ep.base_url), h('span', null, ep.model)), ep.is_current ? h(Pill, { tone: 'good' }, '当前') : h(Button, { className: 'ghost small', disabled: busy === `activate:${ep.id}`, onClick: () => activate(ep) }, '使用'), ep.source !== 'direct-config' ? h(Button, { className: 'danger small', disabled: busy === `delete:${ep.id}`, onClick: () => remove(ep) }, '删除') : null))) : h(Empty, { title: '暂无 Custom Endpoint', body: '可以添加 OpenAI-compatible endpoint。' })),
      h('section', { className: 'hws3-card' }, h('header', null, h('div', null, h('small', null, form.id ? 'EDIT' : 'NEW'), h('h3', null, form.id ? '编辑 Endpoint' : '新增 Endpoint'))),
        h('div', { className: 'hws3-form-grid' },
          h('label', null, 'Name', h('input', { value: form.name, onChange: (e) => setForm((x) => ({ ...x, name: e.target.value })), placeholder: 'My API' })),
          h('label', null, 'Provider ID（可选）', h('input', { value: form.id, onChange: (e) => setForm((x) => ({ ...x, id: e.target.value })), placeholder: '自动生成或自定义' })),
          h('label', { className: 'wide' }, 'Base URL', h('input', { value: form.base_url, onChange: (e) => updateBaseUrl(e.target.value), onBlur: () => setForm((x) => ({ ...x, base_url: normalizeEndpointUrl(x.base_url) })), placeholder: 'https://example.com/v1 · 粘贴 /responses 也会自动识别模式' })),
          h('label', null, 'Model', h('input', { value: form.model, list: 'hws3-models', onChange: (e) => setForm((x) => ({ ...x, model: e.target.value })), placeholder: '验证后自动发现' }), h('datalist', { id: 'hws3-models' }, discovered.map((m) => h('option', { key: m, value: m })))),
          h('label', null, 'Context（可选）', h('input', { value: form.context_length, inputMode: 'numeric', onChange: (e) => setForm((x) => ({ ...x, context_length: e.target.value })), placeholder: 'Auto' })),
          h('label', { className: 'wide' }, 'API Key', h('input', { type: 'password', autoComplete: 'off', value: form.api_key, onChange: (e) => setForm((x) => ({ ...x, api_key: e.target.value })), placeholder: form.id ? '留空保留现有 Key' : '可选' })),
        ),
        h('p', { className: 'hws3-field-hint' }, '协议只接受 Hermes 官方声明，或你点击“测试”后的真实 Run 结果；没有证据时显示“未探测”，不会把同一 provider 的所有模型误判成 Chat Completions 或 Responses。凭据只保留在 Hermes 服务端。'),
        h('div', { className: 'hws3-inline-options' }, h('label', null, h('input', { type: 'checkbox', checked: form.discover_models, onChange: (e) => setForm((x) => ({ ...x, discover_models: e.target.checked })) }), ' 自动发现模型'), h('label', null, h('input', { type: 'checkbox', checked: form.make_default, onChange: (e) => setForm((x) => ({ ...x, make_default: e.target.checked })) }), ' 用于新对话')),
        h('div', { className: 'hws3-actions' }, h(Button, { className: 'ghost', disabled: busy === 'validate' || !form.base_url.trim(), onClick: validate }, busy === 'validate' ? '测试中…' : '测试'), h(Button, { className: 'primary', disabled: busy === 'save', onClick: save }, busy === 'save' ? '保存中…' : '保存'), form.id ? h(Button, { className: 'ghost', onClick: () => { setForm(EMPTY); setDiscovered([]); } }, '新建') : null),
      ),
      message ? h('div', { className: 'hws3-result' }, message) : null,
      h('input', { className: 'hws3-search', value: query, onChange: (e) => setQuery(e.target.value), placeholder: '搜索 Provider / Model…' }),
      protocolState.error && !/Unhandled fetchJSON call|404|Not Found/i.test(protocolState.error) ? h('div', { className: 'hws3-result' }, 'Hermes 协议状态暂不可用；未做协议猜测。') : null,
      h('div', { className: 'hws3-model-catalog' }, rows.map((provider) => { const models = (provider.models || []).filter((m) => !needle || `${provider.name} ${provider.slug} ${m}`.toLowerCase().includes(needle)); if (!models.length) return null; return h('section', { className: 'hws3-card', key: provider.slug }, h('header', null, h('div', null, h('small', null, provider.slug), h('h3', null, provider.name || provider.slug)), h('div', { className: 'hws3-provider-badges' }, h(Pill, null, 'Hermes Auto'), provider.is_current ? h(Pill, { tone: 'good' }, '当前') : null)), models.slice(0, 80).map((model) => { const key = `${provider.slug}:${model}`; const test = tests[key]; const declaredMode = modelApiMode(modelOptions, provider.slug, model); const route = protocolState.routes.find((item) => item.provider === provider.slug && item.model === model) || (declaredMode ? { status: 'declared', mode: declaredMode } : null); const testOk = test?.ok === true || test?.route?.status === 'resolved'; const probeNeeded = route && ['unresolved', 'ambiguous'].includes(route.status); return h('div', { className: 'hws3-model-row', key: model }, h('div', null, h('strong', null, model), h('small', null, `协议：${protocolStatusLabel(route)} · 思考：${reasoningSummary(modelOptions, provider.slug, model)}`)), test?.loading ? h(Spinner) : test ? h('div', { className: 'hws3-model-result' }, h(Pill, { tone: testOk ? 'good' : route?.status === 'ambiguous' ? 'neutral' : 'bad' }, testOk ? 'Run 通过' : route?.status === 'ambiguous' ? '需选择协议' : '失败'), !testOk && (test.error || test.route?.error) ? h('small', null, shortText(test.error || test.route.error, 180)) : null) : null, h('div', { className: 'hws3-model-actions' }, h(Button, { className: 'ghost small', disabled: test?.loading, title: probeNeeded ? '使用 Hermes 官方真实 Run 确定该模型的协议' : '使用已经确定的协议执行真实 Run', onClick: () => testModel(provider.slug, model) }, '测试'), route?.status === 'ambiguous' ? h(Button, { className: 'ghost small', disabled: test?.loading, onClick: () => selectProtocol(provider.slug, model, 'chat_completions') }, '选 Chat') : null, route?.status === 'ambiguous' ? h(Button, { className: 'ghost small', disabled: test?.loading, onClick: () => selectProtocol(provider.slug, model, 'codex_responses') }, '选 Responses') : null)); })); })),
    );
  }

  function MoaPage({ modelOptions, refreshOptions, onUseMoa, onOpenSession }) {
    const [moaConfig, setMoaConfig] = useState(null);
    const [selectedPreset, setSelectedPreset] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [probe, setProbe] = useState(null);
    const [moaSessions, setMoaSessions] = useState({ loading: true, rows: [], error: '' });

    const refreshMoa = useCallback(async () => {
      setLoading(true);
      try {
        let data;
        try { data = await plugin('/hermes/moa-config'); }
        catch (_) { data = await api('/api/model/moa'); }
        setMoaConfig(data);
        setSelectedPreset((current) => current && data?.presets?.[current] ? current : data?.default_preset || Object.keys(data?.presets || {})[0] || 'default');
        setMessage('');
        return data;
      } catch (err) {
        setMessage(errorText(err));
        return null;
      } finally {
        setLoading(false);
      }
    }, []);
    useEffect(() => { refreshMoa(); }, [refreshMoa]);
    const refreshMoaSessions = useCallback(async () => {
      try {
        const data = await plugin('/hermes/moa-sessions');
        const rows = (data.sessions || []).filter(isMoaSession);
        setMoaSessions({ loading: false, rows, error: '' });
      } catch (err) { setMoaSessions({ loading: false, rows: [], error: errorText(err) }); }
    }, []);
    useEffect(() => { refreshMoaSessions(); }, [refreshMoaSessions]);

    async function refreshAll() {
      setBusy('refresh');
      setMessage('');
      try {
        await Promise.all([refreshOptions(true), refreshMoa(), refreshMoaSessions()]);
        setMessage('已从 Hermes 官方模型目录与 MoA 接口刷新');
      } catch (err) {
        setMessage(errorText(err));
      } finally {
        setBusy('');
      }
    }
    function presetName() {
      const presets = moaConfig?.presets && typeof moaConfig.presets === 'object' ? moaConfig.presets : {};
      return selectedPreset && presets[selectedPreset] ? selectedPreset : moaConfig?.default_preset || Object.keys(presets)[0] || 'default';
    }
    function preset() { return moaConfig?.presets?.[presetName()] || null; }
    function updatePreset(path, patch) {
      setMoaConfig((current) => {
        if (!current) return current;
        const next = clone(current);
        const name = presetName();
        next.presets = { ...(next.presets || {}) };
        next.presets[name] = { ...(next.presets[name] || {}) };
        let target = next.presets[name];
        for (let i = 0; i < path.length; i++) {
          const key = path[i];
          if (i === path.length - 1) {
            target[key] = { ...(target[key] || {}), ...patch };
          } else {
            target[key] = Array.isArray(target[key]) ? [...target[key]] : { ...(target[key] || {}) };
            target = target[key];
          }
        }
        return next;
      });
      setMessage('');
    }
    function updateReference(index, patch) { updatePreset(['reference_models', index], patch); }
    function updateAggregator(patch) { updatePreset(['aggregator'], patch); }
    async function saveMoa() {
      if (!moaConfig) return;
      setBusy('save');
      setMessage('');
      try {
        const body = { default_preset: moaConfig.default_preset || presetName(), active_preset: moaConfig.active_preset || '', presets: moaConfig.presets || {} };
        let saved;
        try { saved = await plugin('/hermes/moa-config', jinit('PUT', body)); }
        catch (_) { saved = await api('/api/model/moa', jinit('PUT', body)); }
        setMoaConfig(saved);
        await refreshOptions(true);
        setMessage('已通过 Hermes 官方 /api/model/moa 保存；凭据仍由 Hermes 管理。');
      } catch (err) {
        setMessage(errorText(err));
      } finally {
        setBusy('');
      }
    }
    async function probeMoa() {
      setBusy('probe');
      setProbe({ loading: true });
      setMessage('');
      try {
        const result = await plugin('/hermes/model-probe', jinit('POST', { provider: 'moa', model: presetName() }));
        setProbe(result);
        setMessage(result?.ok ? 'Hermes 官方 MoA 真实 Run 测试通过' : `${errorText(result?.error || result?.message)} · 请先配置该 preset 的 provider。`);
      } catch (err) {
        const result = { ok: false, error: errorText(err) };
        setProbe(result);
        setMessage(`${result.error} · 请先配置该 preset 的 provider。`);
      } finally {
        setBusy('');
      }
    }

    const currentPreset = preset();
    const referenceModels = Array.isArray(currentPreset?.reference_models) ? currentPreset.reference_models : [];
    const aggregator = currentPreset?.aggregator || {};
    const requiredSlots = [...referenceModels.filter((slot) => slot?.enabled !== false), aggregator].filter((slot) => slot?.provider && slot?.model);
    const inventoryRows = providerRows(modelOptions).filter((provider) => provider?.slug && provider.slug !== 'moa' && Array.isArray(provider.models) && provider.models.length);
    const requiredProviders = [...new Set(requiredSlots.map((slot) => String(slot.provider)))];
    const inventoryBySlug = new Map(inventoryRows.map((provider) => [provider.slug, provider]));
    const providerChoices = [...inventoryRows];
    for (const slug of requiredProviders) {
      if (!inventoryBySlug.has(slug)) providerChoices.push({ slug, name: slug, authenticated: false, models: [] });
    }
    const configuredProviders = new Set(providerRows(modelOptions).filter((provider) => provider?.slug !== 'moa' && provider?.authenticated === true).map((provider) => provider.slug));
    const missingProviders = requiredProviders.filter((provider) => !configuredProviders.has(provider));
    const hasValidSlots = referenceModels.some((slot) => slot?.enabled !== false && slot?.provider && slot?.model) && aggregator.provider && aggregator.model;
    const ready = Boolean(modelOptions && currentPreset && hasValidSlots && !missingProviders.length);
    const hasAnyConfiguredSlot = requiredSlots.length > 0;
    const readinessLabel = ready ? '可运行' : !hasAnyConfiguredSlot ? '待配置' : missingProviders.length ? '需要配置 Provider' : '需要补全模型';
    const presetNames = Object.keys(moaConfig?.presets || {});

    function renderSlot(slot, index, isAggregator = false) {
      const provider = String(slot?.provider || '');
      const model = String(slot?.model || '');
      const models = [...new Set([...modelsFor(modelOptions, provider), model].filter(Boolean))];
      const path = isAggregator ? null : index;
      const update = isAggregator ? updateAggregator : (patch) => updateReference(path, patch);
      return h('div', { className: `hws3-moa-slot ${isAggregator ? 'aggregator' : ''}`, key: isAggregator ? 'aggregator' : `reference-${index}` },
        h('div', { className: 'hws3-moa-slot-title' }, h('strong', null, isAggregator ? 'Aggregator' : `Reference ${index + 1}`), h(Pill, { tone: configuredProviders.has(provider) ? 'good' : 'neutral' }, configuredProviders.has(provider) ? '已配置' : '待配置')),
        h('div', { className: 'hws3-moa-slot-grid' },
          h('label', null, 'Provider', h('select', { value: provider, disabled: !providerChoices.length || !modelOptions, onChange: (e) => { const nextProvider = e.target.value; const nextModel = modelsFor(modelOptions, nextProvider)[0] || ''; update({ provider: nextProvider, model: nextModel }); } }, providerChoices.map((item) => h('option', { key: item.slug, value: item.slug }, `${item.name || item.slug} · ${item.slug}`)))),
          h('label', null, 'Model', h('select', { value: model, disabled: !models.length || !modelOptions, onChange: (e) => update({ model: e.target.value }) }, models.length ? models.map((value) => h('option', { key: value, value }, value)) : h('option', { value: '' }, model || '刷新官方模型目录'))),
        ),
        !isAggregator ? h('label', { className: 'hws3-moa-enabled' }, h('input', { type: 'checkbox', checked: slot?.enabled !== false, onChange: (e) => update({ enabled: e.target.checked }) }), '启用此 Reference') : h('small', null, 'Aggregator 负责把 Reference 分析汇总成最终回答。'),
        h('small', null, provider ? (configuredProviders.has(provider) ? '凭据状态来自 Hermes 官方 model inventory。' : 'Hermes 尚未报告该 provider 已配置；保存不写入凭据。') : '请选择 Provider 和 Model。'),
      );
    }

    return h('section', { className: 'hws3-page hws3-moa-page' },
      h('header', { className: 'hws3-page-head hws3-moa-page-head' },
        h('div', null, h('h2', null, 'MOA'), h('p', null, 'Hermes 原生 Mixture of Agents · 独立配置入口 · 官方模型目录同步')),
        h('div', { className: 'hws3-moa-page-actions' }, h(Pill, { tone: ready ? 'good' : 'neutral' }, readinessLabel), h(Button, { className: 'ghost', disabled: busy === 'refresh', onClick: refreshAll }, busy === 'refresh' ? '刷新中…' : '刷新模型列表')),
      ),
      h('section', { className: 'hws3-moa-flow hws3-card' },
        h('div', { className: 'hws3-moa-flow-node' }, h('b', null, '1'), h('strong', null, 'Reference'), h('small', null, '多个模型分别分析')),
        h('span', { className: 'hws3-moa-flow-arrow' }, '→'),
        h('div', { className: 'hws3-moa-flow-node aggregator' }, h('b', null, '2'), h('strong', null, 'Aggregator'), h('small', null, '汇总并生成最终回答')),
        h('span', { className: 'hws3-moa-flow-arrow' }, '→'),
        h('div', { className: 'hws3-moa-flow-node result' }, h('b', null, '3'), h('strong', null, 'Hermes Run'), h('small', null, '仍由 Hermes 官方执行')),
      ),
      h('section', { className: 'hws3-card hws3-moa-sessions' },
        h('header', null, h('div', null, h('small', null, 'OFFICIAL HERMES SESSIONS'), h('h3', null, 'MOA 会话'), h('p', null, '这里只显示 Hermes 官方会话记录中明确标记为 MOA 的会话。')), h(Pill, { tone: 'good' }, moaSessions.rows.length)),
        moaSessions.loading ? h('div', { className: 'hws3-loading' }, h(Spinner)) : moaSessions.error ? h(ErrorBar, { error: moaSessions.error }) : moaSessions.rows.length ? h('div', { className: 'hws3-moa-session-list' }, moaSessions.rows.map((row) => h('button', { className: 'hws3-moa-session-row', key: row.id || row.session_id, onClick: () => onOpenSession?.(row) }, h('span', null, '◈'), h('span', null, h('strong', null, sessionTitle(row)), h('small', null, `${moaSessionLabel(row)} · ${fmtTime(row.last_active || row.started_at)}`)), h('span', null, '›')))) : h(Empty, { title: '暂无 MOA 会话', body: '从 MOA 页面进入对话并发送后，这里会出现官方会话记录。' })
      ),
      h('section', { className: 'hws3-card hws3-moa-config-card' },
        h('header', { className: 'hws3-moa-section-head' }, h('div', null, h('small', null, 'OFFICIAL /api/model/moa'), h('h3', null, '选择参与模型'), h('p', null, '下拉选项直接来自 Hermes /api/model/options；你的 New API 模型与其他已配置模型会一起出现。')), h('div', { className: 'hws3-moa-preset-control' }, h('label', null, 'Preset', h('select', { value: presetName(), disabled: loading || !presetNames.length, onChange: (e) => { setSelectedPreset(e.target.value); setProbe(null); setMessage(''); } }, presetNames.length ? presetNames.map((name) => h('option', { key: name, value: name }, name)) : h('option', { value: 'default' }, 'default'))))),
        loading ? h('div', { className: 'hws3-loading' }, h(Spinner), ' 正在读取 Hermes 官方 MoA 配置…') : currentPreset ? h('div', { className: 'hws3-moa-editor' },
          h('div', { className: `hws3-moa-readiness ${ready ? 'good' : 'neutral'}` }, ready ? '配置可运行 · 所需 Provider 已由 Hermes 官方 inventory 标记为已配置' : missingProviders.length ? `需要配置 · Hermes 官方 inventory 尚未确认：${missingProviders.join('、')}` : '待配置 · 为 Reference 与 Aggregator 选择完整的 Provider/Model 后保存'),
          missingProviders.length ? h('p', { className: 'hws3-moa-note' }, '这里不会收集或写入 API Key；请先使用官方 hermes setup / provider 配置，再回到此页刷新。') : null,
          h('div', { className: 'hws3-moa-slots' }, referenceModels.map((slot, index) => renderSlot(slot, index)), renderSlot(aggregator, 0, true)),
          h('div', { className: 'hws3-actions hws3-moa-actions' }, h(Button, { className: 'primary', disabled: busy === 'save', onClick: saveMoa }, busy === 'save' ? '保存中…' : '保存官方 MoA 配置'), h(Button, { className: 'ghost', disabled: busy === 'probe', onClick: probeMoa }, busy === 'probe' ? '测试中…' : '真实 Run 测试'), h(Button, { className: 'ghost', disabled: !currentPreset || !onUseMoa, onClick: () => onUseMoa?.(presetName()) }, '进入对话使用此 MOA')),
          probe ? h('div', { className: `hws3-moa-probe ${probe.ok ? 'good' : 'bad'}` }, probe.loading ? '正在调用 Hermes 官方 model probe…' : probe.ok ? '真实 Run 测试通过' : shortText(probe.error || probe.message || '真实 Run 测试失败', 360)) : null,
        ) : h(Empty, { title: 'Hermes 没有返回 MoA 配置', body: '请先在 Hermes 官方配置中创建一个 MoA preset。' }),
        h('p', { className: 'hws3-moa-source-note' }, '模型列表只读 Hermes 官方 inventory；本页只通过官方 PUT /api/model/moa 保存 preset，不复制模型注册表、不实现第二套聚合器。'),
      ),
      message ? h('div', { className: 'hws3-result' }, message) : null,
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
      h('header', { className: 'hws3-page-head' }, h('div', null, h('h2', null, '完全访问'), h('p', null, '像 ChatGPT“完全访问”一样直接；底层仍是 Hermes 官方 approvals / delegation / input RPCs')), h(Pill, { tone: ready ? 'good' : 'neutral' }, ready ? '已开启' : '已关闭')),
      h('section', { className: `hws3-access-card ${ready ? 'on' : 'off'}` }, h('div', null, h('span', { className: 'hws3-access-icon' }, '⚡'), h('div', null, h('h3', null, ready ? 'Hermes 可无人值守执行' : 'Hermes 使用受控审批'), h('p', null, ready ? '审批自动放行；Clarify 等交互请求自动 Skip/Decline，不再等待人工；子代理自动批准。' : '危险操作按 Hermes 当前审批配置进行确认。'))), h('button', { className: `hws3-switch ${ready ? 'on' : ''}`, disabled: busy, onClick: () => ready ? disable() : enable(), 'aria-pressed': ready }, h('span'))),
      h('section', { className: 'hws3-card' }, h('h3', null, '永久边界'), h('p', null, '完全访问不会修改、绕过或弱化 Hermes Hardline Blocklist。缺少密码、MFA 或外部授权时会自动失败/继续可行路径，而不是无限等待用户。')),
      message ? h('div', { className: 'hws3-result' }, message) : null,
    );
  }

  function HistoryPage({ onOpenSession, onSessionMutation }) {
    const [kind, setKind] = useState('include');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [state, setState] = useState({ loading: true, rows: [], total: 0, error: '' });
    const [detail, setDetail] = useState(null);
    const [detailState, setDetailState] = useState({ loading: false, page: 1, rows: [], total: 0, error: '' });
    const [detailSearch, setDetailSearch] = useState('');
    const [detailHit, setDetailHit] = useState(null);
    const detailRequestRef = useRef(0);
    const detailHitRef = useRef(null);
    const load = useCallback(async () => {
      setState((s) => ({ ...s, loading: true, error: '' }));
      try {
        const value = q.trim();
        if (value) { const data = await api(`/api/sessions/search?q=${encodeURIComponent(value)}&limit=100`); setState({ loading: false, rows: data.results || [], total: (data.results || []).length, error: '' }); }
        else { const offset = (page - 1) * HISTORY_SESSION_LIMIT; const data = await api(`/api/sessions?limit=${HISTORY_SESSION_LIMIT}&offset=${offset}&order=recent&archived=${kind}`); setState({ loading: false, rows: data.sessions || [], total: Number(data.total || 0), error: '' }); }
      } catch (err) { setState({ loading: false, rows: [], total: 0, error: errorText(err) }); }
    }, [q, page, kind]);
    useEffect(() => { const t = setTimeout(load, q.trim() ? 180 : 0); return () => clearTimeout(t); }, [load]);
    const scrollToDetailHit = useCallback(() => {
      if (!detailHit || detailState.loading) return;
      requestAnimationFrame(() => detailHitRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }));
    }, [detailHit, detailState.loading]);
    useEffect(() => { scrollToDetailHit(); }, [scrollToDetailHit, detailState.rows, detailState.page]);
    async function loadDetail(row, detailPage = 1, searchQuery = '') {
      const request = ++detailRequestRef.current;
      const id = row?.id || row?.session_id;
      if (!id) return;
      setDetail(row);
      setDetailSearch(searchQuery);
      setDetailHit(null);
      setDetailState({ loading: true, page: detailPage, rows: [], total: 0, error: '' });
      try {
        const offset = (detailPage - 1) * HISTORY_MESSAGE_LIMIT;
        const data = await api(`/api/sessions/${encodeURIComponent(id)}/messages?limit=${HISTORY_MESSAGE_LIMIT}&offset=${offset}&order=oldest`);
        if (request !== detailRequestRef.current) return;
        const rows = data.messages || data.data || [];
        const total = Number(data.total ?? data.message_count ?? row.message_count ?? (rows.length === HISTORY_MESSAGE_LIMIT ? offset + HISTORY_MESSAGE_LIMIT + 1 : offset + rows.length));
        setDetailState({ loading: false, page: detailPage, rows, total, error: '' });
      } catch (err) { if (request === detailRequestRef.current) setDetailState({ loading: false, page: detailPage, rows: [], total: 0, error: errorText(err) }); }
    }
    async function locateSearchHit(row) {
      const query = q.trim();
      const id = row?.id || row?.session_id;
      if (!id || !query) return loadDetail(row, 1, '');
      const request = ++detailRequestRef.current;
      setDetail(row);
      setDetailSearch(query);
      setDetailHit(null);
      setDetailState({ loading: true, page: 1, rows: [], total: 0, error: '' });
      let total = Number(row.message_count || row.total_messages || 0);
      let maxPages = total > 0 ? Math.max(1, Math.ceil(total / HISTORY_MESSAGE_LIMIT)) : 200;
      try {
        for (let detailPage = 1; detailPage <= maxPages; detailPage++) {
          const offset = (detailPage - 1) * HISTORY_MESSAGE_LIMIT;
          const data = await api(`/api/sessions/${encodeURIComponent(id)}/messages?limit=${HISTORY_MESSAGE_LIMIT}&offset=${offset}&order=oldest`);
          if (request !== detailRequestRef.current) return;
          const rows = data.messages || data.data || [];
          const responseTotal = Number(data.total ?? data.message_count ?? 0);
          if (responseTotal > 0) { total = responseTotal; maxPages = Math.max(1, Math.ceil(responseTotal / HISTORY_MESSAGE_LIMIT)); }
          const index = rows.findIndex((msg) => messageMatchesQuery(msg, query));
          if (index >= 0) {
            const msg = rows[index];
            setDetailState({ loading: false, page: detailPage, rows, total: total || offset + rows.length, error: '' });
            setDetailHit({ page: detailPage, index, id: msg?.id || null });
            return;
          }
          if (rows.length < HISTORY_MESSAGE_LIMIT) break;
        }
        setDetailState({ loading: false, page: 1, rows: [], total: total || 0, error: `Hermes FTS 找到了会话，但在官方消息分页中未定位到“${shortText(query, 80)}”。请刷新完整历史后重试。` });
      } catch (err) { if (request === detailRequestRef.current) setDetailState({ loading: false, page: 1, rows: [], total: total || 0, error: errorText(err) }); }
    }
    async function toggle(row) { const id = row.id || row.session_id; await api(`/api/sessions/${encodeURIComponent(id)}`, jinit('PATCH', { archived: !row.archived })); await load(); onSessionMutation?.(); }
    async function remove(row) { const id = row.id || row.session_id; if (!confirm(`删除 ${sessionTitle(row)}？`)) return; await api(`/api/sessions/${encodeURIComponent(id)}`, jinit('DELETE')); if (detail && (detail.id || detail.session_id) === id) { detailRequestRef.current += 1; setDetail(null); } await load(); onSessionMutation?.(); }
    const pages = Math.max(1, Math.ceil(state.total / HISTORY_SESSION_LIMIT));
    const detailPages = Math.max(1, Math.ceil(detailState.total / HISTORY_MESSAGE_LIMIT));
    const searching = Boolean(q.trim());
    return h('section', { className: 'hws3-page' },
      h('header', { className: 'hws3-page-head' }, h('div', null, h('h2', null, '完整历史'), h('p', null, 'Hermes 官方分页 + 消息全文 FTS；点击命中会定位到完整对话中的原消息'))),
      h('div', { className: 'hws3-history-controls' }, h('label', { className: 'hws3-history-search-label' }, h('span', null, '搜索会话标题、ID和消息内容 · Hermes FTS'), h('input', { className: 'hws3-search', value: q, onChange: (e) => { detailRequestRef.current += 1; setQ(e.target.value); setPage(1); setDetail(null); setDetailHit(null); }, placeholder: '搜索完整历史消息…', 'aria-label': '搜索完整历史消息' })), h('select', { value: kind, onChange: (e) => { setKind(e.target.value); setPage(1); }, 'aria-label': '历史范围' }, h('option', { value: 'include' }, '全部'), h('option', { value: 'exclude' }, '未归档'), h('option', { value: 'only' }, '已归档'))),
      h(ErrorBar, { error: state.error }),
      h('div', { className: 'hws3-history-list' }, state.loading ? h('div', { className: 'hws3-loading' }, h(Spinner)) : state.rows.map((row, index) => {
        const rowKey = `${row.session_id || row.id || 'session'}:${row.message_id || row.role || index}`;
        const primary = searching ? () => locateSearchHit(row) : () => onOpenSession(row);
        return h('div', { className: `hws3-history-row ${searching ? 'hws3-history-search-row' : ''}`, key: rowKey }, h('button', { className: 'main', onClick: primary },
          h('strong', null, searching ? `消息命中 · ${sessionTitle(row)}` : sessionTitle(row)),
          h('small', null, [fmtTime(row.last_active || row.started_at), row.role, row.model, row.archived ? '已归档' : ''].filter(Boolean).join(' · ')),
          row.snippet ? h('p', { className: 'hws3-history-hit-snippet' }, searching ? highlightText(shortText(row.snippet, 240), q) : shortText(row.snippet, 180)) : null,
        ), h(Button, { className: 'ghost small', onClick: () => searching ? locateSearchHit(row) : loadDetail(row, 1) }, searching ? '定位消息' : '完整对话'), h(Button, { className: 'ghost small', onClick: () => toggle(row) }, row.archived ? '恢复' : '归档'), h(Button, { className: 'danger small', onClick: () => remove(row) }, '删除'));
      })),
      !searching ? h('div', { className: 'hws3-pagination' }, h(Button, { className: 'ghost', disabled: page <= 1, onClick: () => setPage(page - 1) }, '上一页'), h('span', null, `${page} / ${pages}`), h(Button, { className: 'ghost', disabled: page >= pages, onClick: () => setPage(page + 1) }, '下一页')) : null,
      detail ? h('section', { className: 'hws3-history-detail' },
        h('header', null, h('div', null, h('strong', null, `完整对话 · ${sessionTitle(detail)}`), h('small', null, detailSearch ? `Hermes 官方 Session messages · 已定位搜索命中“${shortText(detailSearch, 60)}”` : 'Hermes 官方 Session messages · 分页加载')), h(Button, { className: 'ghost small', onClick: () => { detailRequestRef.current += 1; setDetail(null); setDetailHit(null); } }, '关闭')),
        h(ErrorBar, { error: detailState.error }),
        detailState.loading ? h('div', { className: 'hws3-loading' }, h(Spinner), detailSearch ? ' 正在跨 Hermes 消息分页定位…' : ' 正在加载完整对话…') : h('div', { className: 'hws3-history-detail-messages' }, detailState.rows.length ? detailState.rows.map((msg, index) => {
          const isHit = Boolean(detailHit && detailHit.page === detailState.page && (detailHit.id ? detailHit.id === msg?.id : detailHit.index === index));
          return h('div', { className: `hws3-history-hit-anchor ${isHit ? 'is-hit' : ''}`, ref: isHit ? detailHitRef : null, key: msg?.id || `${detailState.page}-${index}` }, h(MessageBubble, { msg, searchQuery: detailSearch }));
        }) : h(Empty, { title: '暂无消息', body: 'Hermes 没有返回这一页的消息。' })),
        h('div', { className: 'hws3-pagination' }, h(Button, { className: 'ghost', disabled: detailState.page <= 1 || detailState.loading, onClick: () => loadDetail(detail, detailState.page - 1, detailSearch) }, '上一页'), h('span', null, `${detailState.page} / ${detailPages}`), h(Button, { className: 'ghost', disabled: detailState.page >= detailPages || detailState.loading, onClick: () => loadDetail(detail, detailState.page + 1, detailSearch) }, '下一页')),
      ) : null,
    );
  }

  function Sidebar({ view, setView, recent, current, openSession, newConversation, refreshRecent, ready, mode, mobileOpen, setMobileOpen, onRename, onArchive, onDelete }) {
    const sessions = recent.sessions;
    return h(React.Fragment, null,
      mobileOpen ? h('button', { className: 'hws3-mobile-scrim', onClick: () => setMobileOpen(false), 'aria-label': '关闭侧边栏' }) : null,
      h('aside', { className: `hws3-sidebar ${mobileOpen ? 'mobile-open' : ''}` },
        h('div', { className: 'hws3-brand' }, h('a', { className: 'hws3-brand-link', href: baseHref('/'), onClick: clearAdvancedNavigation, title: '返回 Hermes Worker Studio 主页' }, h(HermesMark)), h('div', null, h('strong', null, 'Hermes Worker Studio'), h('small', null, 'Hermes Native · Product 3.0')), h('button', { className: 'hws3-mobile-close', onClick: () => setMobileOpen(false) }, '×')),
        h(Button, { className: 'new', onClick: () => { newConversation(); setMobileOpen(false); } }, '＋ 新对话'),
        h('nav', { className: 'hws3-nav' }, PRIMARY_NAV.map(([id, label, icon]) => h('button', { key: id, className: view === id ? 'active' : '', onClick: () => { setView(id); setMobileOpen(false); } }, h('span', null, icon), label, id === 'unattended' ? h('i', { className: `hws3-status ${ready ? 'good' : ''}` }) : null))),
        h('div', { className: 'hws3-recent-head' }, h('span', null, '最近对话 · 最近 10 条'), h('button', { onClick: refreshRecent, title: '刷新' }, '↻')),
        h('div', { className: 'hws3-recents' }, recent.loading ? h('div', { className: 'hws3-loading' }, h(Spinner)) : sessions.length ? sessions.map((s) => h(SessionMenu, { key: s.id || s.session_id, session: s, onOpen: () => { openSession(s); setMobileOpen(false); }, onRename: () => onRename(s), onArchive: () => onArchive(s), onDelete: () => onDelete(s) })) : h('p', { className: 'hws3-muted' }, '暂无会话')),
        h('nav', { className: 'hws3-hermes-nav' }, h('a', { className: 'hws3-native-dashboard-link', href: baseHref('/sessions'), onClick: markAdvancedNavigation, title: '打开 Hermes 原生 Dashboard 全部导航' }, h('span', null, '⋯'), '高级 · Hermes Dashboard')),
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
    const [turnRuns, setTurnRuns] = useState([]);
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
    const [slashItems, setSlashItems] = useState([]);
    const [slashIndex, setSlashIndex] = useState(0);
    const [commandBusy, setCommandBusy] = useState(false);
    const [modal, setModal] = useState(null);
    const [modalInput, setModalInput] = useState('');
    const runPollRef = useRef(null);
    const skillBeforeRef = useRef([]);
    const sessionOpenRef = useRef(0);
    const attachInProgressRef = useRef(false);
    const routePersistChainRef = useRef(Promise.resolve());
    const routeChangeRef = useRef(0);
    const sessionRouteRestoreRef = useRef(null);
    const sending = Boolean(run && !TERMINAL_RUN_STATES.has(run.status));
    const projectedRunActive = turnRuns.some(projectedTurnIsActive);
    const projectedRunNeedsReconciliation = turnRuns.some((turn) => projectedTurnNeedsReconciliation(turn, messages));

    useEffect(() => { ensureBranding(); document.documentElement.dataset.hwsStudio = 'true'; return () => { delete document.documentElement.dataset.hwsStudio; }; }, []);
    const refreshConfig = useCallback(async () => { const cfg = unwrapConfig(await api('/api/config')); setConfig(cfg); return cfg; }, []);
    const refreshOptions = useCallback(async (refresh = false) => {
      const data = await api(`/api/model/options${refresh ? '?refresh=1' : ''}`);
      setModelOptions(data);
      setChatRoute((route) => {
        const pending = sessionRouteRestoreRef.current;
        const restored = pending?.session?.id
          ? routeForSession(data, pending.session, pending.projection, route?.provider)
          : null;
        return restored || normalizeRoute(data, route?.model ? route : defaultRoute(data));
      });
      return data;
    }, []);
    const restoreSessionRoute = useCallback((session, projection = null) => {
      const id = session?.id || session?.session_id;
      if (!id) return null;
      const pending = { session: { ...session, id }, projection };
      sessionRouteRestoreRef.current = pending;
      if (!modelOptions) return null;
      const restored = routeForSession(modelOptions, pending.session, projection, chatRoute?.provider);
      if (restored) setChatRoute(restored);
      return restored;
    }, [modelOptions, chatRoute?.provider]);
    useEffect(() => {
      if (!current?.id || !modelOptions) return;
      // Opening a session and refreshing Hermes' model inventory can finish in
      // either order. Re-apply the persisted route once both are present. A
      // pending manual change is intentionally preferred over the old
      // `current` snapshot, so a background inventory refresh cannot undo a
      // deliberate dropdown selection while its official model lock is being
      // written.
      const pending = sessionRouteRestoreRef.current;
      const source = pending?.session?.id === current.id ? pending.session : current;
      const projection = pending?.session?.id === current.id ? pending.projection : null;
      const restored = routeForSession(modelOptions, source, projection, chatRoute?.provider);
      if (!restored) return;
      setChatRoute((route) => routeIdentity(route) === routeIdentity(restored) && route.effort === restored.effort ? route : restored);
    }, [current, modelOptions, chatRoute?.provider]);
    const refreshRecent = useCallback(async () => {
      setRecent((x) => ({ ...x, loading: true, error: '' }));
      try { const data = await api(`/api/sessions?limit=${RECENT_LIMIT}&offset=0&order=recent&archived=exclude`); const sessions = data.sessions || []; setRecent({ loading: false, sessions, error: '' }); return sessions; }
      catch (err) { setRecent((x) => ({ ...x, loading: false, error: errorText(err) })); return []; }
    }, []);
    const loadMessages = useCallback(async (session) => {
      if (!session?.id) { setMessages([]); return []; }
      setMessagesLoading(true); setGlobalError('');
      try { const data = await api(`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=${CHAT_MESSAGE_LIMIT}&offset=0&order=latest`); const rows = data.messages || data.data || []; setMessages(rows); return rows; }
      catch (err) { setGlobalError(errorText(err)); return []; } finally { setMessagesLoading(false); }
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
    const cancelRunPoll = useCallback(() => {
      const active = runPollRef.current;
      if (active?.timer) clearTimeout(active.timer);
      runPollRef.current = null;
    }, []);
    const reconcileSessionProjection = useCallback(async (session, turns, officialMessages) => {
      if (!session?.id || !Array.isArray(turns) || !turns.some((turn) => projectedTurnNeedsReconciliation(turn, officialMessages))) return turns;
      let snapshot;
      try {
        snapshot = await plugin('/hermes/session-reconcile', jinit('POST', { session_id: session.id }));
      } catch (_) {
        // Older installed bridges simply do not have this optional recovery
        // route. Keep the projection untouched until an official liveness
        // result is available; a failed check must never invent a terminal
        // state.
        return turns;
      }
      const result = reconcileProjectedTurns(turns, snapshot, officialMessages);
      if (!result.changed) return turns;
      try {
        await plugin(`/hermes/sessions/${encodeURIComponent(session.id)}/projection`, jinit('PUT', { turns: result.turns.slice(-50) }));
      } catch (_) {}
      return result.turns;
    }, []);
    const attachProjectedRun = useCallback(async (session, turn) => {
      if (!session?.id || !projectedTurnIsActive(turn)) return null;
      try {
        const data = await plugin('/hermes/session-attach', jinit('POST', {
          session_id: session.id,
          run_id: String(turn.id || ''),
          started_at: turn.started_at || null,
          elapsed_ms: turn.elapsed_ms ?? null,
          elapsed_source: turn.elapsed_source || '',
          duration_s: turn.duration_s ?? null,
          last_seq: projectedLocalSeq(turn),
          gateway_last_seq: projectedGatewaySeq(turn),
          output: turn.output || null,
          error: turn.error || null,
        }));
        if (!data?.attached || !data.run) return data || null;
        const attached = data.run;
        const merged = {
          ...turn,
          ...attached,
          id: String(turn.id || attached.id),
          session_id: session.id,
          events: mergeProjectedRunEvents(turn, attached),
          last_seq: Math.max(projectedLocalSeq(turn), Number(attached.last_seq) || 0),
          gateway_last_seq: Math.max(projectedGatewaySeq(turn), Number(attached.gateway_last_seq) || 0),
        };
        return { ...data, run: merged };
      } catch (_) {
        // A missing optional bridge or a transient Gateway reconnect must not
        // turn an otherwise honest projection into a fabricated terminal
        // state.  The reconciliation effect retries the official attach.
        return null;
      }
    }, []);
    const pollAttachedRun = useCallback((runId, initial, requestToken = sessionOpenRef.current) => {
      if (!initial?.session_id) return;
      cancelRunPoll();
      const ref = {
        runId: String(runId),
        sessionId: String(initial.session_id),
        requestToken,
        seq: Number(initial.last_seq) || 0,
        timer: null,
        turn: initial,
        lastMessagePoll: 0,
        idleChecks: 0,
      };
      runPollRef.current = ref;
      setRun(initial);
      const initialDelta = (initial.events || []).filter((event) => ['assistant.delta', 'message.delta'].includes(event.event)).map((event) => deltaText(event.data)).join('');
      if (initialDelta) setStreamText(initialDelta);
      setTurnRuns((rows) => rows.map((turn) => String(turn.id) === String(initial.id) ? initial : turn));

      const currentRef = () => runPollRef.current === ref
        && sessionOpenRef.current === requestToken
        && String(ref.runId) === String(runId);
      const saveTurn = (turn) => {
        ref.turn = turn;
        setRun(turn);
        setTurnRuns((rows) => {
          const next = rows.map((row) => String(row.id) === String(turn.id) ? turn : row);
          if (ref.sessionId) plugin(`/hermes/sessions/${encodeURIComponent(ref.sessionId)}/projection`, jinit('PUT', { turns: next.slice(-50) })).catch(() => {});
          return next;
        });
      };
      const finish = async (officialMessages = null, snapshot = null) => {
        if (!currentRef()) return;
        const messagesForFinish = officialMessages || await loadMessages({ id: ref.sessionId });
        if (!currentRef()) return;
        let finalTurn = ref.turn;
        const assistantMessage = officialAssistantForProjectedTurn(finalTurn, messagesForFinish);
        if (assistantMessage?.id) {
          const ids = projectionMessageIds(finalTurn);
          finalTurn = { ...finalTurn, assistant_message_id: String(assistantMessage.id), message_ids: [...new Set([...ids, String(assistantMessage.id)])] };
        }
        const reconciled = reconcileProjectedTurns([finalTurn], snapshot || {
          active: false,
          message_count: messagesForFinish.length,
          checked_at: Date.now() / 1000,
        }, messagesForFinish);
        finalTurn = reconciled.turns[0] || finalTurn;
        runPollRef.current = null;
        setTimelineExpanded(false);
        saveTurn(finalTurn);
        await loadContext({ id: ref.sessionId });
        if (sessionOpenRef.current !== requestToken) return;
        const sessions = await refreshRecent();
        if (sessionOpenRef.current === requestToken) setCurrent((cur) => sessions.find((s) => s.id === cur?.id) || cur);
        try { const afterSkills = await api('/api/skills'); setSkillDiff(diffSkills(skillBeforeRef.current, afterSkills)); } catch (_) { setSkillDiff(null); }
      };
      const tick = async () => {
        if (!currentRef()) return;
        try {
          const data = await plugin(`/hermes/runs/${encodeURIComponent(runId)}?after=${ref.seq}`);
          if (!currentRef()) return;
          const incoming = Array.isArray(data?.events) ? data.events : [];
          if (incoming.length) {
            ref.seq = Math.max(ref.seq, ...incoming.map((event) => Number(event.seq || 0)));
            const delta = incoming.filter((event) => ['assistant.delta', 'message.delta'].includes(event.event)).map((event) => deltaText(event.data)).join('');
            if (delta) setStreamText((text) => text + delta);
            const contextEvent = [...incoming].reverse().find((event) => String(event.event || '').startsWith('context.'));
            if (contextEvent) {
              const normalized = normalizeContextPayload(contextEvent.data);
              if (normalized) setContextSnapshot((old) => mergeContext(normalizeContextPayload(old), normalized));
            }
          }
          const nextRun = {
            ...ref.turn,
            ...data,
            id: String(ref.turn.id),
            session_id: ref.sessionId,
            events: mergeProjectedRunEvents(ref.turn, { events: incoming }),
            last_seq: Math.max(ref.seq, Number(data?.last_seq) || 0),
            gateway_last_seq: Math.max(Number(ref.turn.gateway_last_seq) || 0, Number(data?.gateway_last_seq) || 0),
          };
          ref.turn = nextRun;
          setRun(nextRun);
          setTurnRuns((rows) => {
            const next = rows.map((row) => String(row.id) === String(nextRun.id) ? nextRun : row);
            plugin(`/hermes/sessions/${encodeURIComponent(ref.sessionId)}/projection`, jinit('PUT', { turns: next.slice(-50) })).catch(() => {});
            return next;
          });
          if (TERMINAL_RUN_STATES.has(String(data?.status || '').toLowerCase())) {
            await finish();
            return;
          }
          // The Gateway event ring is the primary stream.  This official
          // message/liveness check is a durable backstop for the narrow race
          // where Hermes commits the answer while the browser is reconnecting.
          if (Date.now() - ref.lastMessagePoll >= 1200) {
            ref.lastMessagePoll = Date.now();
            const officialMessages = await loadMessages({ id: ref.sessionId });
            if (!currentRef()) return;
            const snapshot = await plugin('/hermes/session-reconcile', jinit('POST', { session_id: ref.sessionId })).catch(() => null);
            if (snapshot?.active === false) {
              ref.idleChecks += 1;
              if (officialAssistantForProjectedTurn(ref.turn, officialMessages) || ref.idleChecks >= 3) {
                await finish(officialMessages, snapshot);
                return;
              }
            } else {
              ref.idleChecks = 0;
            }
          }
          if (!currentRef()) return;
          ref.timer = setTimeout(tick, 650);
        } catch (err) {
          if (!currentRef()) return;
          // A transient HTTP/WebSocket failure during a resumed page must not
          // become a fabricated Hermes failure. Keep the durable turn alive,
          // surface a reconnecting card, and retry the same official Run.
          const at = Date.now() / 1000;
          const reconnecting = {
            ...ref.turn,
            status: 'reconnecting',
            ended_at: null,
            events: [...(ref.turn?.events || []), { seq: Date.now(), event: 'transport.poll_retry', data: { error: errorText(err) }, at }],
          };
          ref.turn = reconnecting;
          setRun(reconnecting);
          setTurnRuns((rows) => {
            const next = rows.map((row) => String(row.id) === String(ref.runId) ? reconnecting : row);
            plugin(`/hermes/sessions/${encodeURIComponent(ref.sessionId)}/projection`, jinit('PUT', { turns: next.slice(-50) })).catch(() => {});
            return next;
          });
          ref.timer = setTimeout(tick, 1200);
        }
      };
      tick();
    }, [cancelRunPoll, loadMessages, loadContext, refreshRecent]);
    const pollProjectedRecovery = useCallback((session, initial, requestToken = sessionOpenRef.current) => {
      if (!session?.id || !initial?.id) return;
      cancelRunPoll();
      const ref = {
        runId: String(initial.id),
        sessionId: String(session.id),
        requestToken,
        turn: initial,
        timer: null,
        attempts: 0,
      };
      runPollRef.current = ref;
      attachInProgressRef.current = true;
      const currentRef = () => runPollRef.current === ref && sessionOpenRef.current === requestToken;
      const saveTurn = (turn) => {
        ref.turn = turn;
        setTurnRuns((rows) => {
          const next = rows.map((row) => String(row.id) === String(turn.id) ? turn : row);
          plugin(`/hermes/sessions/${encodeURIComponent(ref.sessionId)}/projection`, jinit('PUT', { turns: next.slice(-50) })).catch(() => {});
          return next;
        });
      };
      const stop = () => {
        if (runPollRef.current === ref) runPollRef.current = null;
        attachInProgressRef.current = false;
      };
      const tick = async () => {
        if (!currentRef()) return;
        try {
          const officialMessages = await loadMessages({ id: ref.sessionId });
          if (!currentRef()) return;
          const snapshot = await plugin('/hermes/session-reconcile', jinit('POST', { session_id: ref.sessionId })).catch(() => null);
          if (!currentRef()) return;
          const officialAssistant = officialAssistantForProjectedTurn(ref.turn, officialMessages);
          if (snapshot?.active === true || ref.attempts % 3 === 0) {
            const attached = await attachProjectedRun(session, ref.turn);
            if (!currentRef()) return;
            if (attached?.run) {
              stop();
              setTurnRuns((rows) => rows.map((row) => String(row.id) === String(ref.turn.id) ? attached.run : row));
              if (projectedTurnIsActive(attached.run)) {
                setTimelineExpanded(true);
                pollAttachedRun(attached.run.id, attached.run, requestToken);
              } else {
                setRun(attached.run);
                setTimelineExpanded(false);
                await loadMessages({ id: ref.sessionId });
                await loadContext({ id: ref.sessionId });
              }
              return;
            }
          }
          ref.attempts += 1;
          const canReconcile = snapshot?.active === false && (officialAssistant || ref.attempts >= 15);
          if (canReconcile) {
            const result = reconcileProjectedTurns([ref.turn], snapshot, officialMessages);
            const nextTurn = result.turns[0] || ref.turn;
            if (result.changed) saveTurn(nextTurn);
            if (!projectedTurnIsActive(nextTurn)) {
              stop();
              setTimelineExpanded(false);
              await loadContext({ id: ref.sessionId });
              if (sessionOpenRef.current !== requestToken) return;
              const sessions = await refreshRecent();
              if (sessionOpenRef.current === requestToken) setCurrent((cur) => sessions.find((item) => item.id === cur?.id) || cur);
              return;
            }
          }
          if (!currentRef()) return;
          ref.timer = setTimeout(tick, 700);
        } catch (_) {
          if (currentRef()) stop();
        }
      };
      tick();
    }, [cancelRunPoll, loadMessages, loadContext, refreshRecent, attachProjectedRun, pollAttachedRun]);
    const openSession = useCallback(async (row) => {
      const id = row?.id || row?.session_id;
      if (!id) return;
      const requestToken = sessionOpenRef.current + 1;
      sessionOpenRef.current = requestToken;
      routeChangeRef.current += 1;
      cancelRunPoll();
      const s = { ...row, id };
      restoreSessionRoute(s);
      setCurrent(s); setView('chat'); setRun(null); setTurnRuns([]); setMessages([]); setContextSnapshot(null); setStreamText(''); setSkillDiff(null); setTimelineExpanded(false); setAttachments([]);
      try {
        // Load the official messages before exposing the recovered projection.
        // This prevents a previously reconciled-but-unresolved card from
        // flashing as incomplete while the official answer is still arriving.
        const [projection, initialOfficialMessages] = await Promise.all([
          plugin(`/hermes/sessions/${encodeURIComponent(id)}/projection`).catch(() => null),
          loadMessages(s),
        ]);
        if (sessionOpenRef.current !== requestToken) return;
        restoreSessionRoute(s, projection);
        let officialMessages = initialOfficialMessages;
        let turns = Array.isArray(projection?.turns) ? projection.turns : [];
        let restoredRun = null;
        let terminalAttachedRun = null;
        let recoveryNeeded = false;
        const activeTurn = [...turns].reverse().find(projectedTurnIsActive);
        if (activeTurn) {
          attachInProgressRef.current = true;
          try {
            const attached = await attachProjectedRun(s, activeTurn);
            if (sessionOpenRef.current !== requestToken) return;
            if (attached?.run) {
              turns = turns.map((turn) => String(turn.id) === String(activeTurn.id) ? attached.run : turn);
              if (projectedTurnIsActive(attached.run)) restoredRun = attached.run;
              else terminalAttachedRun = attached.run;
            } else recoveryNeeded = true;
          } finally {
            attachInProgressRef.current = false;
          }
        }
        if (terminalAttachedRun) {
          // The replay can close the run in the same request that attaches it.
          // Re-read the official message page once so the terminal answer and
          // its work card become visible without requiring a second refresh.
          officialMessages = await loadMessages(s);
          if (sessionOpenRef.current !== requestToken) return;
          setRun(terminalAttachedRun);
        }
        const reconciled = recoveryNeeded ? turns : await reconcileSessionProjection(s, turns, officialMessages);
        if (sessionOpenRef.current !== requestToken) return;
        setTurnRuns(reconciled);
        const activeRestored = restoredRun && reconciled.find((turn) => String(turn.id) === String(restoredRun.id) && projectedTurnIsActive(turn));
        if (activeRestored) {
          setTimelineExpanded(true);
          pollAttachedRun(activeRestored.id, activeRestored, requestToken);
        } else if (recoveryNeeded) {
          pollProjectedRecovery(s, activeTurn, requestToken);
        }
      } catch (_) {
        if (sessionOpenRef.current === requestToken) setTurnRuns([]);
      }
      if (sessionOpenRef.current === requestToken) loadContext(s);
    }, [cancelRunPoll, loadMessages, loadContext, reconcileSessionProjection, attachProjectedRun, pollAttachedRun, pollProjectedRecovery, restoreSessionRoute]);
    useEffect(() => { Promise.all([refreshRecent(), refreshConfig(), refreshOptions(false), plugin('/health').then(setHealth)]).catch((err) => setGlobalError(errorText(err))); }, []);
    useEffect(() => { if (!sending && !projectedRunActive) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [sending, projectedRunActive]);
    useEffect(() => {
      if (!current?.id || run || messagesLoading || attachInProgressRef.current || (!projectedRunNeedsReconciliation && !projectedRunActive)) return undefined;
      let cancelled = false;
      let checking = false;
      const check = async () => {
        if (cancelled || checking) return;
        checking = true;
        try {
          const activeTurn = [...turnRuns].reverse().find(projectedTurnIsActive);
          if (activeTurn) {
            attachInProgressRef.current = true;
            let attachFailed = false;
            try {
              const attached = await attachProjectedRun(current, activeTurn);
              if (!cancelled && attached?.run) {
                const nextTurns = turnRuns.map((turn) => String(turn.id) === String(activeTurn.id) ? attached.run : turn);
                setTurnRuns(nextTurns);
                if (projectedTurnIsActive(attached.run)) {
                  setTimelineExpanded(true);
                  pollAttachedRun(attached.run.id, attached.run);
                } else {
                  setRun(attached.run);
                  setTimelineExpanded(false);
                  loadMessages({ id: current?.id });
                }
                return;
              }
              attachFailed = true;
            } finally {
              attachInProgressRef.current = false;
            }
            if (!cancelled && attachFailed) {
              pollProjectedRecovery(current, activeTurn);
              return;
            }
          }
          const next = await reconcileSessionProjection(current, turnRuns, messages);
          if (!cancelled && next !== turnRuns) {
            setTurnRuns(next);
            setTimelineExpanded(false);
          }
        } finally {
          checking = false;
        }
      };
      check();
      const timer = setInterval(check, 2500);
      return () => { cancelled = true; clearInterval(timer); };
    }, [current?.id, run, messagesLoading, projectedRunNeedsReconciliation, projectedRunActive, turnRuns, messages, reconcileSessionProjection, attachProjectedRun, pollAttachedRun, loadMessages]);
    useEffect(() => {
      let cancelled = false;
      if (!draft.trimStart().startsWith('/') || sending || commandBusy) { setSlashItems([]); return undefined; }
      const timer = setTimeout(async () => {
        try {
          const query = draft.trimStart();
          const catalog = query === '/' ? await plugin('/hermes/commands') : null;
          const completion = query === '/' ? null : await plugin('/hermes/slash-complete', jinit('POST', { session_id: current?.id || '', text: query }));
          const catalogItems = Array.isArray(catalog?.items) ? catalog.items
            : Array.isArray(catalog?.all) ? catalog.all.map((item) => Array.isArray(item) ? { text: item[0], meta: item[1] } : item)
            : catalog?.commands && typeof catalog.commands === 'object' ? Object.entries(catalog.commands).map(([text, meta]) => ({ text, meta: meta?.description || meta }))
            : [];
          const all = [...catalogItems, ...(Array.isArray(completion?.items) ? completion.items : [])];
          const unique = all.filter((item, index, rows) => rows.findIndex((x) => String(x?.text || x?.display) === String(item?.text || item?.display)) === index);
          if (!cancelled) setSlashItems(unique);
        } catch (_) { if (!cancelled) setSlashItems([]); }
      }, 100);
      return () => { cancelled = true; clearTimeout(timer); };
    }, [draft, current?.id, sending, commandBusy]);
    useEffect(() => () => cancelRunPoll(), [cancelRunPoll]);

    const pollRun = useCallback((runId, initial) => {
      cancelRunPoll();
      runPollRef.current = { runId, seq: 0, timer: null };
      setRun({ ...initial, events: [], elapsed_ms: 0, last_seq: 0 });
      setTurnRuns((rows) => [...rows, { ...initial, events: [], elapsed_ms: 0, last_seq: 0 }]);
      if (initial?.context) setContextSnapshot(initial.context);
      const tick = async () => {
        const ref = runPollRef.current; if (!ref || ref.runId !== runId) return;
        try {
          const data = await plugin(`/hermes/runs/${encodeURIComponent(runId)}?after=${ref.seq}`);
          const incoming = data.events || [];
          if (incoming.length) { ref.seq = Math.max(ref.seq, ...incoming.map((e) => Number(e.seq || 0))); const delta = incoming.filter((e) => ['assistant.delta', 'message.delta'].includes(e.event)).map((e) => deltaText(e.data)).join(''); if (delta) setStreamText((x) => x + delta); const contextEvent = [...incoming].reverse().find((e) => String(e.event || '').startsWith('context.')); if (contextEvent) { const normalized = normalizeContextPayload(contextEvent.data); if (normalized) setContextSnapshot((old) => mergeContext(normalizeContextPayload(old), normalized)); } }
          const nextRun = (prev) => ({ ...(prev || initial), ...data, events: [...(prev?.events || []), ...incoming].slice(-10000) });
          setRun(nextRun);
          setTurnRuns((rows) => {
            const next = rows.length ? [...rows.slice(0, -1), nextRun(rows[rows.length - 1])] : [nextRun(initial)];
            if (initial?.session_id) plugin(`/hermes/sessions/${encodeURIComponent(initial.session_id)}/projection`, jinit('PUT', { turns: next.slice(-50) })).catch(() => {});
            return next;
          });
          if (TERMINAL_RUN_STATES.has(String(data.status || '').toLowerCase())) {
            setTimelineExpanded(false); runPollRef.current = null;
            let terminalMessages = [];
            if (data.session_id) { terminalMessages = await loadMessages({ id: data.session_id }); await loadContext({ id: data.session_id }); }
            const assistantMessage = [...terminalMessages].reverse().find((message) => message?.role === 'assistant' && message?.id);
            if (assistantMessage?.id) {
              setTurnRuns((rows) => {
                if (!rows.length) return rows;
                const next = [...rows];
                const last = { ...next[next.length - 1], assistant_message_id: String(assistantMessage.id), message_ids: [String(assistantMessage.id)] };
                next[next.length - 1] = last;
                if (data.session_id) plugin(`/hermes/sessions/${encodeURIComponent(data.session_id)}/projection`, jinit('PUT', { turns: next.slice(-50) })).catch(() => {});
                return next;
              });
            }
            const sessions = await refreshRecent(); setCurrent((cur) => sessions.find((s) => s.id === cur?.id) || cur);
            try { const afterSkills = await api('/api/skills'); setSkillDiff(diffSkills(skillBeforeRef.current, afterSkills)); } catch (_) { setSkillDiff(null); }
            return;
          }
          ref.timer = setTimeout(tick, 650); runPollRef.current = ref;
        } catch (err) { setRun((prev) => ({ ...(prev || initial), status: 'failed', ended_at: Date.now() / 1000, events: [...(prev?.events || []), { seq: Date.now(), event: 'studio.error', data: { error: errorText(err) }, at: Date.now() / 1000 }] })); setTimelineExpanded(false); runPollRef.current = null; }
      };
      tick();
    }, [cancelRunPoll, loadMessages, loadContext, refreshRecent]);

    const createSession = useCallback(async (text, route = null) => {
      const title = route?.provider === 'moa' ? `◈ MOA · ${route.model || 'Mixture of Agents'} · ${titleFromPrompt(text)}` : titleFromPrompt(text);
      const out = await plugin('/hermes/sessions', jinit('POST', { title, source: 'hermes_browser', provider: route?.provider, model: route?.model, preset: route?.provider === 'moa' ? route.model : undefined }));
      const id = getSessionId(out); if (!id) throw new Error('Hermes did not return a session id');
      const session = out.session || { id, title, source: 'hermes_browser' }; if (route?.provider === 'moa') plugin(`/hermes/sessions/${encodeURIComponent(id)}/projection`, jinit('PUT', { turns: [], moa: { preset: route.model || 'default', provider: 'moa', source: 'studio' } })).catch(() => {}); setCurrent({ ...session, id, title, provider: route?.provider, model: route?.model }); setMessages([]); setContextSnapshot(null); await refreshRecent(); return { ...session, id, title, provider: route?.provider, model: route?.model };
    }, [refreshRecent]);
    const resolveExecutionRoute = useCallback(async (route) => {
      const normalized = normalizeRoute(modelOptions, route);
      if (!normalized.provider || !normalized.model || normalized.provider === 'moa') return normalized;
      const query = new URLSearchParams({ provider: normalized.provider, model: normalized.model });
      let resolved;
      try { resolved = await plugin(`/hermes/protocol-route?${query.toString()}`); }
      catch (error) {
        // Keep the source-tree runtime tests and older uninstalled bridges
        // readable, but never hide a real 409 probe requirement.
        if (/Unhandled fetchJSON call|404|Not Found/i.test(errorText(error))) return normalized;
        throw error;
      }
      if (resolved?.requires_probe) {
        throw new Error(`模型 “${normalized.provider} / ${normalized.model}” 尚未确定使用 Chat Completions 还是 Responses。请先进入“模型”页面点击“测试”。`);
      }
      return { ...normalized, provider: resolved?.execution_provider || normalized.provider, source_provider: normalized.provider, protocol: resolved };
    }, [modelOptions]);
    const lockRuntime = useCallback(async (session, route) => { const normalized = { provider: String(route?.provider || '').trim(), model: String(route?.model || '').trim(), effort: route?.effort || 'auto' }; if (!session?.id || !normalized.model || !normalized.provider) return normalized; await plugin(`/hermes/sessions/${encodeURIComponent(session.id)}/model`, jinit('POST', { provider: normalized.provider, model: normalized.model, require_model_lock: true })); return normalized; }, []);
    const changeChatRoute = useCallback((nextRoute) => {
      const normalized = normalizeRoute(modelOptions, nextRoute);
      const previous = normalizeRoute(modelOptions, chatRoute);
      setChatRoute(normalized);
      if (!current?.id || routeIdentity(previous) === routeIdentity(normalized)) return;
      const session = { ...current };
      const requestToken = ++routeChangeRef.current;
      sessionRouteRestoreRef.current = { session: { ...session, provider: normalized.provider, model: normalized.model, effort: normalized.effort }, projection: null };
      setGlobalError('');
      routePersistChainRef.current = routePersistChainRef.current.catch(() => {}).then(async () => {
        try {
          await assertMoaReady(modelOptions, normalized);
          const executionRoute = await resolveExecutionRoute(normalized);
          if (executionRoute?.requires_probe) throw new Error(`模型 “${normalized.provider} / ${normalized.model}” 尚未确定协议，请先在“模型”页面点击“测试”。`);
          await lockRuntime(session, executionRoute);
          if (routeChangeRef.current !== requestToken) return;
          setCurrent((value) => value && value.id === session.id ? { ...value, provider: normalized.provider, model: normalized.model, effort: normalized.effort } : value);
        } catch (err) {
          if (routeChangeRef.current !== requestToken) return;
          sessionRouteRestoreRef.current = { session, projection: null };
          setChatRoute(previous);
          setGlobalError(`保存会话模型失败：${errorText(err)}`);
        }
      });
    }, [modelOptions, chatRoute, current, resolveExecutionRoute, lockRuntime]);

    const send = useCallback(async (forcedText = null) => {
      const sourceText = forcedText == null ? draft : forcedText;
      const text = String(sourceText || '').trim();
      if (commandBusy) return;
      if (sending) {
        if (!text) return;
        try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/steer`, jinit('POST', { input: text })); setDraft(''); }
        catch (err) { setGlobalError(`调整方向失败：${errorText(err)}`); }
        return;
      }
      if (!text && !attachments.length) return;
      setGlobalError(''); setStreamText(''); setSkillDiff(null);
      try {
        try { skillBeforeRef.current = await api('/api/skills'); } catch (_) { skillBeforeRef.current = []; }
        await routePersistChainRef.current.catch(() => {});
        const route = normalizeRoute(modelOptions, chatRoute);
        if (text.startsWith('/')) {
          setTimelineExpanded(false);
          setCommandBusy(true);
          try {
            const session = current?.id ? current : await createSession(text || '图片对话', route);
            const commandResult = await plugin('/hermes/slash-exec', jinit('POST', { session_id: session.id, command: text, provider: route.provider !== 'moa' ? route.provider : undefined, model: route.provider !== 'moa' ? route.model : undefined }));
            const refreshedMessages = await loadMessages(session);
            const commandMessages = [{ role: 'user', content: text, display_kind: 'command', id: `local-command-${Date.now()}` }];
            if (commandResult?.output) commandMessages.push({ role: 'assistant', content: String(commandResult.output), display_kind: 'command-result', id: `slash-result-${Date.now()}` });
            setMessages([...refreshedMessages, ...commandMessages].slice(-CHAT_MESSAGE_LIMIT));
            setDraft(''); setSlashItems([]); setGlobalError('');
          } finally {
            setCommandBusy(false);
          }
          return;
        }
        setTimelineExpanded(true);
        await assertMoaReady(modelOptions, route);
        const executionRoute = await resolveExecutionRoute(route);
        const session = current?.id ? current : await createSession(text || '图片对话', route);
        const lockedRoute = await lockRuntime(session, executionRoute);
        const localContent = text || `[${attachments.length} 张图片]`;
        setMessages((xs) => [...xs, { role: 'user', content: localContent, id: `local-${Date.now()}` }]);
        const parts = [];
        if (text) parts.push({ type: 'text', text });
        for (const item of attachments) parts.push({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'high' } });
        const input = attachments.length ? [{ role: 'user', content: parts }] : text;
        setDraft(''); setAttachments([]);
        const body = { session_id: session.id, input, provider: lockedRoute.provider, model: lockedRoute.model };
        if (lockedRoute.effort && lockedRoute.effort !== 'auto') body.model_options = { reasoning_effort: lockedRoute.effort };
        const started = await plugin('/hermes/runs-v3', jinit('POST', body)); pollRun(started.id, started);
      } catch (err) { setGlobalError(errorText(err)); }
    }, [draft, sending, commandBusy, run?.id, attachments, current, createSession, loadMessages, lockRuntime, resolveExecutionRoute, chatRoute, pollRun]);

    const stopRun = useCallback(async () => { if (!run?.id) return; try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/stop`, jinit('POST', {})); } catch (err) { setGlobalError(`停止 Run 失败：${errorText(err)}`); } }, [run?.id]);
    const approveRun = useCallback(async (choice) => { if (!run?.id) return; try { await plugin(`/hermes/runs/${encodeURIComponent(run.id)}/approval`, jinit('POST', { choice })); } catch (err) { setGlobalError(`审批提交失败：${errorText(err)}`); } }, [run?.id]);
    const newConversation = useCallback(() => { sessionOpenRef.current += 1; routeChangeRef.current += 1; sessionRouteRestoreRef.current = null; cancelRunPoll(); setCurrent(null); setMessages([]); setRun(null); setTurnRuns([]); setContextSnapshot(null); setStreamText(''); setDraft(''); setSlashItems([]); setAttachments([]); setSkillDiff(null); setView('chat'); }, [cancelRunPoll]);

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
    const useMoa = useCallback((preset = 'default') => {
      const available = modelsFor(modelOptions, 'moa');
      const model = available.includes(preset) ? preset : available[0] || preset;
      setChatRoute({ provider: 'moa', model, effort: 'auto' });
      setView('chat');
      setMobileOpen(false);
    }, [modelOptions]);
    const content = view === 'worker' ? h(WorkerPage, { config, modelOptions, chatRoute, refreshConfig })
      : view === 'models' ? h(ModelsPage, { modelOptions, refreshOptions })
      : view === 'moa' ? h(MoaPage, { modelOptions, refreshOptions, onUseMoa: useMoa, onOpenSession: openSession })
      : view === 'unattended' ? h(UnattendedPage, { config, refreshConfig })
      : view === 'history' ? h(HistoryPage, { onOpenSession: openSession, onSessionMutation: refreshRecent })
      : h(Conversation, { session: current, messages, loading: messagesLoading, run, turnRuns, contextSnapshot, streamText, draft, setDraft, onSend: send, sending, commandBusy, modelOptions, chatRoute, setChatRoute: changeChatRoute, now, onStop: stopRun, onApprove: approveRun, skillDiff, timelineExpanded, setTimelineExpanded, attachments, setAttachments, onRename: () => askRename(current), onArchive: () => toggleArchive(current), onDelete: () => askDelete(current), slashItems, slashIndex, setSlashIndex, onSlashSelect: (item) => { const token = slashCommandText(item); if (!token) return; setSlashItems([]); send(token); } });

    return h('div', { className: 'hws3-root' },
      h(Sidebar, { view, setView, recent, current, openSession, newConversation, refreshRecent, ready, mode, mobileOpen, setMobileOpen, onRename: askRename, onArchive: toggleArchive, onDelete: askDelete }),
      h('main', { className: 'hws3-main' },
        h('div', { className: 'hws3-mobile-bar' }, h('button', { onClick: () => setMobileOpen(true), title: '菜单' }, '☰'), h('a', { className: 'hws3-mobile-brand', href: baseHref('/'), onClick: clearAdvancedNavigation, title: '返回 Hermes Worker Studio 主页' }, h(HermesMark, { compact: true }), h('strong', null, 'Hermes Worker Studio')), h(Pill, { tone: ready ? 'good' : 'neutral' }, ready ? '完全访问' : '受控')),
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
