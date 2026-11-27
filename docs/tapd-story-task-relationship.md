# TAPD 需求与任务的关系

一个需求（Story）可以关联零到多个任务（Task）。一个任务通过单值字段 `story_id` 关联至多一个需求，也可以独立存在。例如，「导出报表」是可验收的需求，可以拆成「实现导出接口」和「实现导出按钮」两个研发任务。创建独立任务时可以省略 `story_id`，官方示例返回 `"story_id": "0"`。[腾讯云 TAPD《任务》](https://cloud.tencent.com/document/product/624/44288) · [TAPD 开放平台《创建任务》](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/add_task.html)

子需求仍然是 `Story`，适合把较大的需求拆成较小的功能点，父子层级由 `Story.parent_id` 和 `Story.children_id` 表达。研发任务通过 `Task.story_id` 挂到需求下，任务与迭代的关系另由 `iteration_id` 表达。[腾讯云 TAPD《需求基本信息》](https://cloud.tencent.com/document/product/624/44287) · [TAPD 开放平台《需求字段说明》](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/story.html) · [TAPD 开放平台《获取任务》](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/get_tasks.html)

## 在 TAPD 中创建和关联

- 从需求出发，在需求详情的「任务」页签选择「快速创建任务」或「关联任务」。也可以从迭代详情中需求所在行的下拉菜单快速创建任务。[腾讯云 TAPD《任务》](https://cloud.tencent.com/document/product/624/44288) · [TAPD 项目快速入门，第 20 页](https://file.tapd.cn/official/preview/1120003271001000309)
- 从任务出发，在项目的「任务」页独立创建，再从该任务所在行的下拉菜单选择「关联需求」。[腾讯云 TAPD《任务》](https://cloud.tencent.com/document/product/624/44288)
- 固定的拆分方式可以通过需求创建模板预设任务。系统可同时创建需求和预设任务，前提是项目启用了需求和任务应用，且创建者有任务创建权限。[腾讯云 TAPD《需求基本信息》](https://cloud.tencent.com/document/product/624/44287)

## API 读取与更新

| 操作 | 请求 | 官方文档 |
| --- | --- | --- |
| 查某需求下的任务 | `GET /tasks?workspace_id=<项目ID>&story_id=<需求ID>`，结果分页，默认每页 30 条。 | [获取任务](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/get_tasks.html) |
| 从任务查关联需求 | 读取返回的 `Task.story_id`，有有效 ID 时用 `GET /stories?workspace_id=<项目ID>&id=<需求ID>` 查询。 | [获取任务](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/get_tasks.html) · [获取需求](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/get_stories.html) |
| 创建任务并关联 | `POST /tasks`，传入 `workspace_id`、`name`、`story_id`。省略 `story_id` 可独立创建。 | [创建任务](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/add_task.html) |
| 更新任务的关联需求 | `POST /tasks`，传入 `workspace_id`、任务 `id` 和目标 `story_id`。该接口将 `story_id` 列为可更新字段。 | [更新任务](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/update_task.html) |

关联后，需求仍按自身工作流流转。启用工时功能时，需求进度达到 100% 后仍需流转状态，结束需求时可以选择是否关闭未完成的关联任务。开放 API 更新需求时可用 `is_auto_close_task=1` 在流转到结束状态时关闭关联任务，参数默认为 `0`。[腾讯云 TAPD《工时花费》](https://cloud.tencent.com/document/product/624/44295) · [TAPD 开放平台《更新需求》](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/update_story.html)

公开文档确认了从网页关联独立任务，并列明了 API 更新字段。网页上改挂或解除现有关联的具体操作、API 解除关联的写入值，以及跨项目关联限制有待实测。响应中的 `"0"` 表示独立任务，文档未指定它是否可用于写入解除关联。[腾讯云 TAPD《任务》](https://cloud.tencent.com/document/product/624/44288) · [TAPD 开放平台《更新任务》](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/update_task.html)

## Orca 侧栏当前的支持情况

- 详情读取 `Story.parent_id` 或 `Task.story_id`。独立任务的 `"0"` 会在解析时作为无关联处理。侧栏将有效 ID 显示为「父需求」或「关联需求」链接，点击后打开 TAPD 网页。[详情字段和映射](../worker/tapd/tapd-task-source.ts)
- 需求详情可以查看、打开和创建关联任务。侧栏在创建时提交 `story_id`，并在需求详情显示保存后的任务。[侧栏详情](../panel/panel.mjs) · [任务创建](../worker/tapd/tapd-task-fields.ts)
- 从关联任务启动工作区时，Agent 上下文可以带上两条工单的说明和链接。具体建单和验收流程见 [TAPD 需求与开发任务决策](adr/0001-tapd-requirements-and-development-tasks.md)。
