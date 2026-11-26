import * as z from 'zod'
import { externalTaskRefSchema, taskScopeSchema } from './external-task-source'

export const tapdTaskIdSchema = z.string().regex(/^[1-9]\d{0,29}$/)
export const tapdTaskKindSchema = z.enum(['story', 'bug', 'task'])
export const tapdWorkItemKindSchema = z.enum([...tapdTaskKindSchema.options, 'board'])
export const tapdTaskRefSchema = externalTaskRefSchema.extend({
  sourceId: z.literal('tapd'),
  kind: tapdTaskKindSchema,
  id: tapdTaskIdSchema,
  projectId: tapdTaskIdSchema
})
export const boundTapdTaskSchema = z.object({ scope: taskScopeSchema, ref: tapdTaskRefSchema })

export type TapdTaskKind = z.infer<typeof tapdTaskKindSchema>
export type TapdTaskRef = z.infer<typeof tapdTaskRefSchema>
