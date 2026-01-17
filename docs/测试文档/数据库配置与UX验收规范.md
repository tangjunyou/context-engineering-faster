# 数据库配置与UX验收规范

本文面向“数据源中心/数据库配置/数据库探索/变量生成”相关功能的验收，覆盖 SQLite / Postgres / MySQL / Milvus 四类数据源的一致核心能力与差异化能力展示。

## 用户目标与验收口径

### 用户目标（以任务为中心）
1. 连接数据库/向量库
2. 看到数据库结构（表/列 或 collection/field/index）
3. 预览数据（样本行/样本 entities）
4. 导入/写入数据（受权限开关与安全策略限制）
5. 构建查询/检索（可视化 + 高级编辑）
6. 一键生成变量并可绑定到画布节点

### 验收原则（新手友好 + 高度灵活）
- 默认以可视化表单与向导呈现；高级模式可直接编辑 URL/SQL/JSON
- 任何“不支持/不能做”的能力必须在数据源 Overview 一屏解释清楚，包含原因与下一步引导
- 失败必须可恢复：字段级校验 + 明确错误 + 可执行修复建议（而非仅 toast）

## 能力矩阵（四库统一呈现）

说明：
- “支持”表示产品侧提供直达可视化入口
- “受限”表示能力存在但受权限/只读/feature gate/资源限制影响，UI 必须明确展示约束
- “不支持”表示本期不提供或明确禁用

| 能力 | SQLite（本地） | Postgres | MySQL | Milvus |
|---|---|---|---|---|
| 向导式配置 | 支持 | 支持 | 支持 | 支持 |
| 连接测试 | 支持 | 支持 | 支持 | 支持 |
| 结构浏览 | 支持（tables/columns） | 支持（tables/columns） | 支持（tables/columns） | 支持（collections/fields/index） |
| 数据预览 | 支持（rows） | 受限（采样查询 + LIMIT） | 受限（采样查询 + LIMIT） | 支持（query/preview entities） |
| 查询运行 | 支持（只读默认） | 支持（只读默认） | 支持（只读默认） | 支持（search/query） |
| CSV 导入 | 支持 | 支持 | 支持 | 不支持（改为向量导入/embedding pipeline） |
| 行级写入（insert/update/delete） | 支持（受权限） | 受限（高级/明确授权） | 受限（高级/明确授权） | 支持（insert/upsert，受权限与schema约束） |
| Schema 变更（建表/改表） | 支持（受权限） | 受限（高级/明确授权） | 受限（高级/明确授权） | 支持（create/drop collection/index，受权限） |
| 一键生成变量 | 支持（SQL） | 支持（SQL） | 支持（SQL） | 支持（search/query） |
| 一键绑定到节点 | 支持 | 支持 | 支持 | 支持 |

## 关键验收用例（必须可在10分钟内完成）

### 用例A：SQLite（新手路径）
1. 打开“数据源中心”→ 选择 SQLite → 创建本地数据库
2. 进入数据源详情页 → 创建表（可视化字段表单）→ 插入 3 行样本数据（表单或批量导入）
3. Explore 中看到样本行；Query 中运行一条 SELECT；一键生成变量并绑定到当前选中节点

### 用例B：Postgres（典型生产库接入）
1. 选择 Postgres → 向导填写 host/port/db/user/password/SSL → 测试连接成功并保存
2. Schema 中看到 tables/columns（含 schema 前缀）
3. Explore 中预览样本数据（说明：仅采样，默认只读）
4. Query 中以模板方式生成查询（含参数表单），运行并生成变量

### 用例C：MySQL（业务库接入）
1. 选择 MySQL → 向导填写连接信息 → 测试连接成功并保存
2. 结构浏览可见表与列；Explore 中可采样预览数据
3. Query 中使用 MySQL 模板（例如日期/字符串函数）运行并生成变量

### 用例D：Milvus（向量检索工作流）
1. 选择 Milvus → 向导填写 baseUrl/token → 测试连接成功并保存
2. Collections 列表可见；选择 collection 后可查看 schema/索引信息
3. Search Builder 中配置 topK/filter/outputFields → 运行并看到结果
4. 一键生成变量并绑定到节点

## 错误与限制展示要求（必须可解释）
- 只读限制：当查询/预览仅支持只读时，UI 明确提示“为什么只读、如何开启写入、风险是什么”
- feature gate：当 Neo4j/Milvus 等功能因 feature 未启用而不可用，必须显示明确状态与构建/配置指引
- 限流与资源限制：行数上限、超时、导入大小/行列上限必须在 UI 中可见（并与后端一致）

