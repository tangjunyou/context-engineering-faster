## 目标与边界
- 目标：在不改变 UI 设计与现有功能的前提下，把后端从 Node/Express 全面替换为 Rust；前端维持 TypeScript 生态（当前已是 React + TS）。
- 边界：不重做页面、不调整交互；仅替换运行时与构建/部署链路。

## 现状结论（基于扫仓）
- 当前“后端”只做两件事：静态资源托管 + SPA history fallback（见 server/index.ts）。
- 项目有 Rust WASM 引擎（wasm-bindgen）被前端直接 import（client/src/lib/wasm），后端需确保 .wasm 正确以静态资源方式提供。
- 前端核心栈已是 TypeScript（React/Vite/Tailwind/shadcn），不需要“换成 TS”，而是保留并稳定化。

## 技术选型调研（Context7 佐证）
### 后端框架：选择 Axum（推荐）
- 选择理由：
  - 生态与可扩展性：Axum 基于 Tokio/Tower/Hyper，后续加中间件、API、鉴权、限流更顺手。
  - 与你们需求匹配：静态托管 + SPA fallback 可用 Router fallback 机制实现（Context7 示例已覆盖 fallback 用法）。
  - 维护成本：路由与中间件组合清晰，适合从“仅静态服务”演进到“静态 + API”。
- 备选：Actix-web
  - 优点：成熟、性能口碑好；
  - 不选原因：你们当前需求更偏 Tower 生态组合（静态文件、可插拔中间件、未来 API），Axum 的生态贴合度更高。

### 静态文件服务：tower-http（与 Axum 生态一致）
- 选择理由：与 Axum 同属 Tower 体系，常用于 ServeDir/压缩/缓存等能力组合。
- 注意：如果 Context7 对 ServeDir 示例检索不稳定，我们会以官方 crates 文档与可运行的最小示例对齐实现细节，并用集成测试验证 SPA fallback 与 wasm MIME。

### 运行时与基础设施库（建议固定）
- Tokio：异步运行时（Axum 依赖栈自然选择）。
- Tracing + tracing-subscriber：结构化日志（替代 Express console/log）。
- Clap（或纯 env）：配置端口、静态目录、日志级别。
- 可选：Rustls（若之后要 HTTPS 直出；当前可先不做）。

## 迁移实施步骤（不改 UI/功能）
### Phase 1：Rust 静态服务端替换（等价替换 Express）
- 新建 Rust server crate（例如 server-rs）：
  - 提供静态目录 dist/public 的文件服务。
  - 实现 SPA history fallback：对非文件路径回退到 index.html（等价于现有 app.get("*")）。
  - 校验 .wasm Content-Type（至少能被浏览器以 application/wasm 正常加载）；必要时补充 header 覆写。
- 保持前端构建产物路径不变（仍输出 dist/public），以最小变更替换生产启动方式。

### Phase 2：构建与本地开发链路对齐
- 保持 pnpm dev 继续走 Vite（开发体验不变）。
- 生产构建：pnpm build 仍产出 dist/public；Rust server 作为生产入口。
- 增加“端到端验收脚本/检查”：
  - 首页可访问；
  - 任意前端路由可直接刷新且不 404（fallback 生效）；
  - WASM 初始化成功（预览面板路径覆盖）。

### Phase 3：为未来 API 预留（不改变现有功能）
- 预留 /api 路由分组与 CORS 配置，但不引入任何新功能。
- 若你们之后要补齐 oauth callback（前端已有 /api/oauth/callback 字符串）：再单独开需求实现。

## 风险点与验证策略
- 风险：WASM MIME/缓存策略导致线上加载失败或回退到低效路径。
  - 验证：本地与生产模式都跑一次“加载 wasm + 执行一次 ContextEngine”用例；检查 network response headers。
- 风险：SPA fallback 误伤静态资源路径（例如 /assets/*）。
  - 验证：对存在的静态文件返回文件；对不存在的路径回退 index.html。

## 交付物清单
- Rust 后端服务：可在生产模式托管 dist/public，并支持 SPA fallback。
- 构建/启动流程更新：Node/Express 产物移除或标记弃用，Rust 作为唯一后端。
- 最小验收测试：覆盖首页、路由刷新、WASM 加载。

如果你确认该方案，我将开始落地实现：创建 Rust server crate、接入构建产物目录、替换生产启动方式，并补齐验证用例。

