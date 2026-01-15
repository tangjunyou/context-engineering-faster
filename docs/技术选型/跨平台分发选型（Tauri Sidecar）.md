# 跨平台分发选型（Tauri v2 + Sidecar）

## 目标
- Windows/macOS 直接分发可执行安装包，用户无需单独安装运行环境。
- 应用内置本地后端（server-rs），前端用 WebView 加载本地服务页面，实现一致的 UI/功能。

## 方案结论
- 选择：Tauri v2 + `tauri-plugin-shell` 启动 sidecar（二进制）+ WebView 加载 `http://127.0.0.1:{port}`。
- 关键原因：
  - Tauri v2 原生支持 sidecar 打包（bundle.externalBin）与 Rust 侧启动（shell plugin）。
  - 适配现有架构：保留 `server-rs` 的静态托管与 API，不需要重写 UI 或把逻辑迁进 Tauri command。

## 关键实现点（基于 Context7 调研）
- Sidecar 打包：`tauri.conf.json` 的 `bundle.externalBin` 可以声明外部二进制，Tauri build 会把它随应用一起打包。
- Sidecar 启动：Rust 侧通过 `tauri-plugin-shell` 的 `app.shell().sidecar(...).spawn()` 启动，并可监听 stdout/stderr 事件。
- WebView 加载：通过 `WebviewWindowBuilder + WebviewUrl::External(url)` 直接加载本地服务 URL。
- Sidecar 命名约定：推荐把二进制重命名为 `server-rs-<target-triple>` 并放入 `src-tauri/binaries/`，配置 `externalBin: ["binaries/server-rs"]`（Tauri 会匹配目标平台产物）。
- 权限最小化：在 `src-tauri/capabilities/default.json` 中仅允许对指定 sidecar 的 spawn/execute（避免放开任意命令执行）。

## 当前仓库落地（可打包闭环）
- `src-tauri/`：提供桌面壳 PoC，启动时会：
  - 随机选择可用端口
  - 生成/读取 `DATA_KEY`（写入应用数据目录）
  - 将 `DATA_DIR/DATA_KEY` 注入 server-rs
  - 启动 sidecar `server-rs` 并打开 WebView
  - 等待 `/api/healthz` 就绪后再打开窗口，并在关闭窗口时清理 sidecar 进程
- 配置拆分：
  - `src-tauri/tauri.conf.json`：开发/编译配置
  - `src-tauri/tauri.bundle.conf.json`：打包配置（包含 externalBin 与资源目录），通过 `TAURI_CONFIG` 选择
  - `src-tauri/capabilities/default.json`：shell 插件 sidecar 权限白名单

## 构建与验收建议
- 预期工作流：
  - `pnpm build` 生成 `dist/public`
  - `pnpm desktop:prepare` 生成并放置 sidecar 到 `src-tauri/binaries/`
  - `pnpm desktop:build` 生成 Windows/macOS 包
- 验收点：
  - 打包产物可启动并自动打开 UI
  - 首次启动可创建 `DATA_DIR` 并完成基础操作（创建数据源、预览执行）
  - 关闭应用后 sidecar 不残留（需要进一步做生命周期管理时可加 kill/cleanup）
  - CI 中可通过 server 二进制 smoke test 预先发现静态目录/核心 API 回归（Release workflow 已集成）
