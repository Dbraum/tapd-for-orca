# TAPD Sidebar for Orca

[简体中文](README.zh-CN.md) · [Report an issue](https://github.com/Dbraum/tapd-for-orca/issues)

An independent community plugin for [Orca](https://github.com/stablyai/orca). Browse TAPD requirements, bugs, and tasks in Orca’s right sidebar and start a workspace from a work item.

## Install

Requires Orca desktop 1.4.260 or later and a TAPD personal access token.

```sh
orca plugin install Dbraum/tapd-for-orca@main
```

You can also select a built plugin folder under **Settings → Plugins → Add plugin**.

Review the permissions and approve the installation in Orca. On the command line, Orca prints the approval command after it shows what access the plugin requests.

## Connect TAPD

1. Open **TAPD** in the right sidebar.
2. Enter your TAPD personal access token, select **验证并保存** (Verify and save), and choose a project you can access. The current panel UI uses Simplified Chinese.
3. Open a work item to read or update it. Creating, editing, changing status, and commenting require the corresponding TAPD permissions.
4. Select **开始** (Start). The form preselects the Git project of the active Orca workspace when available. Leave the base branch empty to use the selected project's default. On Orca versions that support launching the default agent, the form uses the destination host's Orca default agent. You can override the project, branch, and agent, or choose to create a workspace only. Orca sends work-item context to the agent only if you opt in. The plugin remembers the workspace so you can reopen it from the work item.

## Access and data

The plugin runs a trusted Node worker. It stores your token in Orca’s encrypted plugin secrets and sends it to `api.tapd.cn` with the TAPD requests you make. Workspace links are stored in the plugin’s own storage. Workspace and agent permissions let the plugin open or create workspaces and launch an agent after confirmation.

## Agent preview

On macOS with Node.js 22+, run `npm ci` and `npm run package:agent`, then install `dist/agent` through Orca's Add plugin action. Use an Orca build that supports plugin MCP contributions with `ORCA_MCP_SERVERS=1` enabled on the host. Enable the TAPD MCP server for Codex and the target workspace, then start a new Codex Chat. Build a separate preview package for each Orca profile.

Agent submissions use a stable submission ID. Reusing it lets a retry check the original work item. Each submission supports up to five user-selected local files of up to 10 MiB each, with later uploads to the same work item. Chat screenshots need a local path the agent can read. Uploaded file names include an attachment ID so the worker can verify the upload when TAPD does not return an attachment ID.

## Develop

```sh
npm ci
npm run check
npm run build
orca plugin validate . --json
```

The repository root is directly installable. The committed `worker.mjs` is generated from `worker/` so Orca can install it from Git. Run `npm run package` to create a standalone install folder in `dist/`.

See [Contributing](CONTRIBUTING.md) for the development workflow and release process, and [Changelog](CHANGELOG.md) for version history.

## License

[MIT](LICENSE). The initial implementation was extracted from [Dbraum/orca at `85b2f0fad27`](https://github.com/Dbraum/orca/commit/85b2f0fad27878234f6ce5eb8fe4a357fb495d7c). [Third-party notices](THIRD_PARTY_NOTICES.md) cover the libraries bundled in the worker.
