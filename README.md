# Hermes Worker Studio 3.0

**项目介绍：** [中文](docs/PROJECT_INTRODUCTION.zh-CN.md) · [English](docs/PROJECT_INTRODUCTION.en-US.md)

面向长期封存的 **Hermes 原生 Web 工作台**。项目只维护产品壳、官方能力编排与 UI 投影；不 fork Hermes、不 patch Hermes core、不读私有数据库、不 import 私有 `AIAgent` / delegation 实现，也不维护第二套 Worker runtime、planner、tokenizer、模型目录或 Provider 客户端。

> 接管 UX，不接管 Hermes 内核。能由 Hermes 公共接口解决的能力，只通过 Hermes 公共合同接入。

唯一运行时上游是 `NousResearch/hermes-agent`，精确版本与封存级必需合同记录在 `tests/upstream-lock.json`。

## 仓库封存形态

长期仓库只保留 **`main`** 作为 canonical branch。工作分支只允许在开发过程中临时存在，进入归档/封存态前必须归并并删除；`main` 可以处于 `ARCHIVE CANDIDATE`，但只有三证据面全部闭合后才允许称为 `SEALED`。

普通 `CI` 的职责是证明当前 `main` 代码、依赖边界、Pinned Hermes 归档基线和产品运行测试健康，因此应保持绿色。尚未进入 pinned Hermes 的未来 seal-required upstream contract 不通过普通 CI 制造永久红灯；它由 `seal_close.py` 的 Gate 0 与最终 evidence verifier 单独硬阻断。

## 最终产品形态

```text
Hermes Web /
  └─ Hermes Worker Studio
       ├─ 对话
       ├─ Worker
       ├─ 模型
       ├─ MOA
       ├─ 完全访问
       ├─ 完整历史
       └─ 高级 · Hermes Dashboard → Hermes 原生 /sessions 壳层
                                      └─ Hermes 自己维护的完整导航与未来新增入口

进入任意原生 Hermes route
  └─ 恢复完整 Hermes Dashboard shell
       └─ 官方 Plugin slot → ← Worker Studio
```

Supported installer 不复制或维护 Hermes 的二级导航列表。Studio 正常使用时只展示 Worker Studio 自己的产品导航；点击 **高级 · Hermes Dashboard** 后直接进入 Hermes 原生 `/sessions` 壳层，由 Hermes 自己渲染完整侧栏，因此 Hermes 后续新增导航会自动同步到该入口。

### 官方级 Dashboard takeover 的硬门

`tab.override: "/"` 可以通过官方 Plugin API 替换首页内容，但当前锁定的 Hermes 版本还没有“仅在该 override route 隐藏原生 Dashboard shell、离开后自动恢复”的公共 SDK 合同。为满足本地产品体验，Studio 只在自身根页挂载期间通过一组严格限定的宿主层兼容选择器隐藏官方外层侧栏与页头；进入 `/sessions` 后 Studio 卸载，Hermes 原生壳层恢复。该兼容层不复制导航、不修改 Hermes bundle、不 fork Hermes，并继续由 upstream Gate 0 保护，不能冒充官方 exclusive-shell 合同。

该缺口已正式提交 Hermes upstream：`NousResearch/hermes-agent#100149`，提议一个通用 route-scoped exclusive shell contract（例如 `tab.shell: "exclusive"`）。完整规格见 `docs/HERMES_DASHBOARD_EXCLUSIVE_SHELL.md`。

这个合同现在是 **硬封存 blocker**：

- `tests/upstream-lock.json` 标记 `dashboard_route_scoped_exclusive_shell.required_for_seal=true`；
- `scripts/verify_required_upstream_contracts.py` 要求 pinned Hermes 同时具备 typed API、runtime enforcement、公开文档和 upstream behavior test；
- 普通 CI 只验证当前可归档的 pinned Hermes 公共基线，不把已知 upstream 缺口伪装成仓库故障；
- `seal_close.py` 会先跑 upstream gate，合同不存在时连安装/真实模型/browser seal 都不会继续；
- 最终 verifier 必须同时验证 `.seal/upstream.json`、`.seal/target.json`、`.seal/ui-report.json`。

因此，在 Hermes 官方合同真正落地并更新 pin 前，正确状态是 **main 上的 ARCHIVE CANDIDATE**，绝不宣称 `SEALED`。

## Product chat：Hermes 官方 Gateway

浏览器通过 Dashboard Plugin SDK `buildWsUrl('/api/ws')` 直接使用 Hermes TUI Gateway JSON-RPC：

| Studio 行为 | Hermes 官方合同 |
|---|---|
| 打开/恢复对话 | `session.resume` |
| 发送 | `prompt.submit` |
| 运行中调整方向 | `session.steer` |
| 停止 | `session.interrupt` |
| 审批 | `approval.respond` |
| Clarify Skip | `clarify.respond` |
| MCP setup Skip | `mcp.setup.respond` |
| 图片 | `image.attach_bytes` |
| PDF | `pdf.attach` |
| 其他文件 | `file.attach` → `@file:` ref |
| Context | `session.usage` + `session.context_breakdown` |
| Auto Compact | `status.update(compacting/compacted)` |
| 官方计划 | `todo.updated` |
| Worker | `PluginContext.subagent_lifecycle` |

API bearer secret 不进入浏览器。

## 任意文件附件

文件选择、Ctrl/Cmd+V 和 drag/drop 共用一条附件管线：

```text
image/*          → image.attach_bytes
application/pdf  → pdf.attach
other            → file.attach
                    ↓
                 @file:...
                    ↓
            回填给同一 Hermes prompt
```

普通文件内容不由 Studio 自己解析；文件进入 Hermes Session workspace 后由 Hermes 官方 file tools/context references 使用。

## Durable Session / WebSocket 恢复

WebSocket 只是 transport，durable Hermes Session 才是任务生命周期。

```text
running
  ↓ socket loss
reconnecting
  ↓ fresh SDK.buildWsUrl('/api/ws')
session.resume(stored_session_id, close_on_disconnect=false)
  ↓
new runtime id rebind
  ↓
reconcile running / inflight / todo / pending input / messages
  ↓
running 或 Hermes 的真实 terminal truth
```

网络断线不会被 Studio 人为宣布为 `interrupted`。

## 完全访问 / Never-Wait unattended

Full Access 只写 Hermes 官方配置并保存恢复快照：

```text
approvals.mode = off
cron_mode = approve
single_query_mode = approve
unattended_mode = approve
mcp_reload_confirm = false
destructive_slash_confirm = false
delegation.subagent_auto_approve = true
```

当前 Hermes Web/Gateway 中已知会阻塞执行的人机输入也由官方 response contract 自动解除：

- `approval.request` → 自动批准；
- `clarify.request` → `clarify.respond(answer="")` Skip；
- `mcp.setup.request` → Decline；
- `sudo.request` / `secret.request` → Hermes 官方空值取消语义；
- `terminal.read.request` → 无 pane 时立即 EOF；
- WebSocket 断线 → 自动 durable resume。

**无人值守的保证是“不等待 Studio/Hermes 人工审批或确认 UI”**，不是承诺任何外部授权都能凭空获得。密码、MFA、CAPTCHA、OAuth/第三方授权缺失时，任务可以自主失败或改走可行路径；Hermes Hardline Blocklist 永久有效、不可绕过。

## Worker / 四模式

| 模式 | Hermes 原生语义 |
|---|---|
| `OFFICIAL` | Studio delegation policy 休眠，交回 Hermes native `delegate_task` |
| `AUTO` | Main 自主决定是否启动 Hermes child agent |
| `WORKER` | wire=`DELEGATE`，偏向 Main 协调 + Hermes child agent 执行 |
| `MAIN` | Hermes `pre_tool_call` 阻止新的 `delegate_task` / `worker_delegate` |

Worker 只通过公开 `PluginContext.subagent_lifecycle` / `SubagentLaunchRequest`。不存在 Codex Worker、sidecar worker service 或第二执行内核。

## Product UX

Product 3 保留 ChatGPT 式交互逻辑并使用 Hermes 风格视觉：

- 新对话、最近会话、搜索；
- 完整历史使用 Hermes 官方 FTS 搜索消息内容；点击命中会跨官方消息分页定位并滚动到原消息。普通对话只保留最近 10 条，不提供误导性的局部搜索；
- 重命名、归档、取消归档、删除；
- 自动滚动开关、回到底部；
- Enter 发送 / Shift+Enter 换行；
- 运行中再次发送 = Steer；
- Stop；
- 任意文件 picker / paste / drop；
- Context meter、Auto Compact 状态；
- Hermes canonical todo 计划；
- tool/subagent/skills activity；
- MOA 是独立侧边栏入口，不嵌入普通模型目录；页面通过 Hermes `/api/model/options` 同步所有已发现的 provider/model（包括 New API Custom Endpoint），并直接读取/保存 Hermes `/api/model/moa`。它是 Reference → Aggregator 的官方执行模式，不是独立 LLM。缺少 provider 凭据时明确显示未就绪和官方配置入口；
- Custom Endpoint 仍通过 Hermes 官方接口保存凭据、发现模型和基础 URL；表单不再伪造一个 provider-global 协议选择器。Hermes 已声明的协议直接采用；对一个同时包含 Chat Completions 与 Responses 模型的通用 endpoint，只有用户点击“官方探测”或明确选择后才会调用最多两次真实 Hermes `/v1/runs`。解析结果写入受限的 Studio 路由状态，并通过 Hermes 官方 `/api/config` 创建隐藏的、按模型隔离的兼容 Provider；原始 Provider 不被改写，未探测或两种协议都成功时严格拒绝发送，不按模型名或 URL 猜测；
- desktop/mobile 全链路响应式；
- supported install 使用项目图标作为 Hermes 官方插件静态资源，不再维护独立 favicon。

## 三证据面封存

真正的封存不是“代码看起来完成”，而是三面证据闭环：

```text
exact Worker Studio main candidate
          │
          ├─ ① pinned official Hermes upstream contracts
          │      .seal/upstream.json
          │
          ├─ ② real Hermes execution/session/todo target
          │      .seal/target.json
          │
          └─ ③ real desktop + mobile browser product
                 .seal/ui-report.json
                 .seal/playwright-artifacts/*
                         ↓
              independent verifier
                         ↓
                 .seal/SEALED.json
```

一键目标封存：

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

如果已有 Hermes 源码 checkout：

```bash
python scripts/seal_close.py --hermes-root /path/to/hermes-agent --url http://127.0.0.1:19119
```

`SEALED.json` 只有在以下全部成立时才可能 `eligible=true`：

1. exact `main` candidate 的普通 CI 全绿；
2. exact Hermes pin 的 seal-required public contracts 全部通过；
3. 真实 Hermes Run / Session CRUD / canonical todo 通过；
4. desktop Chromium + Pixel 7 真浏览器通过；
5. `/` 只显示 Worker Studio 自己的导航，并且只保留一个直达 `/sessions` 的 Hermes 原生入口，不复制原生导航列表；
6. `/sessions` 等 native route 恢复 Hermes 原生 shell 并可返回 Studio；
7. 三份证据与 exact candidate/pin 完全一致。

完整规则见 `SEAL_ACCEPTANCE.md`。在 upstream #100149 尚未被官方实现并进入 pinned Hermes revision 前，`main` 必须保持 `ARCHIVE CANDIDATE` 状态；一旦三证据面闭环，仓库仍只保留 `main`，再以 exact main SHA 作为封存身份。
