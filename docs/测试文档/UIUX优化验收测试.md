# UI/UX 优化验收测试文档

## 1. 测试目的
验证本次 UI/UX 升级（表单化数据创建、新手引导）的功能正确性与用户体验改进，确保在移除 `window.prompt` 等原生交互后，业务逻辑（API 调用）依然符合预期。

## 2. 测试范围
*   **组件级**: `SchemaForm` 组件能否正确渲染 JSON Schema 并输出符合结构的 JSON 数据。
*   **页面级**: `DatasetCenterDialog` 的“新建数据集”流程。
*   **引导级**: `ContextWorkbench` 的首次访问引导 (Onboarding Tour)。

## 3. 测试用例 (Test Cases)

### TC01: SchemaForm 基础渲染与交互
*   **前置条件**: 给定一个简单的 JSON Schema `{ type: "string", title: "Name" }`。
*   **操作步骤**:
    1.  渲染 `SchemaForm`。
    2.  在输入框中输入 "Test Name"。
    3.  点击 Submit 按钮。
*   **预期结果**:
    1.  界面显示带有 Label "Name" 的 Shadcn Input 组件。
    2.  `onSubmit` 回调接收到 `{ "Name": "Test Name" }` (或根据 Schema 结构的对应值)。

### TC02: DatasetCenterDialog 新建流程 (Happy Path)
*   **前置条件**: 打开数据集中心对话框。
*   **操作步骤**:
    1.  点击左侧“新建数据集”按钮。
    2.  在表单中输入:
        *   名称: "My Dataset"
        *   描述: "Test Description"
        *   数据行 (Items): `[{"text": "hello"}]` (通过表单数组控件添加)
    3.  点击“保存/创建”按钮。
*   **预期结果**:
    1.  界面不弹出 `window.prompt`。
    2.  调用 `api.datasets.create`，参数为:
        ```json
        {
          "name": "My Dataset",
          "description": "Test Description",
          "items": [{"text": "hello"}] // 或是后端期望的格式
        }
        ```
    3.  创建成功后自动刷新列表或选中新数据集。

### TC03: 新手引导触发机制
*   **前置条件**: 清除 `localStorage` 中的引导标记。
*   **操作步骤**: 进入 `ContextWorkbench` 页面。
*   **预期结果**: 屏幕出现遮罩和引导气泡，指向画布区域。

### TC04: 新手引导静默机制
*   **前置条件**: `localStorage` 中存在引导已完成标记。
*   **操作步骤**: 刷新或重新进入 `ContextWorkbench` 页面。
*   **预期结果**: 不出现任何引导提示。

## 4. 自动化测试映射
| 测试用例 ID | 对应测试文件 | 状态 |
| :--- | :--- | :--- |
| TC01 | `client/src/components/ui/schema-form.test.tsx` | 待实现 |
| TC02 | `client/src/components/DatasetCenterDialog.creation.test.tsx` | 待实现 |
| TC03/04 | (手动验证 / E2E) | 待验证 |
