import * as z from 'zod'
import type { ExternalTaskResult } from './contracts/external-task-source'
import { tapdTaskIdSchema } from './contracts/tapd-task-ref'
import { tapdGet, tapdPost } from './tapd-api'

export type TapdAttachmentTarget = { projectId: string; kind: 'story' | 'bug'; id: string }

const attachmentSchema = z.object({
  Attachment: z.object({
    id: tapdTaskIdSchema,
    workspace_id: z.union([tapdTaskIdSchema, z.number().int().positive()]).transform(String),
    entry_id: tapdTaskIdSchema,
    type: z.string(),
    filename: z.string()
  })
})

function attachmentScope({ projectId, kind, id }: TapdAttachmentTarget) {
  return { workspace_id: projectId, type: kind, entry_id: id }
}

export async function findTapdAttachment(
  target: TapdAttachmentTarget,
  filename: string,
  token: string
): Promise<ExternalTaskResult<{ id: string; filename: string } | null>> {
  const params = new URLSearchParams({ ...attachmentScope(target), filename, limit: '200' })
  const result = await tapdGet('attachments', params, token)
  if (!result.ok) {
    return result
  }
  const rows = z.array(attachmentSchema).safeParse(result.value)
  if (!rows.success) {
    return { ok: false, code: 'invalid' }
  }
  const matching = rows.data.map(({ Attachment }) => Attachment).filter((item) =>
    item.workspace_id === target.projectId &&
    item.entry_id === target.id &&
    item.type === target.kind &&
    item.filename === filename
  )
  if (matching.length > 1) {
    return { ok: false, code: 'conflict' }
  }
  const [attachment] = matching
  return { ok: true, value: attachment ? { id: attachment.id, filename } : null }
}

export function postTapdAttachment(
  target: TapdAttachmentTarget,
  filename: string,
  file: Blob,
  token: string
) {
  const form = new FormData()
  for (const [field, value] of Object.entries(attachmentScope(target))) {
    form.set(field, value)
  }
  form.set('file', file, filename)
  return tapdPost('files/upload_attachment', form, token)
}
