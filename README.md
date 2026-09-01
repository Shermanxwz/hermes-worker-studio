# Hermes Worker Studio 3.0

面向长期封存的 **Hermes 原生 Web 工作台**。项目只维护产品壳、官方能力编排和 UI 投影；不 fork Hermes、不读私有数据库、不 import 私有 `AIAgent` / delegation 实现、不维护第二套 Worker runtime、planner、tokenizer、模型目录或 Provider 客户端。

> 接管 UX，不接管 Hermes 内核。能由 Hermes 公共接口解决的，绝不在 Studio 里重新实现。

唯一运行时上游是 `NousResearch/hermes-agent`，精确基线记录在 `tests/upstream-lock.json`。

## 最终运行架构

```text
Hermes Dashboard Plugin SDK
        │
        ├── buildWsUrl('/api/ws')
        │          │
        │          ▼
        │   Hermes TUI Gateway JSON-RPC / WebSocket
        │          ├── session.resume
        │          ├── prompt.submit
        │          ├── session.steer / session.interrupt
        │          ├── approval.respond
        │          ├── image.attach_bytes
        │          ├── session.usage / session.context_breakdown
        │          └── message.*, tool.*, todo.updated, status.update, subagent.*
        │
        ├── Sessions / Search / Archive / CRUD
        ├── Models / Custom Endpoints
        ├── Skills / Plugins / MCP
        └── Config / Profiles / Cron / native Dashboard

Hermes Main
   ├── AIAgent / Context Engine / Auto Compact
   ├── canonical todo
   ├── native delegate_task
   ├── PluginContext.subagent_lifecycle  ← Worker Studio worker_delegate/status
   ├── /review + auxiliary.review.*
   └── approvals / Hardline / tools / memory / sessions

Hermes API Server /v1/runs
   └── 只用于 probe、CI、无人值守验收与外部 API，不是 Product chat 主协议
```

Hermes 官方 Programmatic Integration 将 TUI Gateway JSON-RPC（stdio / WebSocket）定义为希望获得完整 Hermes 特性的自定义 Desktop / Web / TUI host 协议。Worker Studio 因此直接使用这条官方链路，而不是在浏览器里重新造 agent/runtime。

## Product 3 Web

Product 3 通过官方 Dashboard Plugin 合同拥有产品首页：

- `/`：Worker Studio；
- `/sessions`：原生 Hermes Dashboard 会话页；
- 原生页通过官方 `header-left` slot 显示 `← Worker Studio`；
- Studio“高级”保留 Sessions、Cron、Profiles、Analytics、Logs、Config、Docs 等原生入口。

浏览器入口是 `dashboard/dist/gateway-native.js`。它只做官方 Gateway JSON-RPC transport / UI compatibility projection，然后加载 `dashboard/dist/index-v3.js`。Hermes Dashboard 官方 `/dashboard-plugins/{plugin}/{file_path}` 静态资源合同负责提供 sibling bundle。API bearer secret 永不进入浏览器。

## 对话：全部官方 Hermes

Product chat 的关键动作：

| Studio 行为 | Hermes 官方合同 |
|---|---|
| 打开已有对话 | `session.resume` |
| 发送 | `prompt.submit` |
| 运行中追加方向 | `session.steer` |
| 停止 | `session.interrupt` |
| 审批 | `approval.respond` |
| 图片 | `image.attach_bytes` |
| 实时正文 | `message.delta` / `message.complete` |
| 工具过程 | `tool.start/progress/complete` |
| 子代理 | `subagent.*` / delegation events |
| Context | `session.usage` + `session.context_breakdown` |
| Auto Compact 状态 | `status.update(kind=compacting/compacted)` |
| 官方计划 | `todo.updated` |

OAuth / gated Dashboard 下，每次 WebSocket 建连或重连都重新调用 SDK `buildWsUrl('/api/ws')`，不会复用单次 ticket。Studio resume 使用 `close_on_disconnect:true`；连接异常时 UI fail-closed 为 interrupted，Hermes 同步回收该 runtime，避免幽灵任务和双执行。

## Context 与 Auto Compact

Context 数字由 Hermes 提供，不由 Studio 估算：

```text
◔ 32.4K / 128K · 25%
```

- `context_used / context_max / context_percent`：Hermes `session.usage`；
- breakdown：Hermes `session.context_breakdown`；
- Context Engine、阈值和真正压缩动作：Hermes；
- Studio 不把累计 `input_tokens / prompt_tokens / total_tokens` 冒充当前上下文。

Compact UI 只做视觉投影：

```text
Hermes status.update(kind=compacting)
        ↓
◔ 正在压缩上下文…  （旋转 / 呼吸动画）
        ↓
Hermes status.update(kind=compacted)
        ↓
✓ 上下文已压缩
        ↓
重新读取 Hermes session.usage
        ↓
18.7K / 128K · 15%
```

桌面显示紧凑 Context pill + popover；移动端变为触屏友好的整行 Context 与底部详情层；支持 `prefers-reduced-motion`。

## 官方计划

Studio **没有 planner**。Product chat 只消费 Hermes Gateway 的 canonical `todo.updated`：

```text
官方计划 · 已完成 2 / 5
████████░░
● 当前：移动端验证

点击展开
✓ 分析代码
✓ 接入官方接口
● 移动端验证
○ 真机测试
○ 最终封存
```

步骤内容、revision、状态全部属于 Hermes canonical todo。Studio 只做计数、进度条、折叠/展开和响应式视觉。

`plugin_api_v3.py` 仍保留 `/v1/runs` 的 Session todo/context compatibility projection，仅用于 probe/CI/旧兼容路径；它不再是 Product chat 的主计划或 Context 数据源。

## 四模式 / Worker

| UI | Hermes 原生语义 |
|---|---|
| `OFFICIAL` | Studio delegation policy 休眠，交还 Hermes 原生 `delegate_task` |
| `AUTO` | Main 自主判断是否启动 Hermes child agent |
| `WORKER` | wire=`DELEGATE`，偏好 Main 协调、Hermes child agent 执行 |
| `MAIN` | Hermes `pre_tool_call` policy 阻止新的 `delegate_task` / `worker_delegate` |

Worker 执行只通过公开 `PluginContext.subagent_lifecycle` / `SubagentLaunchRequest`。不存在 Codex Worker、sidecar worker service 或第二执行内核。

## 模型 / Custom Endpoint

Studio 不维护本地模型表：

```text
Hermes Custom Endpoint API
        ↓
/api/model/options
        ↓
对话 / Worker / Verifier 共用 Hermes 模型目录
```

- Custom Endpoint：Hermes `/api/providers/custom-endpoints` 验证、保存、激活、编辑、删除；
- Base URL 的输入归一化只是 UI 辅助，最终合法性由 Hermes 验证；
- 模型连通性 probe 使用 Hermes `/v1/runs`；
- Worker 路由写 Hermes `delegation.*`；
- Verifier 路由写 Hermes `auxiliary.review.*`；
- Reasoning 只展示 Hermes/provider 明确暴露的能力，否则 `Auto`。

## Session / 历史

默认读取边界：最近对话 20、当前对话 80 条、完整历史 30 会话/页、历史消息 100 条/页。

搜索、重命名、归档/取消归档、删除、完整历史全部使用 Hermes Session API。创建标题来自用户首条 prompt + 碰撞后缀，不再使用固定 `New conversation`。

## 完全访问（Full Access）

“完全访问”只写 Hermes 官方 approvals/delegation 配置，并保存恢复快照。开启后再通过真实 Hermes Run probe 验证无人值守链路。

Hermes **Hardline Blocklist 永久保留**；Studio 不修改、不绕过，也不宣称绕过。

## 安装

```bash
bash scripts/install.sh
```

安装器执行：staged `hermes plugins doctor` → 原子替换 → `hermes plugins enable` → final doctor，并：

- 安装 `gateway-native.js` + Product 3 UI/CSS；
- 将 staged bridge 写入 exact candidate SHA；
- 安装版 favicon 直接复用官方 Hermes Web `/favicon.ico`；
- 不修改任何 Hermes core 文件。

Product chat 不需要浏览器 bearer key。只有 probe/CI 路径需要 API Server：

```text
HERMES_WORKER_STUDIO_API_URL=http://127.0.0.1:8642
HERMES_WORKER_STUDIO_API_KEY=<same as API_SERVER_KEY>
```

## 封存级闭环

GitHub CI 全绿只是 **ARCHIVE CANDIDATE**。最终封存要求真实目标机证明同一个 commit：

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

闭环：

```text
clean exact candidate
  ↓
atomic install + candidate SHA stamp
  ↓
真实 Hermes /v1/runs + canonical todo 多 revision probe
  ↓
Session CRUD cleanup
  ↓
真实 Dashboard Playwright
  ├── desktop Chromium
  ├── Pixel 7
  ├── Gateway-native contract marker
  └── 浏览器 /api/ws → session.resume → session.usage/context_breakdown 真 RPC
  ↓
independent evidence verifier
  ↓
.seal/SEALED.json  eligible=true
```

只有 **exact PR head CI 全绿** 且真实目标机 `.seal/SEALED.json` 对同一 SHA 返回 `eligible:true`，PR 才可从 Draft → Ready → merge。

## 本地门禁

```bash
python -m compileall -q __init__.py schemas.py tools.py dashboard scripts tests
node --check dashboard/dist/gateway-native.js
node --check dashboard/dist/index-v3.js
bash -n scripts/install.sh
python scripts/verify_contract.py
python -m unittest discover -s tests -p 'test_*.py' -v
npm install --ignore-scripts --no-fund
npm run test:frontend
npm audit --audit-level=high
hermes plugins doctor . --ci
```

Pinned upstream contract：

```bash
python scripts/verify_upstreams.py --hermes-root /path/to/pinned/hermes-agent
```

## 文档

- `SEAL_ACCEPTANCE.md` — 最终封存合同
- `docs/ARCHITECTURE.md` — 架构与数据流
- `docs/UPSTREAM_CONTRACTS.md` — Hermes 公共合同清单
- `docs/SECURITY.md` — 信任边界
- `docs/AUTOMATED_TEST_MATRIX.md` — CI 验收矩阵
