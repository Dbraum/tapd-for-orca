import * as z from 'zod'
import type { ExternalTaskResult } from './contracts/external-task-source'
import { tapdGet } from './tapd-api'

const MAX_IMAGE_BYTES = 6 * 1024 * 1024
// Keep the encoded chunk below Orca's 1 MiB response limit and padding at the end.
const CHUNK_BYTES = 3 * 192 * 1024
const IMAGE_CACHE_LIMIT = 3
const IMAGE_CACHE_MS = 120_000
const tapdImageOrigins = new Set(['https://www.tapd.cn', 'https://tapd.cn', 'https://file.tapd.cn'])
const attachmentSchema = z.object({
  Attachment: z.object({
    workspace_id: z.union([z.string(), z.number().int().safe()]),
    download_url: z.string().url().max(8192)
  })
})

type Image = { mime: string; bytes: Uint8Array }
type CachedImage = Image & { sessionId: string; expiresAt: number }
type Chunk = { mime: string; base64: string; next?: { handle: string; index: number } }

function tapdImagePath(source: string): string | null {
  try {
    const url = new URL(source, 'https://www.tapd.cn')
    return tapdImageOrigins.has(url.origin) && !url.username && !url.password &&
      url.pathname.startsWith('/tfl/') && /\.(png|gif|jpe?g|bmp|webp)$/i.test(url.pathname)
      ? url.pathname
      : null
  } catch {
    return null
  }
}

async function readImage(response: Response): Promise<Uint8Array | null> {
  if (!response.body || !response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel()
        return null
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function imageMime(bytes: Uint8Array): string | null {
  const header = String.fromCharCode(...bytes.subarray(0, 12))
  if (header.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
  if (header.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (/^GIF8[79]a/.test(header)) return 'image/gif'
  if (header.length >= 12 && header.startsWith('BM')) return 'image/bmp'
  if (header.startsWith('RIFF') && header.endsWith('WEBP')) return 'image/webp'
  return null
}

async function downloadTapdImage(
  projectId: string,
  imagePath: string,
  token: string
): Promise<ExternalTaskResult<Image>> {
  const path = tapdImagePath(imagePath)
  if (!path) return { ok: false, code: 'invalid' }
  const result = await tapdGet(
    'files/get_image',
    new URLSearchParams({ workspace_id: projectId, image_path: path }),
    token
  )
  if (!result.ok) return result
  const parsed = attachmentSchema.safeParse(result.value)
  if (!parsed.success || String(parsed.data.Attachment.workspace_id) !== projectId) {
    return { ok: false, code: 'invalid' }
  }
  const url = new URL(parsed.data.Attachment.download_url)
  if (url.origin !== 'https://file.tapd.cn' || url.username || url.password) {
    return { ok: false, code: 'invalid' }
  }
  try {
    // The signed URL already authorizes the download. Send the token only to the TAPD API.
    const bytes = await readImage(await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    }))
    const mime = bytes && imageMime(bytes)
    return mime && bytes ? { ok: true, value: { mime, bytes } } : { ok: false, code: 'invalid' }
  } catch {
    return { ok: false, code: 'unavailable' }
  }
}

function imageChunk(image: Image, handle: string, index: number): ExternalTaskResult<Chunk> {
  const start = index * CHUNK_BYTES
  if (start >= image.bytes.length) return { ok: false, code: 'not-found' }
  const end = Math.min(start + CHUNK_BYTES, image.bytes.length)
  let binary = ''
  for (let offset = start; offset < end; offset += 8192) {
    binary += String.fromCharCode(...image.bytes.subarray(offset, Math.min(offset + 8192, end)))
  }
  return {
    ok: true,
    value: {
      mime: image.mime,
      base64: btoa(binary),
      ...(end < image.bytes.length ? { next: { handle, index: index + 1 } } : {})
    }
  }
}

export function createTapdImagePreview() {
  const cache = new Map<string, CachedImage>()
  let generation = 0
  return {
    clear() {
      generation += 1
      cache.clear()
    },
    async load(projectId: string, path: string, session: { id: string; token: string }) {
      const current = generation
      const result = await downloadTapdImage(projectId, path, session.token)
      if (!result.ok) return result
      if (generation !== current) return { ok: false, code: 'credentials' } as const
      const image = result.value
      const handle = crypto.randomUUID()
      if (image.bytes.length > CHUNK_BYTES) {
        cache.set(handle, { ...image, sessionId: session.id, expiresAt: Date.now() + IMAGE_CACHE_MS })
        const oldest = cache.keys().next().value
        if (cache.size > IMAGE_CACHE_LIMIT && oldest) {
          cache.delete(oldest)
        }
      }
      return imageChunk(image, handle, 0)
    },
    chunk(sessionId: string, handle: string, index: number): ExternalTaskResult<Chunk> {
      const image = cache.get(handle)
      if (!image || image.sessionId !== sessionId || image.expiresAt <= Date.now()) {
        return { ok: false, code: 'not-found' }
      }
      return imageChunk(image, handle, index)
    }
  }
}
