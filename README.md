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
- Python 3.11+；Node 仅用于开发期静态语法校验和测试，运行时前端是预构建 IIFE。

示例环境见 `deploy/worker-studio.env.example`。

### 2. 安装插件

```bash
bash scripts/install.sh
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
CWD_REPO=/path/to/codex-worker-delegation bash scripts/run-worker-local.sh
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

## 全线自动化验证

CI 不再只做语法检查。当前 `main` 的门禁分成五条独立链路：

1. **Studio static + integration + UI runtime**：静态合同、28+ Python 单元/HTTP/安装测试、实际预构建 Dashboard bundle 的 jsdom/React 运行时行为测试、npm 高危审计。
2. **Pinned Hermes + Worker public contracts**：按 `tests/upstream-lock.json` 精确 checkout 上游 commit，并验证本项目依赖的官方公共合同仍存在。
3. **Worker upstream tests + live control plane**：运行 Worker 自己的完整测试/check；确认 hosted runner 没有实机证据时 production/archive seal 必须 fail-closed；随后真正启动 pinned Worker HTTP 控制面，再让 Studio proxy 与原生 tool 对其做 live smoke。
4. **Hermes real Plugin Doctor**：安装 pinned Hermes 运行时，使用 Hermes 自己的 Plugin Doctor 动态加载本项目并核对三个原生 Worker tools。
5. **Production security static analysis**：Bandit 生产 Python 扫描 + 常见误提交密钥扫描。

固定兼容基线目前为：

```text
Hermes Agent 0.20.6
commit 4f22543509d1b91dc45bcb369447126c5eb14fb7

codex-worker-delegation 3.2.0
commit e965517e5bddeda57f5bc2b015a817279ea8e6e5
```

完整覆盖矩阵见 `docs/AUTOMATED_TEST_MATRIX.md`。

**CI 全绿的精确定义是“archive candidate”，不是伪造“目标机器已经 sealed”。** 真正封存仍要求在目标主机用真实 Hermes 账号、API Server、历史数据、New API、Worker、浏览器和服务管理环境完成 `docs/SEAL_CHECKLIST.md`，并保存证据包。

## 本地仓库验证

基础验证：

```bash
python -m compileall -q __init__.py schemas.py tools.py dashboard scripts tests
node --check dashboard/dist/index.js
bash -n scripts/install.sh scripts/run-worker-local.sh
python scripts/verify_contract.py
python -m unittest discover -s tests -p 'test_*.py' -v
```

如果要运行 Dashboard 运行时测试：

```bash
npm install --ignore-scripts --no-fund
npm run test:frontend
npm audit --audit-level=high
```

目标 Hermes 主机至少还必须执行：

```bash
hermes plugins doctor . --ci
```

然后逐项完成 `docs/SEAL_CHECKLIST.md`。**GitHub CI 无法替代目标机器上的真实凭据、真实模型、真实历史数据和真实浏览器/服务恢复测试。**

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
tests/*                     单元、HTTP、UI runtime、real Worker smoke、上游锁定验证
docs/*                      架构、上游合同、安全边界、自动测试矩阵、封存验收
```

## 设计与验证文档

- [架构与数据流](docs/ARCHITECTURE.md)
- [上游官方合同](docs/UPSTREAM_CONTRACTS.md)
- [安全与信任边界](docs/SECURITY.md)
- [全线自动化测试矩阵](docs/AUTOMATED_TEST_MATRIX.md)
- [封存级验收清单](docs/SEAL_CHECKLIST.md)
