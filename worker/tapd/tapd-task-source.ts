import * as z from 'zod'
import {
  externalTaskSchema,
  type ExternalTask,
  type ExternalTaskPage,
  type ExternalTaskQuery,
  type ExternalTaskRef,
  type ExternalTaskResult,
  type TapdProject
} from './contracts/external-task-source'

import {
  tapdTaskIdSchema as tapdId,
  tapdTaskKindSchema as kindSchema,
  type TapdTaskKind
} from './contracts/tapd-task-ref'
import { tapdGet } from './tapd-api'

const WEB = 'https://www.tapd.cn/'
const PAGE_SIZE = 30
const tapdProjectId = z.union([tapdId, z.number().int().positive().max(Number.MAX_SAFE_INTEGER)])
const identitySchema = z.object({ id: tapdId, nick: z.string().trim().min(1).max(200) })
const participatingProjectsSchema = z.array(
  z.object({
    Workspace: z.object({
      id: tapdProjectId,
      name: z.string().trim().min(1).max(4000),
      category: z.string().nullish()
    })
  })
)
export const tapdTaskResource = {
  story: { route: 'stories', wrapper: 'Story', title: 'name', owner: 'owner', creator: 'creator' },
  bug: {
    route: 'bugs',
    wrapper: 'Bug',
    title: 'title',
    owner: 'current_owner',
    creator: 'reporter'
  },
  task: { route: 'tasks', wrapper: 'Task', title: 'name', owner: 'owner', creator: 'creator' }
} as const

export function tapdTaskUrl(projectId: string, kind: TapdTaskKind, id: string): string {
  return new URL(`tapd_fe/${projectId}/${kind}/detail/${id}`, WEB).href
}

function isTapdProjectId(value: string): boolean {
  return tapdId.safeParse(value).success
}

export async function identifyTapdConnection(
  token: string
): Promise<ExternalTaskResult<z.infer<typeof identitySchema>>> {
  const result = await tapdGet('users/info', new URLSearchParams(), token)
  if (!result.ok) {
    return result
  }
  const user = identitySchema.safeParse(result.value)
  return user.success ? { ok: true, value: user.data } : { ok: false, code: 'invalid' }
}

export async function listTapdProjects(
  nick: string,
  token: string
): Promise<ExternalTaskResult<TapdProject[]>> {
  const result = await tapdGet(
    'workspaces/user_participant_projects',
    new URLSearchParams({ nick }),
    token
  )
  if (!result.ok) {
    return result
  }
  const rows = participatingProjectsSchema.safeParse(result.value)
  if (!rows.success) {
    return { ok: false, code: 'invalid' }
  }
  const projects = new Map<string, TapdProject>()
  for (const { Workspace: workspace } of rows.data) {
    if (workspace.category !== 'organization') {
      const id = String(workspace.id)
      projects.set(id, { id, name: workspace.name })
    }
  }
  return { ok: true, value: Array.from(projects.values()) }
}

const optionalText = z.string().trim().min(1).max(200).optional().catch(undefined)
const optionalId = tapdProjectId.transform(String).optional().catch(undefined)
const optionalNumber = z
  .union([z.number(), z.string().trim().regex(/^\d+(?:\.\d+)?$/).transform(Number)])
  .pipe(z.number().nonnegative())
  .optional()
  .catch(undefined)
const commonDetailFields = [
  'created', 'begin', 'due', 'completed', 'iteration_id', 'effort', 'effort_completed', 'remain'
]

const rawTaskSchema = z.object({
  id: tapdId,
  workspace_id: tapdProjectId,
  name: z.string().optional(),
  title: z.string().optional(),
  status: z.string().nullish(),
  owner: z.string().nullish(),
  current_owner: z.string().nullish(),
  modified: z.string().nullish(),
  description: z.string().nullish(),
  creator: optionalText,
  reporter: optionalText,
  priority_label: optionalText,
  v_status: optionalText,
  workitem_type_id: tapdId.optional().catch(undefined),
  label: z.string().max(8_000).optional().catch(undefined),
  created: optionalText,
  begin: optionalText,
  due: optionalText,
  completed: optionalText,
  iteration_id: optionalId,
  parent_id: optionalId,
  story_id: optionalId,
  developer: optionalText,
  module: optionalText,
  progress: optionalNumber,
  effort: optionalNumber,
  effort_completed: optionalNumber,
  remain: optionalNumber
})

function taskDetails(task: z.infer<typeof rawTaskSchema>, kind: TapdTaskKind) {
  const fields = {
    created: task.created,
    begin: task.begin,
    due: task.due,
    completed: task.completed,
    iterationId: task.iteration_id,
    effort: task.effort,
    completedEffort: task.effort_completed,
    remainingEffort: task.remain,
    ...(kind === 'story' && {
      relatedStoryId: task.parent_id,
      developer: task.developer?.replace(/;+$/, '').replaceAll(';', ', '),
      module: task.module
    }),
    ...(kind === 'task' && {
      relatedStoryId: task.story_id,
      progress: task.progress !== undefined && task.progress <= 100 ? task.progress : undefined
    })
  }
  const present = Object.entries(fields).filter(([, value]) => value !== undefined)
  return present.length ? Object.fromEntries(present) : undefined
}

export function parseTapdTasks(
  value: unknown,
  kind: TapdTaskKind,
  projectId: string,
  options?: { requireAssignee: boolean }
): ExternalTask[] | null {
  const entry = tapdTaskResource[kind]
  const rows = z.array(z.record(z.string(), z.unknown())).safeParse(value)
  if (!rows.success) {
    return null
  }
  const tasks: ExternalTask[] = []
  for (const row of rows.data) {
    const item = rawTaskSchema.safeParse(row[entry.wrapper])
    if (!item.success || String(item.data.workspace_id) !== projectId) {
      return null
    }
    const task = item.data
    if (options?.requireAssignee && task[entry.owner] === undefined) {
      return null
    }
    const labels = [...new Set(task.label?.split('|').map((label) => label.trim()))]
      .filter((label) => label.length > 0 && label.length <= 200)
      .slice(0, 20)
    const details = taskDetails(task, kind)
    const normalized = externalTaskSchema.safeParse({
      id: task.id,
      title: task[entry.title],
      url: tapdTaskUrl(projectId, kind, task.id),
      status: task.status ?? '',
      assignee: (task[entry.owner] ?? '').replace(/;+$/, '').replaceAll(';', ', '),
      modified: task.modified ?? '',
      ...(task[entry.creator] ? { creator: task[entry.creator] } : {}),
      ...(task.priority_label ? { priority: task.priority_label } : {}),
      ...(task.workitem_type_id ? { workItemTypeId: task.workitem_type_id } : {}),
      ...(task.v_status ? { statusLabel: task.v_status } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(task.description != null ? { description: task.description } : {}),
      ...(details ? { details } : {})
    })
    if (!normalized.success) {
      return null
    }
    tasks.push(normalized.data)
  }
  return tasks
}

function paramsFor(kind: TapdTaskKind, projectId: string, detail: boolean): URLSearchParams {
  const { title, owner, creator } = tapdTaskResource[kind]
  const fields = [
    'id',
    'workspace_id',
    title,
    'status',
    owner,
    'modified',
    creator,
    'priority_label',
    'label'
  ]
  if (detail) {
    fields.push('description')
    if (kind === 'story') {
      fields.push(...commonDetailFields, 'workitem_type_id', 'parent_id', 'developer', 'module')
    }
    if (kind === 'task') {
      fields.push(...commonDetailFields, 'story_id', 'progress')
    }
  }
  const params = new URLSearchParams({ workspace_id: projectId, fields: fields.join(',') })
  if (kind === 'story') {
    params.set('with_v_status', '1')
  }
  return params
}

export async function listTapdTasks(
  query: ExternalTaskQuery,
  token: string,
  author?: string
): Promise<ExternalTaskResult<ExternalTaskPage>> {
  const kind = kindSchema.safeParse(query.kind)
  if (!kind.success || !isTapdProjectId(query.projectId)) {
    return { ok: false, code: 'invalid' }
  }
  const entry = tapdTaskResource[kind.data]
  const params = paramsFor(kind.data, query.projectId, false)
  params.set('order', query.sort === 'updated' ? 'modified desc' : 'id desc')
  params.set('limit', String(PAGE_SIZE))
  params.set('page', String(query.page))
  if (query.status) {
    params.set(
      kind.data !== 'task' && /\p{Script=Han}/u.test(query.status) ? 'v_status' : 'status',
      query.status
    )
  }
  if (query.assignedToMe) {
    if (!author || /[<>|;]/.test(author)) {
      return { ok: false, code: 'invalid' }
    }
    params.set(entry.owner, `USER_OR<${author}>`)
  } else if (query.assignee) {
    params.set(entry.owner, query.assignee)
  }
  if (query.priority) {
    params.set('priority_label', query.priority)
  }
  if (query.label) {
    params.set('label', query.label)
  }
  if (query.search) {
    const id = query.search.replace(/^#/, '')
    if (tapdId.safeParse(id).success && (id.length >= 19 || query.search.startsWith('#'))) {
      params.set('id', id)
    } else {
      params.set(entry.title, query.search)
    }
  }
  const result = await tapdGet(entry.route, params, token)
  if (!result.ok) {
    return result
  }
  const items = parseTapdTasks(result.value, kind.data, query.projectId)
  return items
    ? { ok: true, value: { items, hasMore: items.length === PAGE_SIZE } }
    : { ok: false, code: 'invalid' }
}

export async function getTapdTask(
  ref: ExternalTaskRef,
  token: string,
  options?: { requireAssignee: boolean }
): Promise<ExternalTaskResult<ExternalTask | null>> {
  const kind = kindSchema.safeParse(ref.kind)
  if (!kind.success || !isTapdProjectId(ref.projectId) || !tapdId.safeParse(ref.id).success) {
    return { ok: false, code: 'invalid' }
  }
  const params = paramsFor(kind.data, ref.projectId, true)
  params.set('id', ref.id)
  params.set('limit', '1')
  const result = await tapdGet(tapdTaskResource[kind.data].route, params, token)
  if (!result.ok) {
    return result
  }
  const items = parseTapdTasks(result.value, kind.data, ref.projectId, options)
  if (!items || items.some((item) => item.id !== ref.id)) {
    return { ok: false, code: 'invalid' }
  }
  return { ok: true, value: items[0] ?? null }
}
