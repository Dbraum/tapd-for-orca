# Orca TAPD 侧栏插件

[English](README.md) · [Orca](https://github.com/stablyai/orca) · [反馈问题](https://github.com/Dbraum/tapd-for-orca/issues)

这是 Orca 里的第三方 TAPD 研发侧栏。你可以查看工单和跨项目待办、手动操作 TAPD，并创建或重新打开关联的 Git 工作区。正式开发可从关联任务或独立任务开始。对于关联任务，所属需求提供规格和整体验收目标。

## 安装与连接

需要 Orca 桌面版 1.4.260 或更高版本，以及自己的 TAPD 个人访问令牌。

```sh
orca plugin install Dbraum/tapd-for-orca
```

你也可以在 **设置 → 插件 → 添加插件** 选择构建好的插件文件夹。安装时请阅读 Orca 显示的插件权限，并按提示确认。

1. 打开 Orca 右侧栏的 **TAPD**。
2. 输入个人访问令牌，点击 **验证并保存**，选择你有权访问的 TAPD 项目。
3. 打开工单查看详情。新建、编辑、状态流转和评论需要对应的 TAPD 权限。要求填写额外字段的状态流转可以在 TAPD 网页完成。
4. 点击 **开始**，表单优先选中当前工作区所属的 Orca Git 项目，也可以改选。基准分支留空时由 Orca 使用所选项目的默认基准分支。支持默认 Agent 启动的 Orca 版本会预选 **使用 Orca 默认 Agent**，由目标工作区所在主机决定。也可以手选 Agent 或选择 **仅创建工作区**。勾选 **同时发送上下文给 Agent** 才会发送工单上下文。下次打开同一工单时，可以直接进入关联工作区。

点击 **我的待办**，跨项目查看需求、缺陷、任务和看板卡片。可按项目和类型筛选，按预计结束日期或最近更新排序。打开看板卡片可以查看详情、进入 TAPD 原页，或通过 **开始** 创建 Orca 工作区。

在研发协作的需求详情中，可以在 **关联任务** 区域查看任务，或点击 **新建关联任务**。保存后，任务会出现在当前需求的列表中。打开关联任务并点击 **开始** 时，工单上下文会包含任务说明、所属需求的说明和两条工单链接。勾选 **同时发送上下文给 Agent** 后，Orca 会发送预览中的内容。

## 计划中的 Agent 开发流程

侧栏将提供配置引导，协助你在所选 Agent 和目标工作区环境中安装或复用 TAPD MCP 与 Matt Pocock skills。正式开发前，Agent 会验证能读取目标 TAPD 项目、能使用当前阶段所需的 skills，并核对任务的交付行为、验收标准和阻塞情况。 [TAPD MCP 配置](https://developer.cloud.tencent.cn/mcp/server/11474) · [Matt Pocock skills](https://github.com/mattpocock/skills)

Agent 使用相应的 skill 澄清规格、拆分任务、实现或诊断。TAPD MCP 原生支持的工单操作由 Agent 直接调用。遇到当前无法完成的操作，Agent 会说明原因并引导你使用已有的侧栏入口或 TAPD 原页。侧栏也可以根据实际使用场景补充 MCP 暂未覆盖的操作。 [研发流程职责约定](docs/adr/0002-sidebar-and-agent-workflow.md)

## 权限和数据

插件通过受信任的 Node worker 访问 TAPD。令牌存放在 Orca 的加密插件密钥库，请求 TAPD 时发送到 `api.tapd.cn`。工单与工作区的关联存放在插件自己的存储中。工作区和 Agent 权限用于执行你确认的创建、打开和启动操作。

## 本地开发

```sh
npm ci
npm run check
npm run build
orca plugin validate . --json
```

仓库根目录可以直接安装。根目录的 `worker.mjs` 由 `worker/` 中的源码生成，并随 Git 提交，供 Orca 安装。运行 `npm run package` 可在 `dist/` 生成独立安装目录。

开发和发布流程见[贡献指南](CONTRIBUTING.md)，版本历史见[更新日志](CHANGELOG.md)。
