# Neo4j 连接器选型（Rust）

## 结论

- Rust Neo4j 连接器优先选用 **neo4rs**（Bolt 协议实现），并在我们的项目中通过 feature gate 方式接入：默认不启用，等进入 Neo4j 里程碑再开启。

## 依据（Context7）

- Context7 库：`/neo4j-labs/neo4rs`
- 关键能力（文档示例已覆盖）：
  - 连接创建：`Graph::new(uri, user, pass)`
  - Cypher 查询与参数绑定：`query(...).param(...)`，并可异步迭代结果
  - 事务：`graph.start_txn()` + `commit/rollback`

## 我们的实现策略

- 连接器接口遵循“可观测与可控”的共性要求：超时、错误映射、脱敏。
- CI：Neo4j 的 docker 集成测试放到 nightly（避免 PR 过慢与架构差异导致不稳定）。

