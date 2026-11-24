import * as z from 'zod'
import { tapdTaskIdSchema, tapdTaskKindSchema, boundTapdTaskSchema } from './tapd-task-ref'
import { taskBindingSchema, taskScopeSchema } from './external-task-source'

const title = z.string().trim().min(1).max(4000)
const assignee = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^;\r\n]+$/)
const label = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^|\r\n]+$/)

export const TAPD_DESCRIPTION_MAX_LENGTH = 20_000
export const tapdTaskFieldsSchema = z.object({
  title: title.optional(),
  description: z.string().max(TAPD_DESCRIPTION_MAX_LENGTH).optional(),
  assignee: z.union([assignee, z.literal('')]).optional(),
  priority: z.string().trim().max(200).optional(),
  labels: z.array(label).max(20).optional()
})
export const boundTapdProjectSchema = z.object({
  scope: taskScopeSchema,
  binding: taskBindingSchema.extend({ projectId: tapdTaskIdSchema })
})
export const tapdCreateTaskSchema = boundTapdProjectSchema.extend({
  kind: tapdTaskKindSchema,
  fields: tapdTaskFieldsSchema.extend({ title })
})
export const tapdEditTaskSchema = boundTapdTaskSchema.extend({
  expectedModified: z.string().max(100),
  fields: tapdTaskFieldsSchema.refine((fields) => Object.keys(fields).length > 0)
})

export type TapdTaskFields = z.infer<typeof tapdTaskFieldsSchema>
export type TapdProjectMember = { nick: string; name: string }
