# Projects 与 Sessions 回放规范

本文档定义“工程（Project）与会话（Session）”作为上下文工程的可复现载体的规格，用于实现跨端一致性、可回放与可定位。

## 目标
- 工程可复现：同一 Project 在不同端（Web/Docker/Desktop）加载后，预览/执行结果一致（在相同数据源与相同变量输入下）。
- 会话可回放：Session 消息序列可用于构造 chat 变量，参与上下文工程并在 trace 中可观测。

## Project
### 必需能力（MVP）
- 创建/列表/获取/保存（upsert）。
- 结构：nodes + edges + variables（至少 nodes + variables 必须可落盘）。
- 版本化（可选）：支持保存历史版本或至少提供更新时间与最近保存记录。

### 一致性要求
- 序列化稳定：同一输入序列化后的 JSON 字段顺序不要求一致，但语义必须一致。
- 兼容策略：变量 DSL 升级后，旧 project 仍可加载并自动迁移。

## Session
### 必需能力（MVP）
- 创建/列表/获取。
- 追加消息（append）。
- 渲染（render）：把最近 N 条消息渲染成可插入上下文的文本（用于 chat://<sessionId> 变量）。

### chat 变量要求
- 变量配置时应允许选择 sessionId 与 maxMessages。
- 渲染结果必须在 trace 中可定位：至少包含 sessionId 与使用的消息数量。

## Trace 与错误码（验收契约）
- Project 加载/保存失败必须返回稳定错误码：not_found、write_failed、parse_failed。
- Session 渲染失败必须返回稳定错误码：not_found、render_failed。
- trace 中必须可见：
  - 本次 preview/execute 所用 projectId（若有）与 sessionId（若有）
  - 缺失变量与回退占位

## 测试落点建议（用于映射到 CI）
- PR 必跑：创建项目→保存→重新加载→预览/执行一致性；创建会话→append→render→作为 chat 变量参与预览。
- Nightly：与外部数据源结合的回放测试（同一项目在不同数据源组合下保持错误码与 trace 契约稳定）。

