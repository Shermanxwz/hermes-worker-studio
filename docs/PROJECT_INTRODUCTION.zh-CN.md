# Hermes Worker Studio · 项目介绍

Hermes Worker Studio 是一个面向 Hermes 的产品级 Web 工作台。它是 Hermes 官方 Dashboard Plugin 的产品壳：负责导航、交互和信息呈现；执行、模型、会话、审批、Skills、Plugins、MCP 与持久化仍由 Hermes 官方运行时负责。

> 当前状态：**ARCHIVE CANDIDATE**。仓库工程验收与普通 CI 已闭合，但在 Hermes 官方实现并进入 pinned revision 之前，不能称为 `SEALED`。

## 项目定位

Studio 只维护一套产品体验，不维护第二套 Agent 内核。它通过 Hermes 已公开的 Dashboard、Gateway、Runs、Session、Model、Approval 和 `PluginContext.subagent_lifecycle` 合同，把原生能力组织成适合日常使用的工作台。

核心原则：

- Hermes 是唯一的执行、模型、上下文、计划、策略和持久化上游。
- 能由 Hermes 公共接口完成的动作，直接调用 Hermes 公共接口。
- 不 fork Hermes，不修改 Hermes core，不读取私有数据库。
- 不创建第二个 Worker runtime、planner、tokenizer、模型目录或 Provider 客户端。
- 浏览器不接触 Hermes API bearer secret。

## 产品界面

产品首页 `/` 由 Worker Studio 接管，提供：

- **对话**：Hermes 原生 Gateway 会话、发送、停止、Steer、审批和实时生命周期。
- **Worker**：通过 Hermes 公共 `subagent_lifecycle` 使用官方子代理能力。
- **模型**：直接读取 Hermes `/api/model/options`；Custom Endpoint 通过 Hermes 官方接口管理。
- **MOA**：独立的 MOA 页面和专属会话列表，直接读取/保存 Hermes `/api/model/moa`。
- **完全访问**：读写 Hermes 官方审批/委派配置，并用真实官方 Run 验证回读结果。
- **完整历史**：服务端全文搜索、会话分页、消息分页、归档、恢复、重命名和删除。

点击 **高级 · Hermes Dashboard** 会直接进入 Hermes 原生 `/sessions`。原生 Hermes 自己渲染完整导航，因此 Hermes 后续新增导航会自然出现在该入口，不需要 Studio 维护复制的二级菜单。进入原生页面后，官方 Dashboard 壳层恢复，并通过官方 slot 提供返回 Studio 的入口。

## 官方接口映射

| 产品行为 | Hermes 官方来源 |
| --- | --- |
| 打开/恢复会话 | Dashboard Gateway WebSocket 的 `session.resume` |
| 发送消息 | Gateway JSON-RPC `prompt.submit` |
| 运行中调整/停止 | `session.steer` / `session.interrupt` |
| 审批与交互请求 | `approval.respond`、`clarify.respond`、`mcp.setup.respond` 等官方响应 |
| 上下文与 Compact | `session.usage`、`session.context_breakdown`、`status.update` |
| 官方计划 | Hermes `todo.updated` 事件或官方 Session API 中的 todo 结果 |
| 工具、Skills、子代理活动 | Hermes Gateway lifecycle 事件和公共 `subagent_lifecycle` |
| 会话与历史 | Hermes `/api/sessions/*` 与官方消息全文搜索 |
| 模型和 Provider | Hermes `/api/model/options`、`/api/providers/custom-endpoints` |
| MOA | Hermes `/api/model/moa` 与原生 `moa` provider |
| 文件附件 | `image.attach_bytes`、`pdf.attach`、`file.attach` |

Studio 的浏览器对话使用 Hermes 官方 Gateway；`/v1/runs` 仍是探测、CI 和无人值守验证面，不是另一套聊天执行内核。

## 对话体验和数据边界

- 普通对话首屏只加载最近 10 条消息，保证打开速度。
- 完整历史使用 Hermes 官方全文搜索；点击结果后，Studio 会分页读取官方消息并定位、滚动到命中消息，而不是在最近 10 条里假装搜索完整会话。
- 完整历史按会话分页，每页最多 30 个会话；详情消息按页加载，每页最多 100 条。
- 输入 `/` 显示 Hermes 官方命令目录和中文解释；点击命令会写入真实命令 token，并通过 Hermes 官方命令执行路径发送，不是普通聊天文本。
- 实时工作时间、工具调用、官方计划、Compact 和 Skills 变化只展示 Hermes 实际事件或官方持久化结果；没有事件时不会猜测或伪造。
- WebSocket 断线时保留 durable Hermes Session，通过 `session.resume` 和官方消息/状态重新绑定，不把网络断开误报成任务完成或失败。
- 会话标题使用用户提示词生成；不会再追加随机的 `· xxxxx` 后缀。

## MOA 是什么

MOA（Mixture of Agents）是 Hermes 的官方聚合执行模式：多个 Reference 模型先分别分析，再由 Aggregator 汇总为最终回答，最终仍由 Hermes Run 执行。它不是 Studio 自己实现的第二个聊天模型，也不是一个可以脱离 Hermes 配置直接运行的模型。

MOA 页面只从 Hermes 官方模型 inventory 读取可用 Provider/Model，并把配置保存回 Hermes `/api/model/moa`。Reference 或 Aggregator 缺少 Hermes 官方凭据时，页面显示具体的待配置状态，不强行显示“未就绪”或假装可以运行；凭据仍应通过 Hermes 官方 setup/provider 配置完成。

## New API 与协议选择

Hermes 0.20.6 对通用 Custom Endpoint 的协议解析是 Provider 级能力，不能自动根据模型名称猜测每个模型使用 Chat Completions 还是 Responses。Studio 因此遵循以下规则：

1. Hermes 已声明的模型/Provider 协议优先使用官方声明。
2. 对混合 New API，只有用户主动选择或点击“官方探测”才执行真实 Hermes Run 探测。
3. 探测结果按模型保存为受限路由状态，并通过 Hermes 官方配置创建隔离的兼容 Provider。
4. 未解析或结果冲突时 fail closed，不按 URL、模型名或 GPT 字样猜测。

原始 Provider 不被静默改写，探测也不会在页面加载时偷偷发起。

## 安全与无人值守

完全访问只操作 Hermes 官方审批/委派设置，保留恢复快照，并用真实 marker Run 验证配置。它的含义是“不让 Studio 或 Hermes 等待人工审批 UI”，不是绕过密码、MFA、CAPTCHA、OAuth 或 Hermes Hardline Blocklist。

Worker 模式只通过 Hermes 的公共 `PluginContext.subagent_lifecycle`；Studio 不启动外部 Worker 服务，也不复制 Hermes 的执行逻辑。

## 封存状态

当前唯一运行时上游是 pinned Hermes：

```text
NousResearch/hermes-agent
9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea
```

仓库普通 CI 验证代码、依赖边界、产品运行时、Pinned Hermes 公共基线和安全合同。真正封存还需要目标机器上的三份证据：

```text
.seal/upstream.json
.seal/target.json
.seal/ui-report.json
.seal/SEALED.json
```

在 Hermes upstream #100149 的 route-scoped exclusive-shell 公共合同落地并进入 pinned revision 之前，`seal_close.py` 必须停在 Gate 0，不能生成 `eligible: true` 的 `SEALED.json`。

## 开始使用

在已安装 Hermes 的主机上，使用仓库提供的原子安装器：

```bash
bash scripts/install.sh
```

安装器会通过 Hermes 官方 Plugin 命令启用插件，并运行 Plugin Doctor。目标机封存闭环：

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

如果 Hermes 源码 checkout 已存在，可追加 `--hermes-root /path/to/hermes-agent`。封存脚本不会跳过 upstream gate，也不会伪造目标或浏览器证据。

## 相关文档

- [架构说明](ARCHITECTURE.md)
- [官方上游合同](UPSTREAM_CONTRACTS.md)
- [完整验收规则](../SEAL_ACCEPTANCE.md)
- [自动化测试矩阵](AUTOMATED_TEST_MATRIX.md)
- [Dashboard exclusive shell 合同](HERMES_DASHBOARD_EXCLUSIVE_SHELL.md)
- [安全边界](SECURITY.md)

