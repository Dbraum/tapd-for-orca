import * as z from 'zod'
import type { ExternalTaskResult } from './contracts/external-task-source'
import type { TapdTaskComment, TapdTaskComments } from './contracts/tapd-task-comments'
import type { TapdTaskRef } from './contracts/tapd-task-ref'
import { tapdGet, tapdPost } from './tapd-api'
import { tapdMarkdownHtml } from './tapd-text'

const PAGE_SIZE = 30
const entryTypes = { story: 'stories', bug: 'bug', task: 'tasks' } as const

const commentSchema = z.object({
  Comment: z.object({
    id: z.string().regex(/^[1-9]\d{0,29}$/),
    author: z.string().max(200),
    title: z.string().max(1000).nullish(),
    description: z.string().max(200_000).nullish(),
    created: z.string().max(100),
    workspace_id: z.union([z.string(), z.number().int().positive()]),
    entry_id: z.string(),
    entry_type: z.string()
  })
})
type RawComment = z.infer<typeof commentSchema>['Comment']

function commentTarget(ref: TapdTaskRef, entryType: string): URLSearchParams {
  return new URLSearchParams({
    workspace_id: ref.projectId,
    entry_id: ref.id,
    entry_type: entryType
  })
}

function isForTask(comment: RawComment, ref: TapdTaskRef): boolean {
  return (
    String(comment.workspace_id) === ref.projectId &&
    comment.entry_id === ref.id &&
    (comment.entry_type === entryTypes[ref.kind] ||
      (ref.kind === 'bug' && comment.entry_type === 'bug_remark'))
  )
}

function toComment(comment: RawComment): TapdTaskComment {
  return {
    id: comment.id,
    author: comment.author,
    title: comment.title ?? '',
    body: comment.description ?? '',
    created: comment.created
  }
}

export async function listTapdComments(
  ref: TapdTaskRef,
  page: number,
  token: string
): Promise<ExternalTaskResult<TapdTaskComments>> {
  const params = commentTarget(ref, ref.kind === 'bug' ? 'bug|bug_remark' : entryTypes[ref.kind])
  params.set('page', String(page))
  params.set('limit', String(PAGE_SIZE))
  params.set('order', 'id desc')
  const result = await tapdGet('comments', params, token)
  if (!result.ok) {
    return result
  }
  const rows = z.array(commentSchema).max(PAGE_SIZE).safeParse(result.value)
  if (!rows.success || rows.data.some(({ Comment }) => !isForTask(Comment, ref))) {
    return { ok: false, code: 'invalid' }
  }
  return {
    ok: true,
    value: {
      items: rows.data.map(({ Comment }) => toComment(Comment)),
      hasMore: rows.data.length === PAGE_SIZE
    }
  }
}

export async function addTapdComment(
  ref: TapdTaskRef,
  body: string,
  author: string,
  token: string
): Promise<ExternalTaskResult<TapdTaskComment>> {
  const params = commentTarget(ref, entryTypes[ref.kind])
  params.set('description', tapdMarkdownHtml(body))
  params.set('author', author)
  const result = await tapdPost('comments', params, token)
  if (!result.ok) {
    return result
  }
  const response = commentSchema.safeParse(result.value)
  if (!response.success || !isForTask(response.data.Comment, ref)) {
    return { ok: false, code: 'invalid' }
  }
  return { ok: true, value: toComment(response.data.Comment) }
}
