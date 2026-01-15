## 现状结论（基于仓库扫读）
- 技术栈已满足“Rust + TypeScript”：后端是 Axum（[server-rs/src/main.rs](file:///Users/jingshun/Desktop/上下文工程项目/server-rs/src/main.rs)、[server-rs/src/lib.rs](file:///Users/jingshun/Desktop/上下文工程项目/server-rs/src/lib.rs)），前端是 Vite + React + TS（[package.json](file:///Users/jingshun/Desktop/上下文工程项目/package.json)）。
- 当前后端本质是“静态站点托管 + SPA 回退”，前端主要能力在浏览器 WASM 引擎（[context-engine/src/lib.rs](file:///Users/jingshun/Desktop/上下文工程项目/context-engine/src/lib.rs)、[client/src/lib/wasm](file:///Users/jingshun/Desktop/上下文工程项目/client/src/lib/wasm)）。
- 当前项目缺少生产级关键要素：Docker/CI、国际化体系、API 路由语义清晰性、安全与可观测性强化、构建产物一致性。

## 生产级问题清单（按风险优先级）
### 1) 路由与安全
- /api 被当作“伪接口”：`/api/**` 全部回退为 `index.html`（[server-rs/src/lib.rs](file:///Users/jingshun/Desktop/上下文工程项目/server-rs/src/lib.rs#L83-L85)），但前端已拼出 OAuth 回调地址 `/api/oauth/callback`（[client/src/const.ts](file:///Users/jingshun/Desktop/上下文工程项目/client/src/const.ts)），未来一旦接入真实鉴权会直接出错。
- CORS 过宽：对 `/api` 允许 `Any origin + Any headers`（[server-rs/src/lib.rs](file:///Users/jingshun/Desktop/上下文工程项目/server-rs/src/lib.rs#L23-L34)），若后续上线真实接口会放大攻击面。

### 2) 构建与可复现
- 缺少 Dockerfile / compose（全仓未发现），生产部署不可复制。
- WASM 产物“双份”存在（[context-engine/pkg](file:///Users/jingshun/Desktop/上下文工程项目/context-engine/pkg) 与 [client/src/lib/wasm](file:///Users/jingshun/Desktop/上下文工程项目/client/src/lib/wasm)），容易出现“Rust 源码与前端使用的 wasm 不一致”。
- 仓库内出现 target/dist 等构建目录（虽已在 .gitignore 中忽略），需要确保不进入 Docker build context，避免镜像膨胀与缓存失效。

### 3) 国际化（中英双语）缺失
- 项目目前没有完整 i18n 框架；仅在少数组件存在 locale 相关字符串（例如 calendar 使用 `toLocaleString`）。

### 4) 测试与质量门禁缺失
- 依赖里有 vitest，但仓库几乎没有测试用例与 CI 工作流（.github/workflows 不存在）。

## 技术选型调研（已用 Context7）
### 后端：Axum + Tower 生态（维持现状，并补齐生产能力）
- Context7：Axum fallback/route_service 等文档表明 Router 的 fallback 模型适合做 SPA fallback，以及将 tower-http 的静态服务组合进来（/tokio-rs/axum/axum_v0_8_4）。
- 建议：继续使用 Axum，不引入新框架，重点把“静态托管”升级为“生产可控的静态托管”（缓存、安全头、压缩、健康检查、API 语义）。

### 静态服务与中间件：tower-http
- Context7：tower-http 提供 compression、path normalize 等 middleware（/websites/rs_tower-http_tower_http），适合补齐生产所需的压缩、路径规范化、静态服务增强。

### 前端国际化：推荐 react-i18next（可选 Lingui 作为增强路线）
- react-i18next（Context7：/i18next/react-i18next）
  - 优点：接入快，运行时切换语言、按需加载 locales（/locales/{{lng}}/{{ns}}.json）清晰；适合“先把中英双语落地”。
- Lingui（Context7：/lingui/js-lingui）
  - 优点：偏编译期/工作流化（提取、编译 catalog），更适合规模化翻译与流程治理。
- 结论：本项目当前目标是“尽快生产级 + 中英双语”，我建议第一阶段用 react-i18next；第二阶段如果你要“强治理与提取”，再迁移或叠加 Lingui 工作流。

## 升级实施计划（确认后我会直接落地改造）
## 1) Docker 化（跨 Windows/macOS）
- 新增多阶段 Dockerfile：
  - Stage A：Node/pnpm 构建前端（vite build 输出 dist/public）。
  - Stage B：Rust 构建 server-rs release（二进制）。
  - Stage C（runtime）：最小运行镜像，仅包含二进制 + dist/public。
- 新增 docker-compose.yml：
  - 单服务启动（映射 PORT、可选挂载静态目录用于调试）。
- 新增 .dockerignore：排除 node_modules、target、dist、.trae 等，保证镜像干净与缓存稳定。

## 2) 后端生产强化（仍保持“静态站点 + 可扩展 API”）
- 路由语义：
  - 将 `/api` 从“回退 index.html”改为：默认返回 404/JSON 错误，新增 `/api/healthz`。
  - 仅在未来真实需要时实现 `/api/oauth/callback`，避免现在制造假入口。
- 安全与可观测：
  - CORS：默认关闭或基于配置白名单开放；仅对需要跨域的 API 开启。
  - 增加基础安全响应头（CSP、X-Content-Type-Options 等）与静态缓存策略（assets 长缓存、index.html 不长缓存）。
  - 保留 tracing（现有 TraceLayer）并补齐更结构化的日志字段（请求 id 可选）。
- 静态服务健壮性：
  - 继续确保“存在文件就返回文件，不存在就回退 index.html”。
  - 明确 .wasm 的 Content-Type 验证（必要时强制设置 application/wasm）。

## 3) WASM 构建一致性治理
- 统一 wasm 产物来源：保留一种权威路径（建议用 `context-engine` 构建并拷贝到 `client/src/lib/wasm` 或改为从 `context-engine/pkg` 作为依赖）。
- 在构建脚本中增加一致性校验（例如构建时自动同步/校验哈希），避免“代码更新但 wasm 未更新”。

## 4) 中英双语（前端 i18n）
- 引入 react-i18next + i18next：
  - 新增 `client/src/i18n` 初始化；
  - 新增 `client/public/locales/{en,zh}/...json`；
  - UI 增加语言切换入口并记忆用户选择（localStorage），默认按浏览器语言探测。
- 逐步替换 UI 文案：先覆盖关键页面与核心组件（Home、变量面板、预览面板、错误边界、NotFound）。

## 5) CI 与质量门禁（生产级必备）
- 新增 GitHub Actions（或你指定的 CI）：
  - 前端：pnpm install、tsc check、vite build。
  - Rust：cargo fmt、clippy、test、build。
  - Docker：构建镜像（可选推送）。

## 6) “Chrome DevTools MCP 全面测试”验收（你要求的第二点）
- 我会在改造完成后用 DevTools MCP 做端到端验证：
  - 页面加载：无 console error；WASM 请求成功且 MIME 正确。
  - SPA 路由：随机路由刷新不 404（index fallback 正常）。
  - 语言切换：中/英切换立即生效并持久化。
  - 网络面板：无异常 4xx/5xx；关键资源缓存策略生效。
  - 性能：录制 performance trace，检查长任务与首屏渲染瓶颈（给出可量化建议）。

## 交付物
- Dockerfile + docker-compose + .dockerignore（可一键部署）
- 后端路由/安全/缓存/健康检查升级
- WASM 产物一致性策略落地
- 前端中英双语体系落地
- CI 工作流
- DevTools MCP 的完整测试记录与问题清单

如果你确认该计划，我将退出计划模式并开始逐项落地实现与 DevTools 验收。

