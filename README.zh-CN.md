# Orca TAPD 侧栏插件

[English](README.md) · [反馈问题](https://github.com/Dbraum/tapd-sidebar-for-orca/issues)

这是面向 [Orca](https://github.com/stablyai/orca) 的第三方插件。你可以在 Orca 右侧栏查看 TAPD 需求、缺陷和任务，也可以从工单创建工作区并启动 Agent。

## 安装与连接

需要 Orca 桌面版 1.4.260 或更高版本，以及自己的 TAPD 个人访问令牌。

```sh
orca plugin install Dbraum/tapd-sidebar-for-orca@main
```

仓库处于私有状态时，Orca 所在机器的 Git 凭据需要有读取权限。你也可以在 **设置 → 插件 → 添加插件** 选择构建好的插件文件夹。安装时请阅读 Orca 显示的插件权限，并按提示确认。

1. 打开 Orca 右侧栏的 **TAPD**。
2. 输入个人访问令牌，点击 **验证并保存**，选择你有权访问的 TAPD 项目。
3. 打开工单查看详情。新建、编辑、状态流转和评论需要对应的 TAPD 权限。要求填写额外字段的状态流转可以在 TAPD 网页完成。
4. 点击 **开始**，选择 Orca Git 项目、基准分支和 Agent，再确认操作。只有勾选 **同时发送上下文给 Agent** 才会发送工单上下文。下次打开同一工单时，可以直接进入关联工作区。

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
