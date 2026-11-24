import * as z from 'zod'
import { boundTapdTaskSchema } from './tapd-task-ref'

const status = z.string().trim().min(1).max(200)
export const tapdStatusUpdateSchema = boundTapdTaskSchema.extend({
  expectedStatus: status,
  status
})

export type TapdStatusOption = {
  id: string
  label: string
  requiresFields: boolean
}

export type TapdStatusMenuData = { current: string; options: TapdStatusOption[] }
