import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, unlink } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { basename, dirname, isAbsolute } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { TapdAgentHandlers } from './main'
import { MAX_ATTACHMENT_BYTES, tapdAttachmentInputSchema } from './tapd/tapd-attachment-uploads'
import { tapdTaskIdSchema } from './tapd/contracts/tapd-task-ref'
import { tapdSubmissionIdSchema, tapdSubmissionSchema } from './tapd/tapd-submissions'

const resultSchema = z.strictObject({ submissionId: tapdSubmissionIdSchema })
const attachmentSchema = tapdAttachmentInputSchema.pick({ attachmentId: true, contentType: true }).extend({
  path: z.string().max(4096).refine(isAbsolute, 'Use an absolute local file path')
})
const uploadSchema = attachmentSchema.extend({
  submissionId: tapdSubmissionIdSchema,
  confirmed: z.literal(true)
})
const submitSchema = tapdSubmissionSchema.extend({
  attachments: z.array(attachmentSchema).max(5).refine((files) =>
    new Set(files.map(({ attachmentId }) => attachmentId)).size === files.length
  ).optional(),
  confirmed: z.literal(true)
})
const createdReceipt = z.looseObject({
  ok: z.literal(true),
  value: z.looseObject({ id: tapdTaskIdSchema })
})

function resultBody(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}

async function readAttachment(path: string): Promise<string | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ATTACHMENT_BYTES) {
      return null
    }
    const chunks: Buffer[] = []
    for await (const chunk of file.createReadStream({ end: MAX_ATTACHMENT_BYTES, autoClose: false })) {
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    return bytes.length > 0 && bytes.length <= MAX_ATTACHMENT_BYTES ? bytes.toString('base64') : null
  } finally {
    await file.close()
  }
}

async function prepareAttachment({ path, ...file }: z.output<typeof attachmentSchema>) {
  const base64 = await readAttachment(path).catch(() => null)
  return tapdAttachmentInputSchema.safeParse({ ...file, name: basename(path), base64 })
}

function tools(handlers: TapdAgentHandlers) {
  const server = new McpServer({ name: 'tapd-sidebar', version: '0.1.0' })
  server.registerTool('tapd_projects', {
    description: 'List projects accessible to the connected TAPD account.',
    inputSchema: z.strictObject({})
  }, async () => resultBody(await handlers.projects({})))
  server.registerTool('tapd_submit_work_item', {
    description: 'Create a TAPD defect or requirement when the user explicitly requests it. Only include files that the user selected. Generate a UUID for this submission and for each attachment before sending. Reuse the same arguments when retrying. A pending response means the work item may exist.',
    inputSchema: submitSchema
  }, async ({ confirmed: _confirmed, attachments = [], ...payload }) => {
    const files: z.output<typeof tapdAttachmentInputSchema>[] = []
    for (const entry of attachments) {
      const prepared = await prepareAttachment(entry)
      if (!prepared.success) {
        return resultBody({ ok: false, code: 'invalid-attachment', attachmentId: entry.attachmentId })
      }
      files.push(prepared.data)
    }
    const item = await handlers.submit(payload)
    const receipt = createdReceipt.safeParse(item)
    if (!receipt.success || files.length === 0) {
      return resultBody(item)
    }
    const uploads = []
    for (const file of files) {
      const result = await handlers.upload({ submissionId: payload.submissionId, ...file })
      uploads.push({ attachmentId: file.attachmentId, result })
    }
    return resultBody({ ...receipt.data, value: { ...receipt.data.value, attachments: uploads } })
  })
  server.registerTool('tapd_submission_result', {
    description: 'Read the outcome of the original TAPD submission by UUID, without creating another item.',
    inputSchema: resultSchema
  }, async (payload) => resultBody(await handlers.result(payload)))
  server.registerTool('tapd_upload_attachment', {
    description: 'Attach a user-specified local file to a prior TAPD submission. Use the original submission ID and a stable UUID for this file. Reuse both IDs to check or resume the upload.',
    inputSchema: uploadSchema
  }, async ({ submissionId, confirmed: _confirmed, ...entry }) => {
    const prepared = await prepareAttachment(entry)
    return prepared.success
      ? resultBody(await handlers.upload({ submissionId, ...prepared.data }))
      : resultBody({ ok: false, code: 'invalid-attachment', attachmentId: entry.attachmentId })
  })
  return server
}

async function clearStaleSocket(path: string) {
  const existing = await lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (!existing) return
  if (!existing.isSocket() || existing.uid !== process.getuid?.()) {
    throw new Error('Unsafe TAPD MCP socket')
  }
  const refused = await new Promise<boolean>((resolve) => {
    const probe = createConnection(path)
    probe.once('connect', () => { probe.destroy(); resolve(false) })
    probe.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED'))
  })
  const current = await lstat(path)
  if (!refused || existing.ino !== current.ino) {
    throw new Error('Another TAPD MCP worker is already listening')
  }
  await unlink(path)
}

export async function startTapdMcp(path: string, handlers: TapdAgentHandlers) {
  const directory = dirname(path)
  await mkdir(directory, { mode: 0o700, recursive: true })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error('Unsafe TAPD MCP socket directory')
  }
  await clearStaleSocket(path)
  const listener = createServer((socket) => {
    const server = tools(handlers)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => { void server.close().catch(() => undefined) })
    void server.connect(new StdioServerTransport(socket, socket)).catch(() => socket.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(path, resolve)
  })
  await chmod(path, 0o600)
}
