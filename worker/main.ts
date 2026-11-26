import { z } from 'zod'
import type { PluginWorkerOrcaApi } from './plugin-worker-api'
import { externalTaskQuerySchema } from './tapd/contracts/external-task-source'
import { tapdTaskIdSchema, tapdTaskKindSchema } from './tapd/contracts/tapd-task-ref'
import { tapdCommentBodySchema, tapdCommentPageSchema } from './tapd/contracts/tapd-task-comments'
import { tapdCreateTaskSchema, tapdEditTaskSchema } from './tapd/contracts/tapd-task-fields'
import { tapdStatusUpdateSchema } from './tapd/contracts/tapd-task-status'
import { addTapdComment, listTapdComments } from './tapd/tapd-task-comments'
import { createTapdImagePreview } from './tapd/tapd-image-preview'
import { listTapdProjectMembers, saveTapdTask } from './tapd/tapd-task-fields'
import {
  getTapdTask,
  identifyTapdConnection,
  listTapdProjects,
  listTapdTasks
} from './tapd/tapd-task-source'
import { listTapdStatusOptions, updateTapdStatus } from './tapd/tapd-task-status'
import {
  createTapdSubmissions,
  tapdSubmissionIdSchema,
  tapdSubmissionSchema
} from './tapd/tapd-submissions'
import { registerWorkspaceActions } from './workspaces'

const connectionKey = 'tapd-connection'
const tokenSchema = z
  .string()
  .trim()
  .regex(/^[!-~]{1,2048}$/)
const sessionSchema = z.object({
  id: tapdTaskIdSchema,
  author: z.string().min(1).max(200),
  token: tokenSchema
})
type Session = z.infer<typeof sessionSchema>
const project = z.object({ projectId: tapdTaskIdSchema })
const task = project.extend({ kind: tapdTaskKindSchema, id: tapdTaskIdSchema })
const invalid = { ok: false, code: 'invalid' } as const

function binding(session: Session, projectId: string) {
  return { connectionId: session.id, projectId }
}

function reference(session: Session, payload: z.infer<typeof task>) {
  return { ...payload, ...binding(session, payload.projectId), sourceId: 'tapd' as const }
}

export default function activate(orca: PluginWorkerOrcaApi): void {
  const imagePreview = createTapdImagePreview()
  const submissions = createTapdSubmissions(orca.storage)
  async function getSession(): Promise<Session | null> {
    const stored = await orca.secrets.get(connectionKey)
    if (!stored) {
      return null
    }
    const result = sessionSchema.safeParse(JSON.parse(stored))
    return result.success ? result.data : null
  }

  function withSession<Schema extends z.ZodType, Result>(
    name: string,
    schema: Schema,
    execute: (value: z.output<Schema>, session: Session) => Promise<Result>
  ) {
    orca.panels.handle(name, async (payload) => {
      const data = schema.safeParse(payload)
      if (!data.success) {
        return invalid
      }
      const session = await getSession()
      return session ? execute(data.data, session) : { ok: false, code: 'credentials' }
    })
  }

  orca.panels.handle('connection', async () => {
    const session = await getSession()
    return { account: session ? { id: session.id, name: session.author } : null }
  })
  orca.panels.handle('connect', async (payload) => {
    const input = z.object({ token: tokenSchema }).safeParse(payload)
    if (!input.success) {
      return invalid
    }
    const { token } = input.data
    const identity = await identifyTapdConnection(token)
    if (!identity.ok) {
      return identity
    }
    const account = { id: identity.value.id, name: identity.value.nick }
    await orca.secrets.set(
      connectionKey,
      JSON.stringify({ id: account.id, author: account.name, token })
    )
    imagePreview.clear()
    return { ok: true, value: account }
  })
  orca.panels.handle('disconnect', async () => {
    await orca.secrets.delete(connectionKey)
    imagePreview.clear()
    return { ok: true }
  })
  withSession('projects', z.object({}), async (_input, { author, token }) =>
    listTapdProjects(author, token)
  )
  withSession(
    'items',
    externalTaskQuerySchema.omit({ connectionId: true }).extend({
      ...project.shape,
      kind: tapdTaskKindSchema
    }),
    (query, session) =>
      listTapdTasks({ ...query, connectionId: session.id }, session.token, session.author)
  )
  withSession('item', task, (input, session) =>
    getTapdTask(reference(session, input), session.token)
  )
  withSession(
    'image-preview',
    project.extend({ imagePath: z.string().trim().min(1).max(2048) }),
    ({ projectId, imagePath }, session) => imagePreview.load(projectId, imagePath, session)
  )
  withSession(
    'image-preview-chunk',
    z.object({ handle: z.uuid(), index: z.number().int().positive().max(20) }),
    ({ handle, index }, session) => Promise.resolve(imagePreview.chunk(session.id, handle, index))
  )
  withSession('members', project, (input, session) =>
    listTapdProjectMembers(binding(session, input.projectId), session.token)
  )
  withSession(
    'create',
    project.extend(tapdCreateTaskSchema.pick({ kind: true, fields: true }).shape),
    ({ projectId, kind, fields }, session) =>
      saveTapdTask(binding(session, projectId), kind, fields, session)
  )
  withSession('submit-work-item', tapdSubmissionSchema, submissions.submit)
  withSession(
    'submission-result',
    z.strictObject({ submissionId: tapdSubmissionIdSchema }),
    ({ submissionId }, session) => submissions.result(submissionId, session)
  )
  withSession(
    'edit',
    task.extend(tapdEditTaskSchema.pick({ expectedModified: true, fields: true }).shape),
    ({ projectId, kind, id, expectedModified, fields }, session) =>
      saveTapdTask(binding(session, projectId), kind, fields, session, { id, expectedModified })
  )
  withSession('status-options', task, (input, session) =>
    listTapdStatusOptions(reference(session, input), session.token)
  )
  withSession(
    'status-change',
    task.extend(tapdStatusUpdateSchema.pick({ expectedStatus: true, status: true }).shape),
    (input, session) =>
      updateTapdStatus(reference(session, input), input.expectedStatus, input.status, session)
  )
  withSession('comments', task.extend({ page: tapdCommentPageSchema }), async (input, session) => {
    const result = await listTapdComments(reference(session, input), input.page, session.token)
    if (result.ok) {
      // The plugin request bridge limits the whole response to 1 MiB.
      for (const item of result.value.items) {
        if (item.body.length > 6000) {
          item.body = `${item.body.slice(0, 6000)}…`
        }
      }
    }
    return result
  })
  withSession('comment', task.extend({ body: tapdCommentBodySchema }), (input, session) =>
    addTapdComment(reference(session, input), input.body, session.author, session.token)
  )
  registerWorkspaceActions(orca, task, async () => (await getSession())?.id ?? null)
}
