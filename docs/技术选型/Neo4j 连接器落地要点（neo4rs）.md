# Neo4j 连接器落地要点（neo4rs）

## 目标
- 以 Neo4j 作为图数据库，为动态变量提供 Cypher 抽取能力。
- 在后端统一执行变量解析并输出 trace，前端只负责可视化。

## 关键实现点（基于 Context7 调研）
- 建连：`Graph::new(uri, user, pass)` 创建连接句柄。
- 执行：`graph.execute(query(\"...\").param(...))` 返回可迭代的结果集，`result.next().await` 获取行。
- 取值：`row.get::<T>(\"alias\")` 通过返回字段别名获取值。

## 当前仓库落地（阶段性）
- 数据源：driver=`neo4j` 时，后端以加密 JSON 保存 `{ uri, username, password }`。
- 变量 resolver：`neo4j://{dataSourceId}`，变量 `value` 为 Cypher。
- 约定：当前实现读取返回字段别名 `value`（建议用户写 `RETURN ... AS value`）。
- feature gate：默认构建不启用 Neo4j；未启用时后端会在 trace 中给出 `variable_resolve_failed` 提示，保证 UI 侧可观测。

