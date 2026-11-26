import * as z from 'zod'
import type { PluginWorkerOrcaApi } from '../plugin-worker-api'
import { tapdTaskIdSchema } from './contracts/tapd-task-ref'
import { findTapdAttachment, postTapdAttachment, type TapdAttachmentTarget } from './tapd-attachments'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const tapdAttachmentInputSchema = z.strictObject({
  attachmentId: z.uuid().transform((id) => id.toLowerCase()),
  name: z.string().trim().min(1).max(160).regex(/^[^/\\\u0000-\u001f\u007f]+$/u),
  contentType: z.string().max(120).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu)
    .default('application/octet-stream'),
  base64: z.base64().min(1).max(4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3))
})

type AttachmentInput = z.output<typeof tapdAttachmentInputSchema>
const storageError = { ok: false, code: 'storage' } as const
const classifiableRejection = z.enum(['credentials', 'permission', 'rate-limit'])
const recordFields = {
  digest: z.string(),
  filename: z.string()
}
const recordSchema = z.discriminatedUnion('status', [
  z.object({ ...recordFields, status: z.literal('pending') }),
  z.object({ ...recordFields, status: z.literal('retryable') }),
  z.object({ ...recordFields, status: z.literal('uploaded'), id: tapdTaskIdSchema })
])
type UploadRecord = z.output<typeof recordSchema>

export function createTapdAttachmentUploads(storage: PluginWorkerOrcaApi['storage']) {
  const active = new Set<string>()

  async function persist(key: string, record: UploadRecord) {
    try {
      await storage.set(key, record)
      return true
    } catch {
      return false
    }
  }

  async function read(key: string) {
    try {
      const value = await storage.get(key)
      if (value == null) {
        return { ok: true, value: null } as const
      }
      const parsed = recordSchema.safeParse(value)
      return parsed.success ? { ok: true, value: parsed.data } as const : storageError
    } catch {
      return storageError
    }
  }

  async function upload(
    submissionId: string,
    target: TapdAttachmentTarget,
    input: AttachmentInput,
    connection: { id: string; token: string }
  ) {
    const { attachmentId, name, contentType, base64 } = input
    const key = `tapd-attachment:${connection.id}:${submissionId}:${attachmentId}`
    if (active.has(key)) {
      return { ok: false, code: 'busy' } as const
    }
    active.add(key)
    try {
      const stored = await read(key)
      if (!stored.ok) {
        return stored
      }
      let bytes: Uint8Array<ArrayBuffer>
      try {
        bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
      } catch {
        return { ok: false, code: 'invalid' } as const
      }
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        return { ok: false, code: 'attachment-too-large' } as const
      }
      const hash = await crypto.subtle.digest('SHA-256', bytes)
      const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const dot = name.lastIndexOf('.')
      const filename = dot > 0
        ? `${name.slice(0, dot)}-${attachmentId}${name.slice(dot)}`
        : `${name}-${attachmentId}`
      const previous = stored.value
      if (previous && (previous.digest !== digest || previous.filename !== filename)) {
        return { ok: false, code: 'conflict' } as const
      }
      const summary = { submissionId, attachmentId, name, filename }
      if (previous?.status === 'uploaded') {
        return { ok: true, value: { ...summary, status: 'uploaded', id: previous.id } } as const
      }
      const pending = { digest, filename, status: 'pending' } as const
      if (previous?.status !== 'pending') {
        if (!(await persist(key, pending))) {
          return storageError
        }
        const result = await postTapdAttachment(
          target, filename, new Blob([bytes], { type: contentType }), connection.token
        )
        if (!result.ok && classifiableRejection.safeParse(result.code).success) {
          if (await persist(key, { ...pending, status: 'retryable' })) {
            return { ok: true, value: { ...summary, status: 'retryable', reason: result.code } } as const
          }
        }
      }

      const item = await findTapdAttachment(target, filename, connection.token)
      if (!item.ok || !item.value) {
        return { ok: true, value: { ...summary, status: 'pending' } } as const
      }
      const id = item.value.id
      await persist(key, { ...pending, status: 'uploaded', id })
      return { ok: true, value: { ...summary, status: 'uploaded', id } } as const
    } finally {
      active.delete(key)
    }
  }

  return { upload }
}
