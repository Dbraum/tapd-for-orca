import * as z from 'zod'
import { boundTapdTaskSchema } from './tapd-task-ref'

export const tapdCommentPageSchema = z.number().int().min(1).max(10_000)
export const TAPD_MAX_COMMENT_LENGTH = 20_000
export const tapdCommentBodySchema = z.string().trim().min(1).max(TAPD_MAX_COMMENT_LENGTH)
export const tapdCommentWriteSchema = boundTapdTaskSchema.extend({ body: tapdCommentBodySchema })

export type TapdTaskComment = {
  id: string
  author: string
  title: string
  body: string
  created: string
}
export type TapdTaskComments = { items: TapdTaskComment[]; hasMore: boolean }
