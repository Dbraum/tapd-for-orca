# Orca 侧栏与 Agent 的 TAPD 研发流程

Orca 侧栏面向研发人员，支持查看跨项目待办和工单、手动处理工单，以及从开发任务创建或打开 Git 工作区。交接给 Agent 时，提供任务的交付行为、验收标准、阻塞信息，以及关联需求的目标、范围和链接。Agent 执行 TAPD MCP 原生支持的操作时直接调用 MCP。遇到能力或权限限制时，Agent 说明原因，并引导用户通过已有的侧栏入口或 TAPD 原页处理。侧栏可以根据实际使用场景补充 MCP 暂未覆盖的操作。 [需求与开发任务约定](0001-tapd-requirements-and-development-tasks.md)

在所选 Agent 和目标工作区中首次进入研发流程时，引导用户复用或配置 TAPD MCP 与 Matt Pocock skills，并通过只读查询验证项目访问、确认所需 skills 可用。用户可以先浏览工单、创建工作区或启动配置引导。进入实现前，Agent 核对交付行为和验收标准，确认已记录的阻塞任务完成。首版可以在任务正文中用工单链接记录阻塞，Agent 逐项查询。

由 TAPD 侧栏发起的研发生命周期遵循 TAPD 的需求和任务约定。Agent 按阶段选用 Matt skills，例如用 `grill-with-docs` 澄清规格、用 `to-tickets` 拆分任务，或按实现工作的性质使用 `tdd`、`diagnosing-bugs`。团队可以用 `setup-matt-pocock-skills` 将 TAPD 显式设为仓库默认的工单来源，以便其他会话复用项目约定。 [Matt skills 仓库配置](https://github.com/mattpocock/skills/blob/abeeaf9/skills/engineering/setup-matt-pocock-skills/SKILL.md)
