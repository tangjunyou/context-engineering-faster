# Milvus（社区版）连接器选型（Rust）

## 结论

- 为满足“Milvus 社区版所有功能”的长期目标，优先采用 **Milvus 官方 REST v2 API** 作为覆盖面基线；Rust 侧用 HTTP 客户端实现连接器。
- 同时保留未来接入 Rust SDK 的可能性，但是否能满足“全功能覆盖”必须以 API 覆盖矩阵与集成测试为准。

## 依据（Context7）

- Milvus 文档（API 能力范围、REST 示例）：`/milvus-io/milvus-docs`
- 文档示例明确覆盖的能力集合包含：
  - collection/partition 管理
  - index 创建与删除
  - load/release
  - insert/upsert/delete
  - search/query/hybrid_search
  - get by ids

## 我们的实现策略

- Rust 连接器默认走 REST v2：
  - 先落地基础管理接口（list/create/drop collection 等）与搜索/写入
  - 再通过“功能覆盖矩阵 + docker 集成测试”逐步补齐所有 API
- CI：Milvus 的 docker 集成测试放到 nightly，PR 只跑编译与单元测试。
