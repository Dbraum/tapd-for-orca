import { z } from 'zod'
import type { PluginWorkerOrcaApi } from './plugin-worker-api'
import { tapdTaskIdSchema, tapdTaskKindSchema } from './tapd/contracts/tapd-task-ref'

const identity = z.string().min(1).max(4096)
const orcaProjects = z.object({
  projects: z.array(
    z.object({
      id: identity,
      name: z.string(),
      kind: z.enum(['git', 'folder']),
      hostId: z.string().nullable(),
      hidden: z.boolean().optional()
    })
  ),
  truncated: z.boolean().optional()
})
const workspaces = z.object({
  workspaces: z.array(z.object({ id: identity, name: z.string() })),
  truncated: z.boolean()
})
const workspaceContext = z.object({ workspaceId: identity.optional() }).nullable()
const workspaceProjects = z.object({
  workspaces: z.array(
    z.object({
      id: identity,
      kind: z.enum(['worktree', 'folder']),
      projectId: identity.nullish(),
      hostId: z.string().nullable()
    })
  )
})
const linkedWorkspace = z.object({ id: identity, name: z.string() })
const taskKeySchema = z.object({
  projectId: tapdTaskIdSchema,
  kind: tapdTaskKindSchema,
  id: tapdTaskIdSchema
})
const agents = z.enum(['default', 'codex', 'claude', 'gemini', 'opencode', 'codebuddy'])
const terminalLaunch = z.object({ terminalId: identity })
const defaultLaunch = z.union([
  z.object({ started: z.literal(false) }),
  z.object({ started: z.literal(true), terminalId: identity.optional() })
])
const startSchema = taskKeySchema.extend({
  destination: identity,
  hostId: identity,
  name: z.string().trim().min(1).max(128),
  baseBranch: z.string().trim().min(1).max(255).optional(),
  agent: agents.optional(),
  prompt: z.string().max(4096).optional(),
  skipSetup: z.boolean().optional()
})
type TaskKey = z.infer<typeof taskKeySchema>
const invalid = { ok: false, code: 'invalid' } as const

function eligibleProjects({ projects }: z.infer<typeof orcaProjects>) {
  return projects.filter(
    ({ kind, hostId, hidden }) =>
      kind === 'git' && !hidden && (hostId === 'local' || hostId?.startsWith('ssh:'))
  )
}

async function focusedWorkspace(orca: PluginWorkerOrcaApi) {
  const context = workspaceContext.parse(await orca.host.call('workspace.readContext'))
  if (!context?.workspaceId) {
    return undefined
  }
  const { workspaces: listed } = workspaceProjects.parse(await orca.host.call('workspace.list'))
  return listed.find(({ id }) => id === context.workspaceId)
}

export function registerWorkspaceActions(
  orca: PluginWorkerOrcaApi,
  task: typeof taskKeySchema,
  account: () => Promise<string | null>
): void {
  const starting = new Set<string>()
  const latestLinks = new Map<string, z.infer<typeof linkedWorkspace>[]>()
  const linkKey = (user: string, { projectId, kind, id }: TaskKey) =>
    `workspaces:${user}:${projectId}:${kind}:${id}`
  async function readLinks(key: string) {
    return (
      latestLinks.get(key) ?? z.array(linkedWorkspace).parse((await orca.storage.get(key)) ?? [])
    )
  }

  orca.panels.handle('orca-projects', async () => {
    const [catalog, focused] = await Promise.all([
      orca.host.call('project.list').then((result) => orcaProjects.parse(result)),
      focusedWorkspace(orca).catch(() => undefined)
    ])
    const destinations = eligibleProjects(catalog)
    const matches =
      focused?.kind === 'worktree' && (focused.hostId || !catalog.truncated)
        ? catalog.projects.filter(
            ({ id, hostId }) =>
              id === focused.projectId && (!focused.hostId || hostId === focused.hostId)
          )
        : []
    const current = matches.length === 1 && destinations.includes(matches[0]) ? matches[0] : null
    return { destinations, current, defaultAgentSupported: orca.host.has('agent.launchDefault') }
  })

  orca.panels.handle('workspaces', async (payload) => {
    const input = task.safeParse(payload)
    const user = await account()
    if (!input.success || !user) {
      return []
    }
    const links = await readLinks(linkKey(user, input.data))
    if (links.length === 0) {
      return links
    }
    const known = workspaces.parse(await orca.host.call('workspace.list'))
    const names = new Map(known.workspaces.map(({ id, name }) => [id, name]))
    return links.flatMap(({ id, name }) =>
      known.truncated || names.has(id) ? [{ id, name: names.get(id) ?? name }] : []
    )
  })

  orca.panels.handle('open-workspace', async (payload) => {
    const input = task.extend({ workspaceId: identity }).safeParse(payload)
    const user = await account()
    if (!input.success || !user) {
      return invalid
    }
    const links = await readLinks(linkKey(user, input.data))
    if (!links.some(({ id }) => id === input.data.workspaceId)) {
      return invalid
    }
    await orca.host.call('workspace.open', { workspaceId: input.data.workspaceId })
    return { ok: true }
  })

  orca.panels.handle('start-workspace', async (payload) => {
    const input = startSchema.safeParse(payload)
    const user = await account()
    if (!input.success || !user) {
      return invalid
    }
    const { destination, hostId, name, baseBranch, agent, prompt, skipSetup } = input.data
    const key = linkKey(user, input.data)
    if (starting.has(key)) {
      return { ok: false, code: 'busy' }
    }
    starting.add(key)
    try {
      const projects = eligibleProjects(orcaProjects.parse(await orca.host.call('project.list')))
      if (!projects.some(({ id, hostId: host }) => id === destination && host === hostId)) {
        return { ok: false, code: 'workspace-project' }
      }
      const previous = await readLinks(key)
      const created = await orca.host
        .call('workspace.create', {
          projectId: destination,
          hostId,
          name,
          ...(baseBranch ? { baseBranch } : {}),
          ...(skipSetup ? { setup: 'skip' } : {})
        })
        .catch(() => null)
      const parsed = z.object({ workspaceId: identity }).safeParse(created)
      if (!parsed.success) {
        return { ok: false, code: 'workspace-create' }
      }
      const { workspaceId } = parsed.data
      const links = [{ id: workspaceId, name }, ...previous].slice(0, 100)
      let linkSaved = true
      let agentStarted = false
      let agentLaunchFailed = false
      let opened = false
      let terminalId: string | undefined
      try {
        await orca.storage.set(key, links)
      } catch {
        latestLinks.set(key, links)
        linkSaved = false
      }
      if (linkSaved) {
        latestLinks.delete(key)
      }
      try {
        if (agent === 'default' && orca.host.has('agent.launchDefault')) {
          const launched = defaultLaunch.parse(
            await orca.host.call('agent.launchDefault', { workspaceId, ...(prompt ? { prompt } : {}) })
          )
          agentStarted = launched.started
          terminalId = launched.started ? launched.terminalId : undefined
        } else if (agent && agent !== 'default') {
          const launched = await orca.host.call('agent.launch', {
            workspaceId,
            agent,
            ...(prompt ? { prompt } : {})
          })
          terminalId = terminalLaunch.parse(launched).terminalId
          agentStarted = true
        }
      } catch {
        agentLaunchFailed = true
      }
      try {
        if (terminalId) {
          const result = await orca.host.call('terminal.focus', { terminalId }).catch(() => null)
          opened = z.object({ focused: z.literal(true) }).safeParse(result).success
        }
        if (!opened) {
          await orca.host.call('workspace.open', { workspaceId })
          opened = true
        }
      } catch {
        // The created workspace is visible in the existing workspace list.
      }
      return { ok: true, value: { workspaceId, linkSaved, agentStarted, agentLaunchFailed, opened } }
    } finally {
      starting.delete(key)
    }
  })
}
