# Dataset 回放与 Run 记录规范（测试先行）

本文档定义 Dataset 批量回放（Replay）与 Run 记录（Runs/Trace Archive）的数据语义、API 契约与可回归验收点。

## 目标
- 让新手用 Dataset 批量验证上下文配方是否“更好/更稳定”，并且可以随时复盘 trace。
- 在不依赖外部服务的前提下，PR 必跑的自动化测试能覆盖回放主链路。

## Dataset Row 推荐 Schema（兼容现状）
后端目前只要求 `rows` 的每个元素是 object，因此本规范在“不破坏兼容”的前提下约定：

### A) 直接变量映射（默认）
- row 的一层键值（除保留字段外）直接映射为变量：
  - `row["question"] = "..."` → 变量 `question="..."`
  - `row["user_name"] = "Alice"` → 变量 `user_name="Alice"`
- 值类型：允许 string/number/bool/object/array；最终进入变量时统一转为字符串（JSON 会被序列化）。

### B) 显式 variables 字段（优先）
如果 row 包含 `variables` 且为 object，则优先使用它作为变量映射来源：
```json
{
  "variables": { "question": "什么是上下文工程？" },
  "_expected": { "mustContain": ["上下文"] }
}
```

### 保留字段
- 任何以 `_` 开头的字段均视为保留字段，不参与变量映射（例如 `_meta/_expected/_tags`）。

## 回放（Replay）语义
- 回放输入 = Project（nodes/variables） + Dataset（rows） + 回放参数（limit/offset）。
- 每一行 row 会生成一个 RunRecord。
- 回放必须是**可复现**的：在 Project 与 Dataset 不变时，重复回放得到的输出结构应一致（允许 runId/createdAt 不同）。

## RunRecord 最小字段
RunRecord 是“可回放”的基础单元，必须能独立复盘：
- `runId: string`
- `createdAt: string`
- `projectId: string`
- `datasetId: string`
- `rowIndex: number`
- `status: "succeeded" | "failed"`
- `outputDigest: string`（用于稳定性对比）
- `missingVariablesCount: number`
- `trace: TraceRun`（包含 segments/messages）
- `errors?: { errorCode?: string; message: string }[]`

## API 契约（建议）
- `POST /api/datasets/{datasetId}/replay`\n  入参：`projectId`（必填）、`limit/offset`（可选，有限制上限）\n  出参：RunSummary 列表（每行一个）
- `GET /api/datasets/{datasetId}/runs`：列出该 dataset 的 runs（summary）
- `GET /api/runs/{runId}`：获取完整 RunRecord（含 trace）

## 错误码约定（示例）
- `validation_failed`：入参缺失或格式错误
- `project_not_found` / `dataset_not_found`
- `limit_exceeded`：limit 超上限
- `row_invalid`：row 不是 object 或 variables 非 object

## 资源与安全限制
- 默认 limit（例如 20）与最大 limit（例如 200）。
- 单条输出与变量解析输出必须有长度上限（与现有 20KB clamp 对齐），并在 trace 标注 `truncated=true`。

## 自动化验收点（映射到 PR 必跑）
- 回放成功：至少 1 条 RunRecord 写入并可通过 `GET /api/runs/{runId}` 复盘。
- 回放稳定：同一 Project+Dataset 重复回放，`outputDigest` 对应行一致。
- 可定位：失败行必须能在 trace 中定位到 variable 或 node（包含 `errorCode/variableId/nodeId` 等）。

