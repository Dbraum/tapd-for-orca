import * as z from 'zod'

const key = z.string().trim().min(1).max(200)
const filter = z.string().trim().min(1).max(200).optional()
export const externalTaskUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
    } catch {
      return false
    }
  })

export const taskScopeSchema = z.object({ kind: z.enum(['project', 'group']), id: key })
export const taskBindingSchema = z.object({ connectionId: key, projectId: key })
export const externalTaskQuerySchema = z.object({
  ...taskBindingSchema.shape,
  kind: key,
  page: z.number().int().min(1).max(10_000),
  status: filter,
  assignee: filter,
  search: filter,
  priority: filter,
  label: filter,
  sort: z.enum(['newest', 'updated']).optional(),
  assignedToMe: z.boolean().optional()
})
export const externalTaskRefSchema = z.object({
  ...taskBindingSchema.shape,
  sourceId: key,
  kind: key,
  id: key
})
const taskDetailsSchema = z.object({
  created: z.string().optional(),
  begin: z.string().optional(),
  due: z.string().optional(),
  completed: z.string().optional(),
  iterationId: key.optional(),
  relatedStoryId: key.optional(),
  developer: z.string().optional(),
  module: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  effort: z.number().min(0).optional(),
  completedEffort: z.number().min(0).optional(),
  remainingEffort: z.number().min(0).optional()
})
export const externalTaskSchema = z.object({
  id: key,
  title: z.string().trim().min(1).max(4000),
  url: externalTaskUrlSchema,
  status: z.string().max(200),
  assignee: z.string().max(1000),
  modified: z.string().max(100),
  description: z.string().max(200_000).optional(),
  creator: z.string().trim().min(1).max(200).optional(),
  priority: z.string().trim().min(1).max(200).optional(),
  labels: z.array(key).max(20).optional(),
  statusLabel: z.string().trim().min(1).max(200).optional(),
  workItemTypeId: key.optional(),
  details: taskDetailsSchema.optional()
})
const externalTaskPageSchema = z.object({
  items: z.array(externalTaskSchema).max(50),
  hasMore: z.boolean()
})
export type TaskBinding = z.infer<typeof taskBindingSchema>
export type ExternalTaskQuery = z.infer<typeof externalTaskQuerySchema>
export type ExternalTaskRef = z.infer<typeof externalTaskRefSchema>
export type ExternalTask = z.infer<typeof externalTaskSchema>
export type ExternalTaskPage = z.infer<typeof externalTaskPageSchema>
export type TapdProject = { id: string; name: string }

export type ExternalTaskResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      code:
        | 'conflict'
        | 'credentials'
        | 'permission'
        | 'not-found'
        | 'rate-limit'
        | 'unavailable'
        | 'invalid'
        | 'storage'
    }
