# 变量抽取 DSL 与 Builder 规范

本文档定义变量体系的统一规格：用户如何在平台内配置静态/动态变量，如何把不同数据源的抽取规则统一成可观测、可测试、可复现的结构。

## 变量类型
- static：常量值，直接参与上下文装配。
- dynamic：需要在预览/执行时解析；解析过程必须产出 trace，并具备稳定错误码。

## Builder 体验要求（验收口径）
- 新手模式：通过可视化表单完成配置（选择数据源、选择抽取器、配置参数、测试结果）。
- 高级模式：允许用户编辑抽取规则（SQL/Cypher/Milvus op JSON），并在保存前做校验。
- 一键测试：变量面板内必须可独立测试变量，显示 value 与结构化结果（rows/JSON）及 trace 摘要。

## DSL（草案）
### 结构
- source：数据源选择（sql/neo4j/milvus/chat/const）。
- extractor：抽取规则（query/cypher/op/messages_window）。
- postProcess：格式化、裁剪、序列化策略。

### 输出要求
- 解析结果必须同时提供：
  - value：用于上下文插值的字符串（必要）。
  - debug：结构化结果（可选，但用于 UI 观测与测试断言）。

## 协议兼容（与现有实现对齐）
- 兼容现有“resolver + value”模式：
  - sql://<dataSourceId> + value=SQL
  - sqlite://<url> + value=SQL
  - neo4j://<dataSourceId> + value=Cypher 或 JSON（含 params）
  - milvus://<dataSourceId> + value=op 或 JSON（含 op 字段）
  - chat://<sessionId> + value=maxMessages
- UI 侧必须隐藏协议细节，用户只操作结构化配置。

## Trace 与错误码（验收契约）
- 每次解析 dynamic 变量都必须记录：
  - resolver 类型与目标摘要（driver、dsId、op 名称）
  - 资源限制（rowLimit/topK 等）与 clamp 信息
  - 错误码与回退行为（是否回退占位符、是否返回空串）
- 建议错误码集合（最小）：invalid_config、connect_failed、query_failed、timeout、result_too_large、dependency_cycle、feature_not_enabled。

## 测试落点建议（用于映射到 CI）
- PR 必跑：变量解析错误码与回退占位的集成测试；dependency_cycle 的负向用例；result_too_large 的边界用例。
- Nightly：在真实 MySQL/Postgres/Neo4j/Milvus 上跑“同一 DSL 在不同数据源上的回归矩阵”。

