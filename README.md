# Hermes Worker Studio

面向长期封存的 Hermes Agent Web 工作台：**不 fork Hermes Web，不复制 Hermes 私有数据库逻辑，不伪造模型能力**。日常对话、历史、搜索、技能/插件/MCP 管理继续走 Hermes 官方 Dashboard / API Server；派工只通过 `codex-worker-delegation` 的控制平面接入。

目标是把 Codex 风格的“真实工作过程 + 实时时长 + 完成后折叠”体验，和 Hermes 官方可维护接口组合成一个可以长期冻结的产品层。

## 已实现

- `/sessions` 由 Hermes **官方 Dashboard Plugin SDK** 覆盖；Hermes 核心仓库无需打补丁。
- 首页只取最近 **10 个会话**；单个对话只取最近 **40 条消息**，避免长历史拖慢首屏。
- “完整历史对话”独立分页：20 个会话/页，100 条消息/页。
- 直接使用 Hermes 官方 FTS5 `/api/sessions/search` 做全文对话搜索。
- 已归档对话独立页面，使用官方 `archived=only` 与官方 Session PATCH 归档接口。
- 对话执行使用 Hermes 官方 API Server Session + `chat/stream` SSE。
- 工作过程来自**真实 SSE run/tool/output 事件**；发现 Worker `task_id` 后继续读取真实 Worker 状态。
- 运行中显示秒级实时工作时长；完成/失败后自动折叠所有工作过程并保留总耗时。
- New API：输入 Base URL / API Key 后由 Worker 获取真实模型目录；可逐模型做真实连通性请求。
- New API 同步到 Hermes 官方 Custom Endpoint API；密钥不下发到浏览器以外的额外存储层。
- Main / Worker / Verifier / 对话模型选择共享同一 Worker Model Capability Registry。
- 思考强度滑块只使用上游实际声明的 `reasoning.options`；没有声明时只显示 `Auto`，**不猜测、不硬编码**。
- Hermes 高频入口一级显示：完整历史、已归档、Worker 路由、Skills、Plugins、MCP。
- Models / Cron / Files / Logs / Analytics / Channels / Webhooks / Profiles / Keys / Config / System 放入二级“更多”。
- 提供 Hermes 官方无人值守配置按钮：`approvals.mode=off` + unattended/single-query/cron approve。
- Worker 本地运行脚本开启 `CWD_ALLOW_DANGER_FULL_ACCESS=1`；原生 `worker_delegate` 默认请求 `danger-full-access`，仍只绑定 loopback。
- 原生 Hermes 插件工具：`worker_delegate`、`worker_status`、`worker_catalog`，让 Hermes 本身也能正式派工。

> **权限边界**：Hermes 的 hardline blocklist 是官方不可绕过的安全底线。这里的“完全访问/无人值守”表示关闭正常交互审批并允许无人值守执行，不伪造“可以绕过官方不可绕过规则”。

## 为什么是“官方优先”

本项目只保留薄适配层：

1. **Web 扩展**：Hermes Dashboard `manifest.json` / `tab.override` / `window.__HERMES_PLUGIN_SDK__`。
2. **历史与搜索**：Hermes Dashboard `/api/sessions`、分页消息、FTS 搜索、归档。
3. **对话与工作流**：Hermes API Server `/api/sessions/*`、`/chat/stream`、`/model`、`/v1/capabilities`。
4. **模型**：Hermes `/api/model/options` + 官方 Custom Endpoint API；Worker 自己的真实 capability registry。
5. **扩展 Agent 能力**：Hermes `plugin.yaml + register(ctx)` 原生插件接口。
6. **Worker**：只调用 `codex-worker-delegation` 已公开的 HTTP 控制接口，不读写其内部文件。

因此 Hermes 或 Worker 内部目录、SQLite schema、React 私有组件重构时，本项目通常不需要跟着修改。

## 安装

### 1. 前置条件

- 已安装并可运行 Hermes Agent Web Dashboard。
- Hermes API Server 已开启，默认 `127.0.0.1:8642`。
- 已部署 `Shermanxwz/codex-worker-delegation`，默认 `127.0.0.1:8788`。
- Python 3.11+；Node 仅用于开发期静态语法校验，运行时前端是预构建 IIFE。

示例环境见 `deploy/worker-studio.env.example`。

### 2. 安装插件

```bash
./scripts/install.sh
```

脚本会复制到：

```text
$HERMES_HOME/plugins/hermes-worker-studio
$HERMES_HOME/dashboard-themes/hermes-worker-studio.yaml
```

如果本机有 `hermes` 命令，安装脚本会执行官方：

```bash
hermes plugins doctor <plugin-path> --ci
hermes plugins enable hermes-worker-studio
```

### 3. 启动 Worker（本机无人值守）

```bash
CWD_REPO=/path/to/codex-worker-delegation ./scripts/run-worker-local.sh
```

该脚本固定 Worker 控制面在 `127.0.0.1:8788`，并设置：

```text
CWD_REQUIRE_AUTH=0
CWD_ALLOW_DANGER_FULL_ACCESS=1
```

远程 Worker/API Server 默认被本插件拒绝。如确实跨主机部署，必须显式设置：

```text
HERMES_WORKER_STUDIO_ALLOW_REMOTE=1
```

并自行使用受保护网络、TLS/反向代理和独立 token。

## 运行入口

安装并重启/刷新 Hermes Dashboard 后，Hermes 自己的 `/` 会继续按官方路由进入 `/sessions`；本插件通过官方 `tab.override: /sessions` 接管该页面，因此无需修改 Hermes 路由器。

侧边栏：

```text
新建对话
搜索对话
当前对话
完整历史对话
已归档对话
Worker 路由
────────────
Skills
Plugins
MCP
更多…
```

## New API 与路由统一

在 **Worker 路由** 页面：

1. 输入 New API Base URL 和 API Key。
2. 保存后 Worker 从上游真实模型接口刷新目录。
3. 页面显示实际模型；可逐模型测试连通性。
4. 同一模型目录供 Main / Worker / Verifier 与对话顶部模型选择器使用。
5. reasoning 滑块 = `Auto + 上游实际 capability`。
6. 对话顶部修改 Main 模型时，非 `OFFICIAL` Worker 模式会同步保存 Main route。
7. 同一 New API 会通过 Hermes 官方 Custom Endpoint API 建立/更新对应 endpoint，供 Hermes Session model lock 使用。

## 性能策略

日常页故意不加载完整历史：

| Surface | 默认读取 |
|---|---:|
| 左侧最近对话 | 10 个 |
| 当前对话 | 最近 40 条消息 |
| 完整历史列表 | 20 个/页 |
| 完整历史消息 | 100 条/页 |

完整检索由 Hermes 自己的 SQLite/FTS5 完成，不在浏览器内扫描历史。

## 验证

仓库 CI 会执行：

```bash
python -m py_compile __init__.py schemas.py tools.py dashboard/plugin_api.py
node --check dashboard/dist/index.js
python scripts/verify_contract.py
bash -n scripts/install.sh scripts/run-worker-local.sh
```

在目标 Hermes 主机还应执行：

```bash
hermes plugins doctor . --ci
```

然后按 `docs/SEAL_CHECKLIST.md` 做一次实机验收。**GitHub CI 无法替代你机器上的 Hermes + API Server + New API + Worker 端到端运行验证。**

## 目录

```text
plugin.yaml                 Hermes 原生插件声明
__init__.py / schemas.py    Hermes 原生 Worker tools
tools.py                    Worker 控制面客户端
dashboard/manifest.json     官方 Web Dashboard 插件声明
dashboard/plugin_api.py     API Server / Worker 的安全薄代理
dashboard/dist/*            预构建 Web UI
themes/*                    可选深色主题
scripts/*                   安装、启动、合同静态检查
docs/*                      架构、上游合同、封存验收
```

## 设计文档

- [架构与数据流](docs/ARCHITECTURE.md)
- [上游官方合同](docs/UPSTREAM_CONTRACTS.md)
- [封存级验收清单](docs/SEAL_CHECKLIST.md)
