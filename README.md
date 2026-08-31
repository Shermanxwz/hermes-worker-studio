# Hermes Worker Studio 2.0

面向长期封存的 **Hermes 原生 Web 工作台**。项目只做产品壳、官方能力编排和有界 UI 状态投影；不 fork Hermes、不读私有数据库、不 import 私有 `AIAgent`/delegation 实现、不维护第二套 Worker runtime、模型目录或 Provider 客户端。

## 核心原则

> 能由 Hermes 公共接口解决的，绝不在 Studio 里重新实现。

唯一运行时上游为 `NousResearch/hermes-agent`。精确基线记录在 `tests/upstream-lock.json`。

```text
Dashboard Plugin SDK
        │
        ├── Sessions / Search / Archive
        ├── Models / Custom Endpoints
        ├── Skills / Plugins / MCP
        ├── Approvals / Config
        │
        ▼
   Hermes /v1/runs
        │
        ├── tool / todo / approval / subagent events
        └── Hermes Session transcript

Hermes Main
   ├── native delegate_task
   ├── PluginContext.subagent_lifecycle  ← worker_delegate/status
   ├── /review + auxiliary.review.*
   └── Kanban + Profiles（持久任务）
```

不存在第二执行内核：不需要独立 Worker sidecar、额外 App Server、第二模型 registry 或额外 OAuth/runtime。

## 四模式

| UI | Hermes 原生语义 |
|---|---|
| `OFFICIAL` | Studio delegation policy 休眠，交还 Hermes 原生 `delegate_task` / 默认行为 |
| `AUTO` | Studio 允许 `worker_delegate`，Main 按需要启动 Hermes child agent |
| `WORKER` | wire=`DELEGATE`，强调 Main 协调、Hermes child agent 执行 |
| `MAIN` | 通过 Hermes `pre_tool_call` policy hook 阻止新的 `delegate_task` / `worker_delegate` |

模式不是前端装饰。`MAIN`/`OFFICIAL` 的边界在 Hermes 官方 hook 执行边界强制。

## 模型 / New API

Studio 不维护本地模型表。唯一真相源：

```text
Hermes Custom Endpoint API
        ↓
/api/model/options?refresh=1
        ↓
对话 / Worker / Review 共用模型目录
```

- New API Base URL + Key 使用 Hermes `/api/providers/custom-endpoints` 保存/验证。
- 模型连通性使用最小真实 `/v1/runs` 指定 `provider + model`，验证完整 Hermes 生成链路。
- 对话使用 Hermes Session model lock / Run request model fields。
- Worker 路由写入 Hermes `delegation.*`。
- Reviewer 路由写入 Hermes `auxiliary.review.*`。
- Reasoning **不猜**。只有上游明确给出可选档位时才显示滑块；否则严格显示 `Auto`。

## 对话与工作过程

性能策略：

| Surface | 默认读取 |
|---|---:|
| 最近对话 | 10 个 |
| 当前对话 | 最近 40 条消息 |
| 完整历史 | 20 会话/页 |
| 完整历史消息 | 100 条/页 |

完整历史使用 Hermes 官方分页；搜索使用 `/api/sessions/search`；归档使用 Hermes archive 字段/API。

工作过程只展示 Hermes 可观察的真实事件，不展示或伪造隐藏推理：Run lifecycle、tool lifecycle、`todo.updated`、approval、subagent、Skills 变化等。运行中显示真实 elapsed time；终态后冻结时长并自动折叠。

## 侧边栏

一级：

- 对话
- Worker
- 模型
- 无人值守
- 技能
- 插件
- MCP
- 完整历史（内部含搜索/已归档）

二级“更多”：自动化/Cron、Profiles、Analytics、Logs、Config、Docs。

`Keys / Providers` 不单独重复出现；密钥/Provider/New API 属于“模型”。无人值守保持一级显眼入口并显示状态。

## 无人值守

Studio 只写 Hermes 官方配置，并读回验证：

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

随后通过 authenticated `/hermes/unattended/probe` 发起真实 Hermes Run，要求 Hermes 执行随机临时 marker；只有 Run 终态成功且 marker 存在才返回 `UNATTENDED_READY`。

Hermes **Hardline Blocklist 永久保留**，Studio 不绕过、也不声称绕过。

## 官方原生入口

- Dashboard：官方 Plugin SDK `tab.override=/sessions`
- 执行：`POST /v1/runs`、status、SSE events、stop、approval、steer
- Worker：`PluginContext.subagent_lifecycle`
- 原生 delegation：`delegate_task`
- Reviewer：`/review` / `auxiliary.review.*`
- 模型：`/api/model/options`
- New API：`/api/providers/custom-endpoints`
- 历史：`/api/sessions` + search/archive/messages pagination
- Skills / Plugins / MCP：Hermes 官方页面/API
- 无人值守：Hermes approvals/config

Browser 只通过 Dashboard SDK / plugin API 调用；API Server bearer secret 不进入前端。

## 安装

```bash
bash scripts/install.sh
```

安装器执行 staged `hermes plugins doctor`、原子替换、`hermes plugins enable hermes-worker-studio`、最终 doctor。运行时只需 Hermes API Server：

```text
HERMES_WORKER_STUDIO_API_URL=http://127.0.0.1:8642
HERMES_WORKER_STUDIO_API_KEY=<same as API_SERVER_KEY>
```

默认仅允许 loopback；远程桥接必须显式 `HERMES_WORKER_STUDIO_ALLOW_REMOTE=1`。

## 封存门禁

PR/main CI 必须全部通过：

1. Python/JS/Shell syntax、静态 archive contract、unit/HTTP/integration、jsdom 产品流、npm audit。
2. 精确 Hermes snapshot 与公共接口语义验证。
3. Hermes 自身 subagent lifecycle、Runs、approval tests + Plugin Doctor。
4. Bandit、secret gate、第二执行内核残留 gate。

静态合同会直接拒绝生产文件重新出现独立 Worker runtime 标志、私有 delegation import、重复模型 registry 或硬编码 reasoning ladder。

GitHub CI 全绿 = **ARCHIVE CANDIDATE**。真实目标机完成 `docs/SEAL_CHECKLIST.md` 中的 authenticated Runs、New API、unattended marker、restart/rollback 等证据后，才可标记 **SEALED**。

## 本地复现

```bash
python -m compileall -q __init__.py schemas.py tools.py dashboard scripts tests
node --check dashboard/dist/index.js
node --check tests/frontend_runtime.mjs
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

- `docs/ARCHITECTURE.md` — 架构与数据流
- `docs/UPSTREAM_CONTRACTS.md` — Hermes 公共合同清单
- `docs/SECURITY.md` — 信任边界
- `docs/AUTOMATED_TEST_MATRIX.md` — CI 验收矩阵
- `docs/SEAL_CHECKLIST.md` — 目标机最终封存验收
