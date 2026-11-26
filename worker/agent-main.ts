import activateSidebar from './main'
import type { PluginWorkerOrcaApi } from './plugin-worker-api'
import { startTapdMcp } from './tapd-mcp'

declare const TAPD_MCP_SOCKET: string

export default function activate(orca: PluginWorkerOrcaApi) {
  activateSidebar(orca, (handlers) => {
    void startTapdMcp(TAPD_MCP_SOCKET, handlers).catch((error) => {
      console.error('Unable to start TAPD MCP server', error)
    })
  })
}
