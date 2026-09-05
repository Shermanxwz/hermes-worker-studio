# Hermes Worker Studio · 项目介绍

Hermes Worker Studio 是一个面向 Hermes 的产品级 Web 工作台。它作为 Hermes 官方 Dashboard Plugin 的产品壳，负责导航、交互和信息呈现；执行、模型、会话、审批、Skills、Plugins、MCP 与持久化仍由 Hermes 官方运行时负责。

> 当前状态：**ARCHIVE CANDIDATE**。代码级、产品级和普通 CI 工程闭环持续收紧，但只有 exact-current 真实目标机证据与 required upstream contract 同时闭合后才允许称为 `SEALED`。

## 项目定位

Studio 只维护一套产品体验，不维护第二套 Agent 内核。它通过 Hermes 已公开的 Dashboard、Gateway、Runs、Session、Model、Approval 和 `PluginContext.subagent_lifecycle` 合同，把原生能力组织成适合日常使用的工作台。

核心原则：

- Hermes 是唯一的执行、模型、上下文、计划、策略和持久化上游。
- 能由 Hermes 公共接口完成的动作，只调用 Hermes 公共接口。
- 不 fork Hermes，不修改 Hermes core，不读取私有数据库。
- 不创建第二个 Worker runtime、planner、tokenizer、模型目录或 Provider 客户端。
- 浏览器不接触 Hermes API bearer secret。
- 模型协议与 reasoning strength 都必须来自官方声明或真实执行证据，不靠名称猜测。

## 产品界面

产品首页 `/` 由 Worker Studio 接管，保留六个一级产品面：

- **对话**：Hermes 原生 Gateway 会话、发送、停止、Steer、审批和实时生命周期。
- **Worker**：通过 Hermes 公共 `subagent_lifecycle` 使用官方子代理能力。
- **模型**：直接读取 Hermes `/api/model/options`；Custom Endpoint 通过 Hermes 官方接口管理。
- **MOA**：独立页面和专属会话列表，读取/保存 Hermes 官方 `/api/model/moa`；Pinned API Server 不提供该 Dashboard 路由时，使用 Hermes 自己的 `/api/config`/配置存储边界。
- **完全访问**：读写 Hermes 官方审批/委派配置，并用真实官方 Run 验证回读结果。
- **完整历史**：服务端全文搜索、会话分页、消息分页、归档、恢复、重命名和删除。

点击 **高级 · Hermes Dashboard** 直接进入 Hermes 原生 `/sessions`。原生 Hermes 自己渲染完整导航，因此未来 Hermes 新入口无需 Studio 复制维护。进入原生页面后，官方 Dashboard 壳层恢复，并通过官方 slot 提供 `← Worker Studio` 返回路径。

## 官方运行映射

| 产品行为 | Hermes 官方来源 |
| --- | --- |
| 打开/恢复会话 | Gateway WebSocket `session.resume` |
| 发送消息 | Gateway JSON-RPC `prompt.submit` |
| 运行中调整/停止 | `session.steer` / `session.interrupt` |
| 审批和交互请求 | `approval.respond`、`clarify.respond`、`mcp.setup.respond` 等 |
| Context / Compact | `session.usage`、`session.context_breakdown`、`status.update` |
| 官方计划 | Hermes `todo.updated` 或官方 Session API todo 结果 |
| 工具/Skills/子代理活动 | Hermes Gateway lifecycle + public `subagent_lifecycle` |
| 会话与历史 | Hermes `/api/sessions/*` + 官方全文搜索 |
| 模型/Provider | Hermes `/api/model/options`、`/api/providers/custom-endpoints` |
| MOA | Hermes `/api/model/moa` 或官方 `/api/config` 配置存储 + native `moa` provider |
| 附件 | `image.attach_bytes`、`pdf.attach`、`file.attach` |

浏览器对话使用 Hermes 官方 Gateway；`/v1/runs` 是探测、CI 和无人值守验证面，不是另一套聊天执行内核。

## New API 与每模型协议

Hermes 0.20.6 对通用 Custom Endpoint 的 transport 是 Provider 级能力，但一个 New API inventory 可以同时存在 Chat Completions 与 Responses-only 模型。Studio 通过一个受限的 per-model compatibility bridge 解决这个 pinned-core 缺口：

1. Hermes 已声明的 Provider/model 协议优先。
2. 已有真实验证路由直接复用。
3. 第一次真正使用 unresolved 模型时，自动执行真实 Hermes Chat/Responses probe。
4. 只有一个 transport 成功时，结果按模型缓存，并通过 Hermes 官方 `/api/config` 建立隔离兼容 Provider。
5. 两种都成功时保持 ambiguous，要求明确选择。
6. 两种都失败时 fail closed，并展示真实结果。
7. 不按 URL、模型名或 `gpt-*` 字样猜测协议。

并发首次请求共享一个 probe lock，最近失败有短暂 cooldown，避免重复计费/错误风暴。**官方探测**按钮保留用于诊断和主动重试，不再是正常使用前置步骤。原始 Provider/Model 始终是 UI 展示身份，内部 managed alias 不泄漏为第二模型目录。

Product Chat、独立 Worker、Verifier 与 MOA 使用同一 execution-route resolver。

## 对话体验与数据边界

- 普通对话首屏只加载最近 10 条消息。
- 普通最近会话列表排除明确标记的 MOA 会话；MOA 页面维护独立的 MOA 会话列表。
- 完整历史通过 Hermes 官方全文搜索跨消息分页定位命中；不会拿最近 10 条冒充完整搜索。
- 完整历史每页最多 30 个会话，详情每页最多 100 条消息。
- `/` 命令使用 Hermes 官方命令目录和执行路径。
- 时间、工具、计划、Compact、Skills 变化只展示真实 Hermes 事件或官方持久化结果。
- WebSocket 断线保留 durable Hermes Session，通过 fresh authenticated socket + `session.resume` 恢复，不把断线误判成 terminal。
- Context occupancy 只来自 Hermes 官方 context telemetry，不把累计 billing/input tokens 当当前上下文。

## 附件与无人值守

选择文件、Ctrl/Cmd+V、drag/drop 共用一条附件管线：图片 → `image.attach_bytes`，PDF → `pdf.attach`，其他文件 → `file.attach` 并使用 Hermes 返回的 `@file:` ref。

完全访问只操作 Hermes 官方审批/委派配置，保留恢复快照，并用真实 marker Run 验证。它保证“不让 Studio/Hermes 卡在人工审批 UI”，但不绕过密码、MFA、CAPTCHA、OAuth 或 Hermes Hardline Blocklist。

## 工程与 UI 封口

Supported installer 在临时目录创建 exact candidate，写入 candidate SHA，再执行两条 deterministic、exact-count、fail-closed build transform：

- `stage_product_bundle.py`：现有附件族 + 交互/可访问性收口；
- `stage_mixed_protocol.py`：pinned Hermes 的 per-model mixed-protocol compatibility。

CI 会独立生成同一 staged JS/Python，并做 `node --check` / Python compile；installer tests 再断言最终文件集合与实际 staged 行为，避免“源码绿、安装产物是另一套代码”。

最终 CSS 链为：

```text
product.css -> product-sealed.css -> product-closure.css
```

closure 层只收紧 focus、触屏可发现性、Modal focus/Escape、安全区、短视口和 reduced motion，不改变现有视觉语言或增加功能。

Real-target Playwright 同时覆盖：

- desktop 1440×900；
- Pixel 7 竖屏；
- 667×375 小屏触控横屏。

六个一级页面都会逐页检查横向溢出和产品根视口边界。

## 封存状态

唯一运行时上游是 pinned Hermes：

```text
NousResearch/hermes-agent
9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea
```

真正封存需要 exact-current 三证据面：

```text
.seal/upstream.json
.seal/target.json
.seal/ui-report.json
        ↓
.seal/SEALED.json
```

当前 required upstream blocker 是 `NousResearch/hermes-agent#100149` 的 route-scoped exclusive-shell 公共合同（或 pinned revision 中经验证的等价正式合同）。普通 CI 绿色只代表 **ARCHIVE CANDIDATE**，不能替代该 upstream gate 或真实目标机证据。

## 开始使用

```bash
bash scripts/install.sh
python scripts/seal_close.py --url http://127.0.0.1:19119
```

若已有 exact Hermes checkout，可追加 `--hermes-root /path/to/hermes-agent`。

## 相关文档

- [架构说明](ARCHITECTURE.md)
- [产品工程收口](PRODUCT_CLOSURE.md)
- [官方上游合同](UPSTREAM_CONTRACTS.md)
- [完整验收规则](../SEAL_ACCEPTANCE.md)
- [自动化测试矩阵](AUTOMATED_TEST_MATRIX.md)
- [Dashboard exclusive shell 合同](HERMES_DASHBOARD_EXCLUSIVE_SHELL.md)
- [安全边界](SECURITY.md)
