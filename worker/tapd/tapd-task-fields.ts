import * as z from 'zod'
import type {
  ExternalTask,
  ExternalTaskResult,
  TaskBinding
} from './contracts/external-task-source'
import type { TapdProjectMember, TapdTaskFields } from './contracts/tapd-task-fields'
import { tapdTaskIdSchema, type TapdTaskKind, type TapdTaskRef } from './contracts/tapd-task-ref'
import { tapdGet, tapdPost } from './tapd-api'
import { getTapdTask, parseTapdTasks, tapdTaskResource, tapdTaskUrl } from './tapd-task-source'
import { tapdParagraphHtml } from './tapd-text'

const memberSchema = z.object({
  UserWorkspace: z.object({
    user: z.string().trim().min(1).max(200),
    name: z.string().trim().max(200).nullish()
  })
})
const taskIdentity = z.object({
  id: tapdTaskIdSchema,
  workspace_id: z.union([z.string(), z.number().int().positive()])
})

type Session = { author: string; token: string }

export async function listTapdProjectMembers(
  binding: TaskBinding,
  token: string
): Promise<ExternalTaskResult<TapdProjectMember[]>> {
  const result = await tapdGet(
    'workspaces/users',
    new URLSearchParams({ workspace_id: binding.projectId, fields: 'user,name' }),
    token
  )
  if (!result.ok) {
    return result
  }
  const members = z.array(memberSchema).max(10_000).safeParse(result.value)
  if (!members.success) {
    return { ok: false, code: 'invalid' }
  }
  return {
    ok: true,
    value: Array.from(
      new Map(
        members.data.map(({ UserWorkspace: { user, name } }) => [
          user,
          { nick: user, name: name ?? '' }
        ])
      ).values()
    )
  }
}

type Edit = { id: string; expectedModified: string }

export async function saveTapdTask(
  binding: TaskBinding,
  kind: TapdTaskKind,
  fields: TapdTaskFields,
  { author, token }: Session,
  edit?: Edit
): Promise<ExternalTaskResult<ExternalTask>> {
  const { route, title, owner, creator, wrapper } = tapdTaskResource[kind]
  const params = new URLSearchParams({ workspace_id: binding.projectId })
  let previous: ExternalTask | null = null
  if (edit) {
    const existing = await getTapdTask({ ...binding, kind, sourceId: 'tapd', id: edit.id }, token)
    if (!existing.ok) {
      return existing
    }
    if (!existing.value) {
      return { ok: false, code: 'not-found' }
    }
    if (existing.value.modified !== edit.expectedModified) {
      return { ok: false, code: 'conflict' }
    }
    previous = existing.value
    params.set('id', edit.id)
    params.set('current_user', author)
  } else {
    if (!fields.title) {
      return { ok: false, code: 'invalid' }
    }
    params.set(creator, author)
  }
  const formFields: [string, string | undefined][] = [
    [title, fields.title],
    [
      'description',
      fields.description === undefined ? undefined : tapdParagraphHtml(fields.description)
    ],
    [owner, fields.assignee],
    ['priority_label', fields.priority],
    ['label', fields.labels?.join('|')]
  ]
  for (const [name, value] of formFields) {
    if (value !== undefined) {
      params.set(name, value)
    }
  }
  const result = await tapdPost(route, params, token)
  if (!result.ok) {
    return result
  }
  const saved = z.object({ [wrapper]: taskIdentity }).safeParse(result.value)
  const identity = saved.success ? saved.data[wrapper] : undefined
  if (
    !identity ||
    String(identity.workspace_id) !== binding.projectId ||
    (edit && edit.id !== identity.id)
  ) {
    return { ok: false, code: 'invalid' }
  }
  const items = parseTapdTasks([result.value], kind, binding.projectId)
  if (items?.[0]) {
    return { ok: true, value: items[0] }
  }
  const ref: TapdTaskRef = { ...binding, sourceId: 'tapd', kind, id: identity.id }
  const refreshed = await getTapdTask(ref, token)
  if (refreshed.ok && refreshed.value) {
    return { ok: true, value: refreshed.value }
  }
  return {
    ok: true,
    value: {
      id: ref.id,
      url: tapdTaskUrl(ref.projectId, kind, ref.id),
      status: previous?.status ?? '',
      statusLabel: previous?.statusLabel,
      modified: previous?.modified ?? '',
      creator: previous?.creator ?? author,
      title: fields.title ?? previous?.title ?? '',
      assignee: fields.assignee ?? previous?.assignee ?? '',
      priority: fields.priority || previous?.priority,
      labels: fields.labels ?? previous?.labels,
      description:
        fields.description === undefined
          ? previous?.description
          : tapdParagraphHtml(fields.description)
    }
  }
}
