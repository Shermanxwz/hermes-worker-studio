# Hermes Worker Studio 3.0

**项目介绍：** [中文](docs/PROJECT_INTRODUCTION.zh-CN.md) · [English](docs/PROJECT_INTRODUCTION.en-US.md)

面向长期归档/封存的 **Hermes 原生 Web 工作台**。项目只维护产品壳、官方能力编排与 UI 投影；不 fork Hermes、不 patch Hermes core、不读私有数据库、不 import 私有 `AIAgent` / delegation 实现，也不维护第二套 Worker runtime、planner、tokenizer、模型目录或 Provider 客户端。

> 接管 UX，不接管 Hermes 内核。能由 Hermes 公共接口解决的能力，只通过 Hermes 公共合同接入。

唯一运行时上游是 `NousResearch/hermes-agent`，精确版本与封存级必需合同记录在 `tests/upstream-lock.json`。

当前状态：**ARCHIVE CANDIDATE**。普通 CI、代码和产品工程闭环不能替代 exact-current 真实目标机证据，也不能替代 required upstream exclusive-shell contract。

## 产品形态

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

原生 Hermes route
  └─ Hermes Dashboard shell
       └─ official plugin slot → ← Worker Studio
```

Studio 正常产品首页不复制 Hermes 二级导航。点击 **高级 · Hermes Dashboard** 直接进入 native `/sessions`，由 Hermes 自己渲染完整侧栏和未来新增入口。

Pinned Hermes 0.20.6 还没有 route-scoped exclusive plugin shell 的正式公共合同，因此当前本地产品壳只使用严格限定、可逆的宿主兼容选择器隐藏 `/` 上的外层 Hermes sidebar/header；离开 Studio root 后立即恢复。这个兼容层不 fork、不 patch、不复制导航，也不能冒充最终官方合同。

硬封存 blocker：`NousResearch/hermes-agent#100149`（或 pinned revision 中经验证的等价正式 contract）。

## Product Chat：Hermes 官方 Gateway

浏览器通过 Dashboard Plugin SDK `buildWsUrl('/api/ws')` 使用 Hermes TUI Gateway JSON-RPC：

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

API bearer secret 不进入浏览器。`/v1/runs` 保留为 Hermes 官方探测、CI、无人值守验证 rail，不是 Studio 的第二聊天 runtime。

## New API：模型读取与 Chat/Responses 动态路由

Custom Endpoint inventory 仍以 Hermes `/api/model/options` 为唯一事实来源。粘贴 `/v1/responses` 只会规范化到 API root，**不会**被当作“这个 Provider 所有模型都必须走 Responses”的证据。

对一个同时包含 Chat Completions 与 Responses-only 模型的 New API：

```text
Provider / Model
      ↓
Hermes 已声明协议？ ── yes → 直接使用
      │ no
      ↓
已有真实验证 route？ ─ yes → 复用
      │ no
      ↓
第一次实际使用时自动 real probe
      ├─ Chat only       → chat_completions
      ├─ Responses only  → codex_responses
      ├─ both success    → ambiguous / 明确选择
      └─ both failed     → fail closed
```

规则：

- 不按 `gpt-*`、模型名或 URL 猜协议；
- first-use probe 使用真实 Hermes Run；
- per-model verified route 通过官方 `/api/config` 建立窄 managed alias；
- 原始 Provider/Model 保持用户可见身份；
- 并发首次请求共享 probe lock；
- 最近失败有短暂 cooldown，避免重复计费/错误风暴；
- **官方探测**按钮用于诊断/主动重试，不是正常使用前置步骤；
- Product Chat、Worker、Verifier、MOA 共用同一个 execution-route resolver。

Reasoning strength 同样不猜：只有 upstream 明确给出支持档位才出现 slider；否则只有 `Auto`，请求/config 不写 guessed effort。

## Worker / 四模式

| 模式 | Hermes 原生语义 |
|---|---|
| `OFFICIAL` | Studio delegation policy 休眠，交回 Hermes native `delegate_task` |
| `AUTO` | Main 自主决定是否启动 Hermes child agent |
| `WORKER` | wire=`DELEGATE`，偏向 Main 协调 + Hermes child agent 执行 |
| `MAIN` | `pre_tool_call` 在执行前阻止新的 `delegate_task` / `worker_delegate` |

Worker 只通过 public `PluginContext.subagent_lifecycle` / `SubagentLaunchRequest`。不存在 sidecar worker service 或第二执行内核。未知 mode fail closed；Studio 方便查找用的 handle map 有界，不是任务数据库。

## 数据、Context、Plan

- 普通对话只加载最近 10 条消息；
- 完整历史按 30 session/page，详情按 100 message/page；
- FTS 搜索通过 Hermes 官方服务端结果定位真实消息，不拿最近 10 条冒充完整历史；
- Context occupancy 只来自 Hermes `session.usage` / `session.context_breakdown` 等正式 telemetry；
- 不把累计 billing/input tokens 当当前上下文；
- Studio 没有 planner；官方计划只来自 Hermes `todo.updated` 或允许的官方 Session todo projection；
- WebSocket 断线只进入 `reconnecting`，fresh auth socket + `session.resume(close_on_disconnect=false)` 恢复 durable Session，不伪造 terminal truth。

## 任意文件附件

文件选择、Ctrl/Cmd+V 和 drag/drop 共用一条官方附件管线：

```text
image/*          → image.attach_bytes
application/pdf  → pdf.attach
other            → file.attach
                    ↓
                 @file:...
                    ↓
            回填给同一 Hermes prompt
```

Studio 不自己解析普通文件内容，也不维护第二套 workspace。

## 完全访问 / Never-Wait unattended

Full Access 只写 Hermes 官方审批/委派配置并保存恢复快照。Hermes Hardline Blocklist 永久有效。

已知会阻塞执行的人机请求使用 Hermes 官方 response contract 自动解除：approval 自动批准、Clarify 空答案 Skip、MCP setup Decline、无可用 sudo/secret 使用官方取消语义、无 terminal pane 时立即 EOF。

这保证“不等待 Studio/Hermes 自己的审批 UI”，不代表可以凭空获得密码、MFA、CAPTCHA、OAuth 或第三方授权。

## 封存级 build / install parity

Supported installer 在临时目录建立 exact candidate，写入 candidate SHA，然后执行两条 deterministic、exact-count、fail-closed build transform：

- `scripts/stage_product_bundle.py` — 现有附件族 + interaction/accessibility closure；
- `scripts/stage_mixed_protocol.py` — pinned Hermes mixed Chat/Responses per-model compatibility。

CI 会独立生成**同一份 staged JS/Python**，再执行 `node --check` / Python compile 和关键闭环断言；installer tests 断言最终安装文件集合、candidate SHA 和两条 transform 的最终行为。这样不会出现“源码测试绿，但安装后的代码没人测”。

安装是原子的：staged Plugin Doctor 成功后才替换旧插件，失败会保留上一份 install。

## Desktop / Mobile 产品闭环

最终 CSS 链：

```text
product.css
  → product-sealed.css
      → product-closure.css
```

`product-closure.css` 不增加功能、不改 teal/cream 视觉语言，只补最后的产品工程边界：

- keyboard `:focus-visible`；
- Modal Escape + focus trap + focus return；
- menu/disclosure `aria` state；
- composer/send/file/mobile nav/Full Access accessible names；
- touch-only session actions 不依赖 hover；
- safe-area + short viewport bounds；
- reduced-motion 覆盖 Studio-owned animations/transitions。

Real-target Playwright 固定三种产品 viewport：

- Desktop Chromium 1440×900；
- Pixel 7 portrait；
- compact touch landscape 667×375。

每个 viewport 都依次访问：**对话 / Worker / 模型 / MOA / 完全访问 / 完整历史**，逐页检查横向溢出与产品根视口边界。桌面再额外验证真实 Gateway context 与 native `/sessions` 返回链。

Seal browser 默认不忽略 TLS certificate errors；只有明确的可信本地/测试证书环境才可设置 `HWS_SEAL_IGNORE_HTTPS_ERRORS=1`。

## 三证据面封存

```text
exact Worker Studio candidate
          │
          ├─ ① pinned official Hermes upstream contracts
          │      .seal/upstream.json
          │
          ├─ ② real Hermes target/runtime/model evidence
          │      .seal/target.json
          │
          └─ ③ real desktop/mobile browser product evidence
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

如果已有 exact Hermes source checkout：

```bash
python scripts/seal_close.py --hermes-root /path/to/hermes-agent --url http://127.0.0.1:19119
```

只有 exact-current candidate CI 绿色、required upstream contract 通过、真实目标机/模型/浏览器证据闭合，并且 `.seal/SEALED.json eligible=true` 指向同一 candidate/pin 时，才能称为 `SEALED`。

## 安装

```bash
bash scripts/install.sh
```

安装器通过 Hermes 官方 Plugin 命令启用插件并运行 Plugin Doctor。

## 文档

- [中文项目介绍](docs/PROJECT_INTRODUCTION.zh-CN.md)
- [English introduction](docs/PROJECT_INTRODUCTION.en-US.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Product engineering closure](docs/PRODUCT_CLOSURE.md)
- [Security](docs/SECURITY.md)
- [Automated test matrix](docs/AUTOMATED_TEST_MATRIX.md)
- [Seal checklist](docs/SEAL_CHECKLIST.md)
- [Seal status](docs/SEAL_STATUS.md)
- [Canonical seal acceptance](SEAL_ACCEPTANCE.md)
