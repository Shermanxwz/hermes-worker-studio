# Hermes Worker Studio

面向长期封存的 Hermes Agent Web 工作台：**不 fork Hermes Web、不复制 Hermes 私有数据库、不伪造模型/Reasoning 能力、不把第三方线程冒充官方根代理**。对话、历史、搜索、Skills / Plugins / MCP 继续建立在 Hermes 官方 Dashboard / API Server / Plugin SDK 上；项目管理的派工只通过 `codex-worker-delegation` 的公开控制面接入。

目标不是做一个“看起来像 Hermes”的平行实现，而是把 Hermes 官方可维护接口、真实 Runs 生命周期、Worker 四模式和可复现封存门禁组合成薄产品层。

## 封存架构

### Hermes 是根代理

Hermes Worker Studio 的根对话始终由 **Hermes Agent** 执行。当前 Hermes 宣告 `run_submission` 时，执行主链路是官方 Runs API：

```text
Dashboard Plugin SDK
  -> Studio authenticated plugin API
  -> POST /v1/runs
  -> GET /v1/runs/{run_id}
  -> GET /v1/runs/{run_id}/events
  -> /stop | /approval | /steer
  -> Hermes Session transcript
```

只有运行中的 Hermes `/v1/capabilities` **明确不支持 native Runs** 时，Studio 才使用旧版 `/api/sessions/{id}/chat/stream` 兼容路径。一次 native Run 失败绝不会被静默重放到 legacy 路径。

Hermes `/v1/runs/{id}` 是终态真相；Studio 仅保留有界的实时事件投影用于 UI。SSE 断流不会被伪造为成功。

### Worker 是独立委派控制面

`codex-worker-delegation` 不替代 Hermes 根代理。Worker 的 Official/Third-party Main、Worker、Verifier 路由属于 Codex/Worker 控制面；Hermes 自己的模型解析仍使用 Hermes 官方 `/api/model/options` 和 Session model lock。

这使两边 provenance 清晰：

- Hermes Main = Hermes 官方 Agent runtime。
- Worker/Codex Main = `codex-worker-delegation` README 定义的 Main。
- Third-party Worker/Codex thread 保留其 App Server provenance，不冒充 Hermes 官方 provider 或 native subagent。

## 四种 Worker 模式

Web 的 `WORKER` 对应 Worker 内部 wire mode `DELEGATE`。语义严格跟随 `codex-worker-delegation` README：

| UI 模式 | Wire mode | 项目管理的 Worker delegation | 语义 |
|---|---|---:|---|
| `OFFICIAL` | `OFFICIAL` | 禁止 | Worker 插件休眠；路由交还原生 Hermes/Codex 默认 |
| `AUTO` | `AUTO` | 允许 | Main 正常工作；需要时按真实路由委派 Worker / Verifier |
| `WORKER` | `DELEGATE` | 允许 | Main 协调，Worker 执行；显式项目协作模式 |
| `MAIN` | `MAIN` | 禁止 | 只允许 Main；禁止新的项目 Worker / native subagent 执行 |

这个边界不是只靠前端：

1. Studio 后端 `/worker/start` 每次重新读取真实 `/api/state`；
2. Hermes 原生 `worker_delegate` 每次也重新读取 `/api/state`；
3. OFFICIAL / MAIN / 未知模式均 fail-closed；
4. Worker 自己仍保留其上游后端强制逻辑。

因此绕过 UI 直接调用 Studio API 或 Hermes native tool 也不能跨越模式边界。

**OFFICIAL 故障隔离**：Worker `127.0.0.1:8788` 不可用时，Studio 把它标成 delegation degraded，不把 Hermes 本身判死。历史、搜索、归档和不依赖 Worker 的 Hermes 对话仍属于独立故障域。

## 已实现的官方接入

- `/sessions` 通过 Hermes **Dashboard Plugin SDK** 的 `tab.override` 覆盖；不 patch Hermes 核心文件。
- 浏览器调用 `SDK.fetchJSON`，不读取 API Server / Worker bearer secret。
- 最近对话 **10** 条；当前对话最近 **40** 条；完整历史 **20 会话/页**、**100 消息/页**。
- Hermes 官方 `/api/sessions/search` FTS 搜索和官方 archive PATCH / `archived=only`。
- Hermes native `/v1/runs` 主链路、Run status、SSE events、Stop、Approval、Steer。
- `/health/detailed` readiness 转发和 `/v1/capabilities` feature discovery。
- Hermes `/api/model/options` +官方 Custom Endpoint API；不维护本地 Hermes 模型表。
- Worker `/api/catalog` 真实 capability registry；Reasoning 只读取上游 `reasoning.options`，`Auto` 是唯一 Studio sentinel。
- Worker New API 保存、probe、逐模型 connectivity；API Key 输入成功后清空。
- Hermes 官方 Skills / Plugins / MCP 页面保持原生入口；CI 直接运行 pinned Hermes 自己的 Skills API/editor 测试。
- Hermes native plugin tools：`worker_delegate`、`worker_status`、`worker_catalog`。
- 安装器使用 `hermes plugins doctor` + `hermes plugins enable`，支持 staged validation、原子替换和回滚。
- Loopback-first：Hermes 默认 `127.0.0.1:8642`，Worker 默认 `127.0.0.1:8788`；远程必须显式 opt-in。

## 无人值守 / 全授权边界

Web 可以写入 Hermes 官方 approval 配置：

```yaml
approvals:
  mode: off
  cron_mode: approve
  single_query_mode: approve
  unattended_mode: approve
  mcp_reload_confirm: false
  destructive_slash_confirm: false
```

Studio 另外提供 authenticated server-side **真实 Hermes unattended probe**：

```text
POST /api/plugins/hermes-worker-studio/hermes/unattended/probe
{"confirm":"RUN_SAFE_UNATTENDED_PROBE"}
```

它不会由 Studio 自己执行 shell。它启动真正的 Hermes `/v1/runs`，要求 Hermes 执行一个随机临时目录中的无害 marker 命令，然后轮询 Hermes Run 终态并验证 marker；通过才返回 `UNATTENDED_READY`。

> Hermes hardline blocklist 仍是上游永久安全底线。Studio 不 patch、不绕过，也不声称能够绕过。

目标机最终封存必须同时保存 config read-back 和 real probe 证据；仅“PUT 配置返回 200”不算无人值守闭环。

## New API 与模型边界

Worker 路由页处理的是 Worker/Codex 控制面：

1. New API Base URL / API Key 写入 Worker 自己的 provider/vault 边界；
2. Worker 从真实上游建立 Model Capability Registry；
3. Main / Worker / Verifier 的 Worker 路由只使用该 registry；
4. Reasoning 只显示该模型真实声明值；未声明即只有 `Auto`；
5. 同一 endpoint 通过 Hermes 官方 Custom Endpoint API 注册给 Hermes；
6. Hermes 对话需要 model override 时，Studio只在 `/api/model/options` 能唯一解析 provider + model 时做 Session model lock；不猜 provider；
7. `OFFICIAL` 模式不写 Studio model/provider override，让 Hermes 官方默认完整接管。

## 性能策略

| Surface | 默认读取 |
|---|---:|
| 左侧最近对话 | 10 个 |
| 当前对话 | 最近 40 条消息 |
| 完整历史列表 | 20 个/页 |
| 完整历史消息 | 100 条/页 |

完整检索由 Hermes 自己的持久层/FTS 完成，Studio 不直读 Hermes SQLite，也不在浏览器扫描完整历史。

## 精确封存基线

机器锁：`tests/upstream-lock.json`。

```text
Hermes Agent 0.20.6 post-release snapshot
snapshot:       4f22543509d1b91dc45bcb369447126c5eb14fb7
official tag:   v2026.8.27
release commit: 5fc308a70719a83cccdbba4c0e39c23f5a8239d5

codex-worker-delegation 3.2.0
commit: e965517e5bddeda57f5bc2b015a817279ea8e6e5
```

Hermes pin 被明确标成 **post-release snapshot**，不是伪装成 release tag。CI 会用真实 Git ancestry 验证 snapshot 继承记录的官方 release commit，并验证我们依赖的 native Runs / API-server unattended / Skills 合同。

## 全线自动化门禁

PR 和 `main` 的 CI 分成五个独立故障域：

1. **Studio static + integration + UI runtime**：compile、JS/Shell syntax、静态 archive contract、Python unit/真实 loopback HTTP integration、安装器、实际 shipped bundle 的 jsdom/React runtime、npm high audit。
2. **Pinned Hermes + Worker public contracts**：精确 checkout lock SHA，验证 release lineage、Hermes 官方 API/SDK 语义以及 Worker README 的四模式/OAuth Main lock/capability/provenance 语义。
3. **Worker upstream tests + four-mode live control plane**：Worker 自己完整 `npm test` + `check`；Hosted runner 的 production/archive seal 必须 fail-closed；启动真实 pinned `:8788` 后逐档切换 `OFFICIAL -> AUTO -> DELEGATE(WORKER) -> MAIN` 并恢复初始 mode。
4. **Hermes native Runs + approvals + skills + Plugin Doctor**：安装 pinned Hermes，直接运行 Hermes 自己的 Runs、approval、Skills tests，再用 Hermes real Plugin Doctor 动态加载本插件并核对 native tools。
5. **Production security static analysis**：Bandit + obvious-secret rejection。

完整矩阵见 `docs/AUTOMATED_TEST_MATRIX.md`。

**所有 Hosted CI 全绿的定义是 `ARCHIVE CANDIDATE`，不是目标机器 `SEALED`。** GitHub runner 无法诚实证明你的真实 Hermes account/OAuth、真实 provider/New API credential、真实历史数据、真实浏览器认证、宿主机权限和 service restart/rollback。最终 `SEALED` 必须完成 `docs/SEAL_CHECKLIST.md` 并保留证据。

## 安装

前置：Hermes Dashboard/API Server、pinned/兼容 Worker、Python 3.11+。Node 只用于开发和 CI；运行时前端是预构建 IIFE。

```bash
bash scripts/install.sh
```

安装器复制到：

```text
$HERMES_HOME/plugins/hermes-worker-studio
$HERMES_HOME/dashboard-themes/hermes-worker-studio.yaml
```

存在 `hermes` 命令时自动运行：

```bash
hermes plugins doctor <staged-plugin-path> --ci
hermes plugins enable hermes-worker-studio
hermes plugins doctor <installed-plugin-path> --ci
```

本机 Worker：

```bash
CWD_REPO=/path/to/codex-worker-delegation bash scripts/run-worker-local.sh
```

默认仅 loopback；远程桥必须显式：

```text
HERMES_WORKER_STUDIO_ALLOW_REMOTE=1
```

并由部署者提供 TLS/私网和独立认证。

## 本地复现

```bash
python -m compileall -q __init__.py schemas.py tools.py dashboard scripts tests
node --check dashboard/dist/index.js
bash -n scripts/install.sh scripts/run-worker-local.sh
python scripts/verify_contract.py
python -m unittest discover -s tests -p 'test_*.py' -v
npm install --ignore-scripts --no-fund
npm run test:frontend
npm audit --audit-level=high
hermes plugins doctor . --ci
```

上游锁验证需要对应 Hermes/Worker checkout：

```bash
python scripts/verify_upstreams.py --hermes-root /path/to/hermes-agent --worker-root /path/to/codex-worker-delegation
```

## 目录

```text
plugin.yaml                 Hermes 原生插件声明
__init__.py / schemas.py    Hermes native tool 注册/Schema
tools.py                    Worker 控制面客户端 + 四模式 fail-closed
dashboard/manifest.json     Hermes Dashboard Plugin SDK 声明
dashboard/plugin_api.py     Hermes Runs / Worker 安全薄代理与 unattended probe
dashboard/dist/*            预构建官方 SDK Web UI
themes/*                    可选主题
scripts/*                   安装、启动、静态合同/上游锁验证
tests/*                     单元、HTTP、UI runtime、real Worker、upstream lock
docs/*                      架构、安全、自动门禁、目标机 seal
```

## 维护文档

- [架构与数据流](docs/ARCHITECTURE.md)
- [上游官方合同](docs/UPSTREAM_CONTRACTS.md)
- [安全与信任边界](docs/SECURITY.md)
- [全线自动化测试矩阵](docs/AUTOMATED_TEST_MATRIX.md)
- [封存级目标机验收](docs/SEAL_CHECKLIST.md)
