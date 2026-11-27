import { z } from 'zod'
import { tapdGet } from './tapd-api'
import { externalTaskSchema, type ExternalTaskResult, type TapdProject } from './contracts/external-task-source'
import { tapdTaskIdSchema, tapdWorkItemKindSchema } from './contracts/tapd-task-ref'
import { listTapdProjects, tapdOwnerFilter, tapdTaskResource } from './tapd-task-source'

const PAGE_SIZE = 50
const projectIdSchema = z.union([
  tapdTaskIdSchema,
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)
])
const rowsSchema = z.array(z.record(z.string(), z.unknown()))
const text = z.string().trim().max(200).nullish().catch(undefined)
const rawItemSchema = z.object({
  id: tapdTaskIdSchema,
  workspace_id: projectIdSchema.nullish(),
  project_id: projectIdSchema.nullish(),
  name: externalTaskSchema.shape.title.optional(),
  title: externalTaskSchema.shape.title.optional(),
  status: text,
  priority: z.union([z.string().trim().max(200), z.number().transform(String)]).nullish().catch(undefined),
  priority_label: text,
  v_status: text,
  due: text,
  deadline: text,
  modified: text,
  workitem_type_id: tapdTaskIdSchema.nullish().catch(undefined),
  b_board_id: tapdTaskIdSchema.nullish().catch(undefined),
  owner: text,
  creator: text,
  created: text,
  begin: text,
  description: externalTaskSchema.shape.description.nullish().catch(undefined)
})
type RawItem = z.infer<typeof rawItemSchema>

type TodoKind = z.infer<typeof tapdWorkItemKindSchema>
type TodoQuery = { projectId: string; kind: TodoKind; page: number }

const boardResource = { route: 'board_cards', wrapper: 'BoardCard', title: 'name' } as const
const resources = { ...tapdTaskResource, board: boardResource }
const defaultType = { story: 'STORY', bug: 'BUG', task: 'TASK', board: 'ITEM' }
const priorities = new Map([['4', 'High'], ['3', 'Middle'], ['2', 'Low'], ['1', 'Nice To Have']])
const invalid = { ok: false, code: 'invalid' } as const

function sameProject(item: RawItem, projectId: string): boolean {
  return [item.workspace_id, item.project_id].every((id) => id == null || id === projectId)
}

function boardUrl(projectId: string, boardId: string, itemId: string): string {
  return new URL(
    `${projectId}/board/card_detail_preview/${boardId}/${itemId}`,
    'https://www.tapd.cn/'
  ).href
}

function normalizedDate(value: string | null | undefined): string {
  const date = value?.slice(0, 10) ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date > '1970-01-01' ? date : ''
}

const displayFields = z.object({ id: tapdTaskIdSchema, status: text, v_status: text, priority_label: text })
const itemType = z.object({ id: tapdTaskIdSchema, english_name: text, name: text })

async function metadata(route: string, wrapper: string, params: URLSearchParams, token: string) {
  const result = await tapdGet(route, params, token)
  const records = result.ok && rowsSchema.safeParse(result.value)
  return records && records.success ? records.data.map((row) => row[wrapper]) : []
}

async function todoMetadata(kind: TodoKind, projectId: string, items: RawItem[], token: string) {
  const display = new Map<string, z.infer<typeof displayFields>>()
  const categories = new Map<string, string>()
  if (!items.length || kind === 'board' || kind === 'task') {
    return { display, categories }
  }
  const ids = items.map(({ id }) => id).join(',')
  const { route, wrapper } = tapdTaskResource[kind]
  const fields = new URLSearchParams({
    workspace_id: projectId, id: ids, limit: String(PAGE_SIZE),
    fields: 'id,workspace_id,status,workitem_type_id,v_status,priority_label', with_v_status: '1'
  })
  if (items.some((item) => !item.v_status || !item.priority_label)) {
    for (const row of await metadata(route, wrapper, fields, token)) {
      const parsed = displayFields.safeParse(row)
      if (parsed.success) {
        display.set(parsed.data.id, parsed.data)
      }
    }
  }
  const typeIds = [...new Set(items.flatMap(({ workitem_type_id }) => workitem_type_id ? [workitem_type_id] : []))]
  if (kind === 'story' && typeIds.length) {
    const params = new URLSearchParams({
      workspace_id: projectId, id: typeIds.join(','), limit: String(PAGE_SIZE),
      fields: 'id,english_name,name'
    })
    for (const row of await metadata('workitem_types', 'WorkitemType', params, token)) {
      const parsed = itemType.safeParse(row)
      if (parsed.success) {
        const { id, english_name, name } = parsed.data
        categories.set(id, english_name?.toUpperCase() || name || defaultType.story)
      }
    }
  }
  return { display, categories }
}

async function listTapdTodoPage({ projectId, kind, page }: TodoQuery, author: string, token: string) {
  const source = resources[kind]
  const fields = [
    'id', 'workspace_id', source.title, 'status', 'modified', 'due'
  ]
  if (kind === 'board') {
    fields.push('b_board_id', 'owner')
  } else {
    fields.push('priority', 'priority_label', 'v_status')
    if (kind === 'story') fields.push('workitem_type_id')
    if (kind === 'bug') fields.push('project_id', 'deadline')
  }
  const params = new URLSearchParams({
    workspace_id: projectId, limit: String(PAGE_SIZE), page: String(page), fields: fields.join(',')
  })
  const path = kind === 'board' ? source.route : `user_oauth/get_user_todo_${kind}`
  if (kind === 'board') {
    const owner = tapdOwnerFilter(author)
    if (!owner) return invalid
    params.set('owner', owner)
    params.set('status', 'open')
  } else {
    params.set('order', 'id desc')
  }
  const result = await tapdGet(path, params, token)
  if (!result.ok) return result
  const rows = rowsSchema.safeParse(result.value)
  if (!rows.success) return invalid

  let incomplete = false
  const items = rows.data.flatMap((row) => {
    const parsed = rawItemSchema.safeParse(row[source.wrapper])
    if (!parsed.success || !parsed.data[source.title] || !sameProject(parsed.data, projectId)) {
      incomplete = true
      return []
    }
    if (kind === 'board' && (parsed.data.status !== 'open' ||
        !parsed.data.owner?.split(';').some((owner) => owner.trim() === author))) {
      return []
    }
    return [parsed.data]
  })
  const { display, categories } = await todoMetadata(kind, projectId, items, token)
  return {
    ok: true as const,
    value: {
      items: items.map((item) => {
        const details = display.get(item.id)
        const priority = details?.priority_label || item.priority_label || item.priority || ''
        return {
          id: item.id,
          title: item[source.title] ?? '',
          status: item.status ?? '',
          statusLabel: (details?.status === item.status && details?.v_status) || item.v_status || '',
          priority: kind === 'bug' ? priority : priorities.get(priority) ?? priority,
          modified: item.modified ?? '',
          due: normalizedDate(item.due || item.deadline),
          typeLabel: categories.get(item.workitem_type_id ?? '') ?? defaultType[kind]
        }
      }),
      hasMore: rows.data.length === PAGE_SIZE,
      incomplete
    }
  }
}

const PANEL_PAGE_SIZE = 30
const PARALLEL_REQUESTS = 8
export const tapdTodoListQuerySchema = z.object({
  preferredProjectId: tapdTaskIdSchema.optional(),
  projectId: tapdTaskIdSchema.optional(),
  type: z.string().trim().min(1).max(200).optional(),
  updatedYear: z.number().int().min(1970).max(9999).optional(),
  order: z.enum(['due', 'updated']).default('due'),
  page: z.number().int().min(1).max(10_000).default(1),
  refresh: z.boolean().optional()
})

type Session = { id: string; author: string; token: string }
type TodoPage = Extract<Awaited<ReturnType<typeof listTapdTodoPage>>, { ok: true }>
type Todo = TodoPage['value']['items'][number] & { project: TapdProject; kind: TodoKind }
type Scan = {
  accountId: string
  items: Map<string, Todo>
  failures: Set<string>
  finished: number
  total: number | null
  loading: boolean
  error?: Extract<ExternalTaskResult<never>, { ok: false }>
}

export function createTapdTodoList() {
  let current: Scan | null = null

  async function collect(state: Scan, session: Session, preferredProjectId?: string) {
    const result = await listTapdProjects(session.author, session.token)
    if (current !== state) return
    if (!result.ok) {
      state.error = result
      return
    }
    const projects = result.value.sort((a, b) =>
      Number(b.id === preferredProjectId) - Number(a.id === preferredProjectId) ||
      a.name.localeCompare(b.name)
    )
    state.total = projects.length
    const kinds = tapdWorkItemKindSchema.options
    const jobs = projects.flatMap((project) => kinds.map((kind) => ({ project, kind })))
    const unfinished = new Map(projects.map(({ id }) => [id, kinds.length]))
    let nextJob = 0
    await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, jobs.length) }, async () => {
      while (current === state && nextJob < jobs.length) {
        const { project, kind } = jobs[nextJob++]
        for (let page = 1; current === state; page++) {
          const result = await listTapdTodoPage({ projectId: project.id, kind, page }, session.author, session.token)
          if (current !== state) return
          if (!result.ok || result.value.incomplete) state.failures.add(project.id)
          if (!result.ok) break
          for (const item of result.value.items) {
            state.items.set(`${project.id}/${kind}/${item.id}`, { ...item, project, kind })
          }
          if (!result.value.hasMore) break
          if (page === 10_000) {
            state.failures.add(project.id)
            break
          }
        }
        const remaining = (unfinished.get(project.id) ?? 1) - 1
        unfinished.set(project.id, remaining)
        if (!remaining) state.finished++
      }
    }))
  }

  return {
    clear() {
      current = null
    },
    read(query: z.infer<typeof tapdTodoListQuerySchema>, session: Session) {
      if (!current || current.accountId !== session.id || query.refresh) {
        const state: Scan = {
          accountId: session.id,
          items: new Map(),
          failures: new Set(),
          finished: 0,
          total: null,
          loading: true
        }
        current = state
        void collect(state, session, query.preferredProjectId)
          .catch(() => { state.error = { ok: false, code: 'unavailable' } })
          .finally(() => { state.loading = false })
      }
      if (current.error) return current.error
      const items = [...current.items.values()]
      const yearPrefix = query.updatedYear === undefined ? undefined : `${query.updatedYear}-`
      const visible = items.filter((item) =>
        (!query.projectId || item.project.id === query.projectId) &&
        (!query.type || item.typeLabel === query.type) &&
        (!yearPrefix || normalizedDate(item.modified).startsWith(yearPrefix))
      )
      visible.sort((a, b) => {
        const deadline = (a.due || '9999').localeCompare(b.due || '9999')
        return (query.order === 'due' ? deadline : 0) ||
          b.modified.localeCompare(a.modified) || a.title.localeCompare(b.title) ||
          a.project.id.localeCompare(b.project.id) || a.id.localeCompare(b.id) ||
          a.kind.localeCompare(b.kind)
      })
      const offset = (query.page - 1) * PANEL_PAGE_SIZE
      return {
        ok: true as const,
        value: {
          items: visible.slice(offset, offset + PANEL_PAGE_SIZE),
          count: visible.length,
          types: [...new Set(items.map((item) => item.typeLabel))],
          progress: { loading: current.loading, finished: current.finished, total: current.total },
          failures: query.projectId ? Number(current.failures.has(query.projectId)) : current.failures.size,
          hasMore: visible.length > offset + PANEL_PAGE_SIZE
        }
      }
    }
  }
}

export async function getTapdBoardTodo(
  projectId: string, id: string, token: string
): Promise<ExternalTaskResult<z.infer<typeof externalTaskSchema> | null>> {
  const result = await tapdGet(boardResource.route, new URLSearchParams({
    workspace_id: projectId, id, limit: '1'
  }), token)
  if (!result.ok) return result
  const rows = rowsSchema.safeParse(result.value)
  if (!rows.success) return invalid
  if (!rows.data.length) return { ok: true, value: null }
  const parsed = rawItemSchema.safeParse(rows.data[0]?.[boardResource.wrapper])
  if (!parsed.success || parsed.data.id !== id || parsed.data.workspace_id !== projectId ||
      !parsed.data.b_board_id) {
    return invalid
  }
  const item = parsed.data
  const normalized = externalTaskSchema.safeParse({
    id,
    title: item.name,
    status: item.status ?? '',
    assignee: (item.owner ?? '').split(';').filter(Boolean).join(', '),
    modified: item.modified ?? '',
    url: boardUrl(projectId, parsed.data.b_board_id, id),
    ...(item.description ? { description: item.description } : {}),
    ...(item.creator ? { creator: item.creator } : {}),
    details: {
      ...(item.created ? { created: item.created } : {}),
      ...(item.begin ? { begin: item.begin } : {}),
      ...(normalizedDate(item.due) ? { due: normalizedDate(item.due) } : {})
    }
  })
  return normalized.success ? { ok: true, value: normalized.data } : invalid
}
