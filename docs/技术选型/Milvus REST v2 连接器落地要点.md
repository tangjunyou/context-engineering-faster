# Milvus REST v2 连接器落地要点

## 目标
- 以 Milvus（社区版）作为向量数据库，为动态变量提供向量检索/查询/插入等能力。
- 能力按“必须支持清单”分阶段落地，并通过 nightly 集成测试回归。

## 关键实现点（基于 Context7 调研）
- REST API 采用 Bearer token 鉴权（`Authorization: Bearer <token>`），`Content-Type: application/json`。
- 典型端点（v2）：
  - `/v2/vectordb/entities/insert`（插入）
  - 其他检索/查询相关端点以官方文档为准（建议在落地每个能力前写一条契约测试）。
## 当前仓库落地（阶段性）
- 数据源：driver=`milvus` 时，后端以加密 JSON 保存 `{ baseUrl, token }`。
- 健康测试：使用 `/v2/vectordb/collections/list` 作为最小连通性检查（feature gate）。
- 变量 resolver：`milvus://{dataSourceId}` 目前先支持 `list_collections`（为后续扩展保留入口）。
- feature gate：默认构建不启用 Milvus；未启用时后端会在 trace 中给出 `variable_resolve_failed` 提示。
