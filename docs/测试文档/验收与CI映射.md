# 验收与 CI 映射（测试先行）

本文档把“规格（需求/语义/安全）”映射到“自动化测试用例与 CI 门禁”，用于作为每次迭代的验收标准与回归基线。

## 约定
- PR 必跑：所有提交都必须通过的门禁（保证主干可用与可回归）。
- Nightly：依赖外部服务（PostgreSQL/MySQL/Neo4j/Milvus）的全链路测试，避免拖慢 PR。
- Release：跨平台打包与产物校验（Windows/macOS）。
## 规格到测试映射

| 规格/目标 | 自动化测试落点 | CI 门禁 | 备注 |
|---|---|---|---|
| 上下文装配语义（文本拼接、缺失变量定位、trace 片段） | `context-engine` 单测（已存在）与 `server-rs` `/api/execute` 集成测试（新增） | PR 必跑 | 引擎/服务两条路径都要稳定 |
| 变量执行（dynamic resolver 的错误映射与回退占位） | 前端 Vitest（补齐对 resolver 的 mock 测试）；后端后续下沉后由 `server-rs` 覆盖 | PR 必跑 | M2 后以服务端执行为主 |
| SQL 只读限制（禁止写操作） | `server-rs/tests/security_and_limits.rs::sql_query_rejects_non_select`（新增） | PR 必跑 | 统一错误码 `readonly_required` |
| SQL 资源限制（rowLimit 上限） | `server-rs/tests/security_and_limits.rs::sql_query_row_limit_is_clamped`（新增） | PR 必跑 | 上限 1000 |
| 数据源敏感信息脱敏（URL 不出现在响应中） | `server-rs` 数据源集成测试（已存在 + 新增 get 覆盖） | PR 必跑 | `url` 必为 `<redacted>` |
| 静态资源安全头（nosniff/deny/no-referrer/permissions-policy） | `server-rs/tests/security_and_limits.rs::static_responses_include_security_headers`（新增）+ docker job 断言（新增） | PR 必跑 | 防止回归到不安全默认 |
| 静态资源缓存策略（index no-cache / assets immutable / wasm MIME） | `server-rs/tests/static_spa.rs`（已存在）+ docker job 断言（已存在） | PR 必跑 | 线上性能与正确性 |
| 数据导入（Dataset/ImportJob、限额、回滚） | 规范：[数据导入规范.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/测试文档/数据导入规范.md)；自动化测试：SQLite 端到端 + 负向用例（新增） | PR 必跑 | PR 不依赖外部服务，先锁 SQLite |
| 数据源能力（SQL/Neo4j/Milvus 浏览与抽取） | 规范：[数据源能力规范.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/测试文档/数据源能力规范.md)；PR：feature gate 契约测试（已存在/持续补齐） | PR 必跑 | 外部端到端放 Nightly |
| 变量抽取 DSL/Builder（错误码、回退、依赖环） | 规范：[变量抽取DSL与Builder规范.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/测试文档/变量抽取DSL与Builder规范.md)；`server-rs/tests/preview_execute.rs` + `server-rs/tests/variable_library_crud.rs`（持续补齐） | PR 必跑 | 以 trace 契约作为断言核心 |
| Projects/Sessions 回放（跨端一致、chat 变量） | 规范：[Projects与Sessions回放规范.md](file:///Users/jingshun/Desktop/上下文工程项目/docs/测试文档/Projects与Sessions回放规范.md)；projects/sessions API 端到端回归（持续补齐） | PR 必跑 | 作为“可复现”的核心门禁 |

## CI 分层建议（当前仓库已基本具备）

### PR 必跑
- 前端：`pnpm check`、`prettier --check`、`verify-wasm-sync`、`pnpm test`、`vite build`
- Rust：fmt、clippy、test（`server-rs` 与 `context-engine`）
- Docker：容器启动 + healthz + SPA fallback + execute + 缓存头 + wasm MIME + 安全头

### Nightly
- Postgres/MySQL：SQLX Any 的集成冒烟（已存在）
- Neo4j/Milvus：已接入 Nightly 全链路回归（`.github/workflows/nightly.yml` + `server-rs/tests/nightly_external_integrations.rs`）

### Release
- Windows/macOS：桌面端打包与产物归档（`.github/workflows/release-desktop.yml`）；如需要可在此层加入签名与启动自检
