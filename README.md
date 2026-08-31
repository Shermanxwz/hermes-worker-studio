# Hermes Worker Studio 3.0

面向长期封存的 **Hermes 原生 Web 工作台**。项目只做产品壳、官方能力编排和有界 UI 状态投影；不 fork Hermes、不读私有数据库、不 import 私有 `AIAgent`/delegation 实现、不维护第二套 Worker runtime、模型目录或 Provider 客户端。

> 能由 Hermes 公共接口解决的，绝不在 Studio 里重新实现。

唯一运行时上游是 `NousResearch/hermes-agent`，精确基线记录在 `tests/upstream-lock.json`。

```text
Hermes Dashboard Plugin SDK
          │
          ├── Sessions / Search / Archive
          ├── Models / Custom Endpoints
          ├── Skills / Plugins / MCP
          ├── Approvals / Config
          │
          ▼
     Hermes /v1/runs
          │
          ├── lifecycle / tool / approval / subagent events
          └── canonical todo + Session transcript

Hermes Main
   ├── native delegate_task
   ├── PluginContext.subagent_lifecycle  ← worker_delegate/status
   ├── /review + auxiliary.review.*
   └── Profiles / Cron / native Dashboard surfaces
```

不存在第二执行内核：不需要独立 Worker sidecar、额外 App Server、第二模型 registry 或额外 OAuth/runtime。

## Product 3 Web

Product 3 通过官方 Dashboard Plugin 合同拥有产品首页：

- `/`：Hermes Worker Studio；
- `/sessions`：原生 Hermes Dashboard 会话页；
- 原生页通过官方 `header-left` slot 显示 `← Worker Studio`；
- Studio 的“高级”区域保留 Sessions、Cron、Profiles、Analytics、Logs、Config、Docs 等原生入口。

前端 Product 3 入口为 `dashboard/dist/index-v3.js`，API bridge 为 `dashboard/plugin_api_v3.py`。Browser 只通过 Dashboard SDK / plugin API 调用；API Server bearer secret 不进入前端。

## 四模式

| UI | Hermes 原生语义 |
|---|---|
| `OFFICIAL` | Studio delegation policy 休眠，完全交还 Hermes 原生 `delegate_task` / 默认行为 |
| `AUTO` | Main 自主判断是否启动 Hermes child agent；Studio 不替换 planner |
| `WORKER` | wire=`DELEGATE`，偏好 Main 协调、Hermes child agent 执行 |
| `MAIN` | 通过 Hermes `pre_tool_call` policy hook 阻止新的 `delegate_task` / `worker_delegate` |

模式不是前端装饰。执行边界仍由 Hermes 官方 hook / `PluginContext.subagent_lifecycle` 强制。

## 模型 / Custom Endpoint

Studio 不维护本地模型表。唯一真相源：

```text
Hermes Custom Endpoint API
        ↓
/api/model/options?refresh=1
        ↓
对话 / Worker / Verifier 共用 Hermes 模型目录
```

- Base URL + Key 使用 Hermes `/api/providers/custom-endpoints` 验证、保存、激活、编辑和删除；
- 粘贴 `/v1/responses`、`/responses`、`/models` 等常见末端路径时，UI 会归一化到正确 endpoint base；
- 模型连通性使用最小真实 Hermes `/v1/runs`；
- Worker 路由写入 Hermes `delegation.*`；
- Verifier 路由写入 Hermes `auxiliary.review.*`；
- Reasoning 不猜档位，只使用 Hermes/provider 明确暴露的能力；否则保持 `Auto`。

## 对话与真实工作过程

默认读取边界：

| Surface | 默认读取 |
|---|---:|
| 最近对话 | 20 个 |
| 当前对话 | 最近 80 条消息 |
| 完整历史 | 30 会话/页 |
| 完整历史消息 | 100 条/页 |

完整历史、搜索、归档、会话 CRUD 全部走 Hermes 官方 Session API。

运行过程只展示 Hermes 可观察事件，不展示或伪造隐藏推理：Run lifecycle、tool lifecycle、approval、subagent、Skills 变化以及 canonical todo。

### 官方计划

Studio **没有自己的 planner**。

1. 如果 Hermes public `/v1/runs` 暴露 canonical `todo.updated`，直接使用；
2. 当前 pinned Hermes Runs 尚未暴露该 snapshot 时，只读取公共 Session API 中 Hermes 自己 `todo` tool 的持久化 `{todos, revision}` 结果，并投影为 `todo.snapshot`、`source=hermes_session_api`。

Run 开始前先记录 todo revision baseline，后续只投影更高 revision。上游直接 Runs-event 增强仍跟踪 `NousResearch/hermes-agent#99686`，但不是封存 blocker，因为 fallback 同样来自 Hermes canonical public state，而不是 Studio 推断。

## 完全访问（Full Access）

一级入口“完全访问”只写 Hermes 官方配置，并读回验证：

```yaml
approvals:
  mode: off
  cron_mode: approve
  single_query_mode: approve
  unattended_mode: approve
  mcp_reload_confirm: false
  destructive_slash_confirm: false

delegation:
  subagent_auto_approve: true
```

开启前保存原审批配置；关闭时恢复。开启后通过 authenticated `/hermes/unattended/probe` 发起真实 Hermes Run 并验证临时 marker，只有真实链路通过才报告可无人值守。

Hermes **Hardline Blocklist 永久保留**，Studio 不绕过、也不声称绕过。

## 图片 / Stop / Steer / Approval

Product 3 支持：

- 图片 picker、拖放、剪贴板粘贴、预览/移除；
- PNG/JPEG/WebP/GIF/BMP，单文件上限 25 MiB；
- structured multimodal input 原样进入 Hermes `/v1/runs`；
- 运行中 Stop；
- 运行中再次发送作为 Hermes steer；
- 官方 Run approval choices；
- 自动滚动暂停/恢复与回到底部。

## 安装

```bash
bash scripts/install.sh
```

安装器执行 staged `hermes plugins doctor`、原子替换、`hermes plugins enable hermes-worker-studio`、最终 doctor。它还会：

- 将 staged Product 3 bridge 写入当前 git candidate SHA；
- 将安装版 favicon 指向官方 Hermes Web `/favicon.ico`；
- 不复制独立 Worker Studio favicon，也不修改 Hermes core 文件。

运行时只需 Hermes API Server：

```text
HERMES_WORKER_STUDIO_API_URL=http://127.0.0.1:8642
HERMES_WORKER_STUDIO_API_KEY=<same as API_SERVER_KEY>
```

默认仅允许 loopback；远程桥接必须显式 `HERMES_WORKER_STUDIO_ALLOW_REMOTE=1`。

## 封存级闭环

GitHub CI 全绿只是 **ARCHIVE CANDIDATE**。最终封存要求真实目标机也证明同一个 commit。

在目标 Hermes 机器、精确候选分支 checkout 上执行：

```bash
python scripts/seal_close.py --url http://127.0.0.1:19119
```

或：

```bash
npm run seal:close -- --url http://127.0.0.1:19119
```

这个命令会闭环执行：

```text
clean git candidate
  ↓
atomic install + candidate SHA stamp
  ↓
running Dashboard candidate read-back
  ↓
real Hermes Run + 3-step canonical todo revisions
  ↓
session CRUD cleanup
  ↓
desktop Chromium + Pixel 7 Playwright
  ↓
independent cross-evidence verifier
  ↓
.seal/SEALED.json  eligible=true
```

产物：

- `.seal/target.json`：真实 Hermes execution / Session / todo 证据；
- `.seal/ui-report.json`：真实 Dashboard Playwright JSON；
- `.seal/playwright-artifacts/`：成功截图 / 失败 trace 等；
- `.seal/SEALED.json`：独立 verifier 的最终 verdict。

可单独复核：

```bash
python scripts/verify_seal_evidence.py
# 或 npm run seal:verify
```

PR 只有在 **精确 PR head CI 全绿** 且目标机 `.seal/SEALED.json` 对同一 SHA 返回 `eligible: true` 后，才可标记 `SEALED`、Ready 并合并。

完整门禁见 `SEAL_ACCEPTANCE.md`。

## 本地复现

```bash
python -m compileall -q __init__.py schemas.py tools.py dashboard scripts tests
node --check dashboard/dist/index-v3.js
node --check tests/frontend_runtime.mjs
node --check tests/frontend_runtime_v3.mjs
node --check tests/frontend_product_v3.mjs
node --check tests/frontend_settings_v3.mjs
node --check playwright.seal.config.mjs
node --check tests/target_ui.spec.mjs
bash -n scripts/install.sh
python scripts/verify_contract.py
python -m unittest discover -s tests -p 'test_*.py' -v
npm install --ignore-scripts --no-fund
npm run test:frontend
npm audit --audit-level=high
hermes plugins doctor . --ci
```

上游合同：

```bash
python scripts/verify_upstreams.py --hermes-root /path/to/pinned/hermes-agent
```

## 文档

- `SEAL_ACCEPTANCE.md` — Product 3 最终封存合同与一键闭环
- `docs/ARCHITECTURE.md` — 架构与数据流
- `docs/UPSTREAM_CONTRACTS.md` — Hermes 公共合同清单
- `docs/SECURITY.md` — 信任边界
- `docs/AUTOMATED_TEST_MATRIX.md` — CI 验收矩阵
