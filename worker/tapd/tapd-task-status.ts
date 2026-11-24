import * as z from 'zod'
import type { ExternalTask, ExternalTaskResult } from './contracts/external-task-source'
import type { TapdTaskRef } from './contracts/tapd-task-ref'
import type { TapdStatusMenuData } from './contracts/tapd-task-status'
import { tapdGet, tapdPost } from './tapd-api'
import { getTapdTask, tapdTaskResource } from './tapd-task-source'

const statusKey = z.string().trim().min(1).max(200)
const labelsSchema = z.record(statusKey, statusKey)
const taskStatusSchema = z.object({ status: z.object({ options: labelsSchema }) })
const transitionSchema = z.object({
  StepPrevious: statusKey,
  StepNext: statusKey,
  Appendfield: z.array(z.object({ Notnull: z.enum(['yes', 'no']) })).nullish()
})
const transitionsSchema = z.union([z.array(transitionSchema).max(2000), transitionSchema])
const updatedItemSchema = z.object({
  id: z.string(),
  workspace_id: z.union([z.string(), z.number()])
})
const invalid = { ok: false, code: 'invalid' } as const

function currentStatus(item: ExternalTask, labels: Record<string, string>): string {
  if (Object.hasOwn(labels, item.status)) {
    return item.status
  }
  return Object.entries(labels).find(([, label]) => label === item.status)?.[0] ?? item.status
}

async function loadStatusMenu(
  ref: TapdTaskRef,
  item: ExternalTask,
  token: string
): Promise<ExternalTaskResult<TapdStatusMenuData>> {
  const params = new URLSearchParams({ workspace_id: ref.projectId })
  if (ref.kind === 'task') {
    const result = await tapdGet('tasks/get_fields_info', params, token)
    if (!result.ok) {
      return result
    }
    const fields = taskStatusSchema.safeParse(result.value)
    if (!fields.success) {
      return invalid
    }
    const labels = fields.data.status.options
    const current = currentStatus(item, labels)
    return {
      ok: true,
      value: {
        current,
        options: Object.entries(labels).flatMap(([id, label]) =>
          id === current ? [] : [{ id, label, requiresFields: false }]
        )
      }
    }
  }
  params.set('system', ref.kind)
  if (ref.kind === 'story') {
    if (!item.workItemTypeId) {
      return invalid
    }
    params.set('workitem_type_id', item.workItemTypeId)
  }
  const [statusMap, transitions] = await Promise.all([
    tapdGet('workflows/status_map', params, token),
    tapdGet('workflows/all_transitions', params, token)
  ])
  if (!statusMap.ok) {
    return statusMap
  }
  if (!transitions.ok) {
    return transitions
  }
  const labels = labelsSchema.safeParse(statusMap.value)
  const rules = transitionsSchema.safeParse(transitions.value)
  if (!labels.success || !rules.success) {
    return invalid
  }
  const current = currentStatus(item, labels.data)
  const options = new Map<string, boolean>()
  for (const rule of Array.isArray(rules.data) ? rules.data : [rules.data]) {
    if (
      rule.StepPrevious !== current ||
      rule.StepNext === current ||
      !Object.hasOwn(labels.data, rule.StepNext)
    ) {
      continue
    }
    const requiresFields = rule.Appendfield?.some(({ Notnull }) => Notnull === 'yes') ?? false
    options.set(rule.StepNext, (options.get(rule.StepNext) ?? false) || requiresFields)
  }
  return {
    ok: true,
    value: {
      current,
      options: Array.from(options, ([id, requiresFields]) => ({
        id,
        label: labels.data[id],
        requiresFields
      }))
    }
  }
}

export async function listTapdStatusOptions(
  ref: TapdTaskRef,
  token: string
): Promise<ExternalTaskResult<TapdStatusMenuData>> {
  const current = await getTapdTask(ref, token)
  if (!current.ok) {
    return current
  }
  return current.value
    ? loadStatusMenu(ref, current.value, token)
    : { ok: false, code: 'not-found' }
}

export async function updateTapdStatus(
  ref: TapdTaskRef,
  expectedStatus: string,
  status: string,
  { author, token }: { author: string; token: string }
): Promise<ExternalTaskResult<ExternalTask>> {
  const current = await getTapdTask(ref, token)
  if (!current.ok) {
    return current
  }
  if (!current.value) {
    return { ok: false, code: 'not-found' }
  }
  const menu = await loadStatusMenu(ref, current.value, token)
  if (!menu.ok) {
    return menu
  }
  const option = menu.value.options.find(
    ({ id, requiresFields }) => id === status && !requiresFields
  )
  if (menu.value.current !== expectedStatus || !option) {
    return { ok: false, code: 'conflict' }
  }
  const { route, wrapper } = tapdTaskResource[ref.kind]
  const result = await tapdPost(
    route,
    new URLSearchParams({
      workspace_id: ref.projectId,
      id: ref.id,
      status: option.id,
      current_user: author
    }),
    token
  )
  if (!result.ok) {
    return result
  }
  const parsed = z.object({ [wrapper]: updatedItemSchema }).safeParse(result.value)
  const updated = parsed.success ? parsed.data[wrapper] : undefined
  if (updated?.id !== ref.id || String(updated.workspace_id) !== ref.projectId) {
    return invalid
  }
  const refreshed = await getTapdTask(ref, token)
  if (refreshed.ok && refreshed.value) {
    const item = refreshed.value
    if (!item.statusLabel && item.status === option.id) {
      item.statusLabel = option.label
    }
    return { ok: true, value: item }
  }
  return {
    ok: true,
    value: { ...current.value, status: option.id, statusLabel: option.label }
  }
}
