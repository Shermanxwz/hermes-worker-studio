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
        │          ├── session.resume(close_on_disconnect=false)
        │          ├── prompt.submit
        │          ├── session.steer / session.interrupt
        │          ├── approval.respond / clarify.respond / ...
        │          ├── image.attach_bytes / pdf.attach / file.attach
        │          ├── session.usage / session.context_breakdown
        │          └── message.*, tool.*, todo.updated, status.update, subagent.*
        │
        ├── Sessions / Search / Archive / CRUD
        ├── Models / Custom Endpoints
        ├── Skills / Plugins / MCP / Cron
        └── Config / Profiles / native Dashboard

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
- 原生 Hermes 会话、Skills、Plugins、MCP、Automation/Cron：Studio 左栏直接可见；
- Profiles、Analytics、Logs、Config、Docs 等低频原生入口保留在“高级”；
- 原生页通过官方 `header-left` + `sidebar` slots 提供 `← Worker Studio` 返回链路；
- `/sessions` 等 Hermes 原生 route 始终保留，不复制其内部实现。

浏览器入口是 `dashboard/dist/gateway-native.js`。它只做官方 Gateway JSON-RPC transport / UI compatibility projection，然后加载 `dashboard/dist/index-v3.js`。Hermes Dashboard 官方 `/dashboard-plugins/{plugin}/{file_path}` 静态资源合同负责提供 sibling bundle。API bearer secret 永不进入浏览器。

安装器会对临时 staging 副本执行 exact-count-checked `scripts/stage_product_bundle.py`，把产品 UI 收口成最终安装形态；任何源代码漂移导致替换目标不唯一时安装直接 fail closed。

## 对话：全部官方 Hermes

| Studio 行为 | Hermes 官方合同 |
|---|---|
| 打开/恢复已有对话 | `session.resume` |
| 发送 | `prompt.submit` |
| 运行中追加方向 | `session.steer` |
| 停止 | `session.interrupt` |
| 审批 | `approval.respond` |
| Clarify Skip | `clarify.respond` |
| MCP setup Skip | `mcp.setup.respond` |
| 图片 | `image.attach_bytes` |
| PDF | `pdf.attach` |
| 其他文件 | `file.attach` → Hermes `@file:` ref |
| 实时正文 | `message.delta` / `message.complete` |
| 工具过程 | `tool.start/progress/complete` |
| 子代理 | `subagent.*` / delegation events |
| Context | `session.usage` + `session.context_breakdown` |
| Auto Compact 状态 | `status.update(kind=compacting/compacted)` |
| 官方计划 | `todo.updated` |

### 任意文件附件

Product Composer 的文件选择、Ctrl/Cmd+V 与 drag/drop 都接受任意文件：

```text
image/*          → image.attach_bytes
application/pdf  → pdf.attach
other            → file.attach
                    ↓
              @file:attachments/...
                    ↓
           回填给同一 Hermes prompt
```

Studio 不自行解析普通文件内容；文件被放入 Hermes Session workspace 后由 Hermes 官方 file tools / context references 读取。

### WebSocket 断线恢复

WebSocket **不是任务生命周期**，durable Hermes Session 才是。

OAuth / gated Dashboard 下，每次 WebSocket 建连或重连都会重新调用 SDK `buildWsUrl('/api/ws')`，不会复用单次 ticket。Studio 使用：

```text
session.resume(
  stored_session_id,
  close_on_disconnect=false
)
```

连接断开时：

```text
running
  ↓
reconnecting        ← 不宣布 interrupted
  ↓
fresh buildWsUrl('/api/ws')
  ↓
session.resume(stored id, omit_messages=false)
  ↓
rebind new runtime id
  ↓
reconcile running / inflight / todo / pending input / messages
  ↓
running 或真实 completed/failed truth
```

只有用户点击 Stop / Hermes 自己返回 terminal truth，才结束 Run。

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
◔ 正在压缩上下文…
        ↓
Hermes status.update(kind=compacted)
        ↓
✓ 上下文已压缩
        ↓
重新读取 Hermes session.usage
```

桌面显示紧凑 Context pill + popover；移动端变为触屏友好的整行 Context 与底部详情层；支持 `prefers-reduced-motion`。

## 官方计划

Studio **没有 planner**。Product chat 只消费 Hermes Gateway 的 canonical `todo.updated`：

```text
官方计划 · 已完成 2 / 5
████████░░
● 当前：移动端验证
```

步骤内容、revision、状态全部属于 Hermes canonical todo。Studio 只做计数、进度条、折叠/展开和响应式视觉。

`plugin_api_v3.py` 仍保留 `/v1/runs` 的 Session todo/context compatibility projection，仅用于 probe/CI/兼容路径；它不是 Product chat 的主计划或 Context 数据源。

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

## 完全访问（Full Access / Never Wait）

“完全访问”只写 Hermes 官方 approvals/delegation 配置，并保存恢复快照。开启后再通过真实 Hermes Run probe 验证无人值守链路。

开启时：

- 可配置 approval 走 Hermes 官方 auto-approve；
- child agent 使用 `subagent_auto_approve`；
- `clarify.request` 通过官方 `clarify.respond` 自动 Skip；
- MCP setup 通过官方 response contract 自动 Decline；
- sudo / secret / terminal input 在没有凭据时使用 Hermes 官方取消/空响应语义解除等待；
- Hermes **Hardline Blocklist 永久保留**，Studio 不修改、不绕过。

因此 Full Access 的产品保证是：**Studio 不因为自己的 approval/input UI 无限等待用户。** 缺少密码、MFA、CAPTCHA 或第三方授权仍可能令任务失败或迫使 agent 改走可行路径；这不是绕过外部权限的承诺。

## 安装

```bash
bash scripts/install.sh
```

安装器执行：staged `hermes plugins doctor` → 原子替换 → `hermes plugins enable` → final doctor，并：

- 安装 `gateway-native.js` + Product 3 UI/CSS；
- 对 staging UI 执行 fail-closed Product 3 release transform；
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
atomic install + candidate SHA stamp + release transform
  ↓
真实 Hermes /v1/runs + canonical todo 多 revision probe
  ↓
Session CRUD cleanup
  ↓
真实 Dashboard Playwright
  ├── desktop Chromium
  ├── Pixel 7
  ├── arbitrary-file installed picker
  ├── durable-resume / no-wait capability markers
  ├── native Hermes navigation + return path
  └── 浏览器 /api/ws → session.resume → session.usage/context_breakdown 真 RPC
  ↓
independent evidence verifier
  ↓
.seal/SEALED.json  eligible=true
```

完整封存定义见 [`SEAL_ACCEPTANCE.md`](./SEAL_ACCEPTANCE.md)。只有 exact-head CI 全绿且同一 SHA 的真实目标 `.seal/SEALED.json` 为 `eligible: true`，PR #4 才允许 Ready / merge。
