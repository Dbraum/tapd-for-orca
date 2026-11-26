# TAPD「我的待办」接入可行性

核对日期 2026-11-26。

**Orca 侧栏可以通过现有个人访问令牌汇总跨项目待办。** TAPD 仪表盘支持汇总参与项目的待办和按预计结束时间排序。公开接口按项目和对象类型分别查询。实测覆盖需求、缺陷、任务和看板卡片四个来源，包含 `FUNC` 等自定义需求类别。 [TAPD 仪表盘说明](https://cloud.tencent.com/developer/article/1667997) · [TAPD 用户 API 索引](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/)

## 接口和权限

- **正式待办接口**为 `GET /user_oauth/get_user_todo_story`、`get_user_todo_bug`、`get_user_todo_task`，都要求 `workspace_id`，默认每页 30 条，上限 200，支持 `fields`、`order` 和翻页。开放平台文档标注只支持用户态 OAuth，并列出 `user_todo#read` 权限。 [需求](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/get_user_todo_story.html) · [缺陷](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/get_user_todo_bug.html) · [任务](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/get_user_todo_task.html) · [权限点](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/%E6%8E%88%E6%9D%83%E5%87%AD%E8%AF%81/scopes.html)
- **现有个人访问令牌值得先验证。** 插件已将令牌作为 Bearer 发给 TAPD，登录时会调用同样标注只支持用户态 OAuth 的 `/users/info`。TAPD 团队公开的 MCP 源码使用个人 Bearer 令牌，通过 `get_todo` 调用上述三个接口。该客户端还附加了 MCP 标识。此处查阅了源码，实际租户、项目和令牌权限仍待验证。 [插件连接说明](../../README.zh-CN.md#安装与连接) · [请求实现](../../worker/tapd/tapd-api.ts#L27) · [身份校验](../../worker/tapd/tapd-task-source.ts#L52) · [TAPD 用户信息 API](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/get_users_info.html) · [官方 MCP `server.py` 1895–1936 行](https://cnb.cool/tapd_mcp/mcp-server-tapd/-/git/raw/ca63e2fee3007f5a80ff6095b397a66ce7af39a6/src/mcp_server_tapd/server.py) · [官方 MCP `tapd.py` 18–24、677–693 行](https://cnb.cool/tapd_mcp/mcp-server-tapd/-/git/raw/ca63e2fee3007f5a80ff6095b397a66ce7af39a6/src/mcp_server_tapd/tapd.py)
- **项目范围。** 首版可从插件已有的项目列表聚合。云端个人令牌会为企业管理员返回本企业全部研发协作项目，为父项目超级管理员返回其管辖的全部子项目，需要与首页筛选后的范围核对。研发协作文档的参数表列出 `nick` 和 `company_id`，同时其示例与现有插件均仅传 `nick`。轻协作另有按用户名和公司 ID 列出参与空间的接口。若需接 TAPD 用户态 OAuth，官方支持从外部浏览器发起 `auth_by=user`，回调携带授权范围，文档明确为单个空间。换令牌还需要开放应用的 ID、密钥和回调处理。 [现有项目枚举](../../worker/tapd/tapd-task-source.ts#L63) · [参与项目](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/workspace/user_participant_projects.html) · [参与的轻协作空间](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/mini_api_reference/workspace/get_mini_project_list_with_permission.html) · [用户态授权](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/%E6%8E%88%E6%9D%83%E5%87%AD%E8%AF%81/%E7%94%A8%E6%88%B7%E6%80%81.html)

## 类型和统计口径

| 截图类型 | 公开接口及待核对项 |
| --- | --- |
| `STORY`、`TASK` | 正式待办已有需求和任务接口。官方 MCP 还识别升级后的任务类别，这类任务通过 `/stories` 和 `workitem_type_id` 读取。需按编号确认截图任务从哪个接口返回。 [用户 API 索引](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/) · [官方 MCP 源码 `tapd.py` 530–550 行](https://cnb.cool/tapd_mcp/mcp-server-tapd/-/git/raw/ca63e2fee3007f5a80ff6095b397a66ce7af39a6/src/mcp_server_tapd/tapd.py) |
| `FUNC` 等需求类别 | 待办需求返回 `workitem_type_id`，可查询 `/workitem_types` 的 `english_name`。实测 `FUNC`、`PRD` 等使用这一映射。通过 `/stories` 批量补中文状态，投影字段需同时包含 `status`，请求附 `with_v_status=1`。 [获取需求](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/get_stories.html) · [需求类别](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/get_workitem_types.html) |
| `ITEM` | 实际仪表盘卡片链接确认是研发协作看板卡片。用 `/board_cards` 查开放状态并按 `USER_OR<当前用户>` 匹配负责人，返回后再次核对负责人列表。适用于包含多位负责人的卡片。 [官方工作台示例](https://file.tapd.cn/official/preview/1120003271001000067) · [研发协作看板工作项](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/board/get_board_cards.html) · [多人员匹配](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/%E4%BD%BF%E7%94%A8%E5%BF%85%E8%AF%BB.html) |

侧栏现有「分配给我」是单项目、单类型列表中的处理人过滤。若待办接口对现有令牌不可用，可复用该查询，按项目和工作流过滤结束状态，提供「我负责的未完成事项」。工作流结束状态和并行节点随项目与类别变化，TAPD 首页自身的纳入规则仍需对照。增加聚合入口时，每行携带项目 ID、底层对象类型和条目 ID，现有详情、评论及 Orca 工作区关联即可按原有身份定位。 [当前列表请求](../../panel/panel.mjs#L134) · [处理人过滤](../../worker/tapd/tapd-task-source.ts#L228) · [工作区关联](../../worker/workspaces.ts#L80) · [需求结束状态](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/workflow/get_workflow_all_last_steps.html) · [缺陷结束状态](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/workflow/get_workflow_last_steps.html)

官方 MCP 为缺陷待办请求 `project_id`。待办解析器接受两种项目字段，返回的任一项目字段和请求范围不一致时会跳过该行并显示该项目结果不完整。 [官方 MCP `server.py` 1914–1924 行](https://cnb.cool/tapd_mcp/mcp-server-tapd/-/git/raw/ca63e2fee3007f5a80ff6095b397a66ce7af39a6/src/mcp_server_tapd/server.py)

## 侧栏设计

- 在已连接的 TAPD 侧栏通过「项目工单」和「我的待办」切换。待办默认按预计结束日期排序，可按项目、类型或最近更新浏览。列表显示标题、类型、项目、状态、优先级和预计结束日期。 [侧栏页面](../../panel/index.html)
- 查询由 Orca worker 执行，最多并发八条查询。侧栏读取进度和合并后的分页，检索失败时显示部分结果和受影响项目数。刷新会重新读取项目和待办，切换 TAPD 账号会清空旧结果。 [待办查询](../../worker/tapd/tapd-todos.ts)
- 每条记录携带自己的项目和底层类型。详情打开后可以回到待办，也可以查找关联工作区或通过「开始」创建工作区。看板详情支持读取和打开 TAPD 原页，评论与流转可在 TAPD 处理。 [详情界面](../../panel/panel.mjs) · [工作区关联](../../worker/workspaces.ts)
