import * as z from 'zod'
import type { PluginWorkerOrcaApi } from '../plugin-worker-api'
import { tapdCreateTaskSchema } from './contracts/tapd-task-fields'
import { tapdTaskIdSchema } from './contracts/tapd-task-ref'
import { createTapdTask, listTapdProjectMembers } from './tapd-task-fields'
import { getTapdTask, listTapdProjects, tapdTaskUrl } from './tapd-task-source'

export const tapdSubmissionIdSchema = z.uuid().transform((id) => id.toLowerCase())
const projectSchema = z.object({ id: tapdTaskIdSchema, name: z.string() })
const kindSchema = z.enum(['story', 'bug'])

export const tapdSubmissionSchema = z.strictObject({
  submissionId: tapdSubmissionIdSchema,
  project: z.string().trim().min(1).max(4000),
  kind: kindSchema,
  fields: z.strictObject(tapdCreateTaskSchema.shape.fields.pick({
    title: true,
    description: true,
    assignee: true
  }).shape)
})

const recordFields = {
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  project: projectSchema,
  kind: kindSchema
}
const rejectionSchema = z.enum(['credentials', 'permission', 'rate-limit'])
const recordSchema = z.discriminatedUnion('status', [
  z.object({ ...recordFields, status: z.literal('pending') }),
  z.object({ ...recordFields, status: z.literal('created'), id: tapdTaskIdSchema }),
  z.object({ ...recordFields, status: z.literal('rejected'), reason: rejectionSchema })
])

type Submission = z.output<typeof tapdSubmissionSchema>
type SubmissionRecord = z.output<typeof recordSchema>
type Connection = { id: string; author: string; token: string }
const storageError = { ok: false, code: 'storage' } as const

async function fingerprint({ project, kind, fields }: Submission): Promise<string> {
  const input = JSON.stringify([project, kind, fields.title, fields.description, fields.assignee])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createTapdSubmissions(storage: PluginWorkerOrcaApi['storage']) {
  const active = new Set<string>()
  const keyFor = (accountId: string, submissionId: string) => `tapd-submission:${accountId}:${submissionId}`

  async function read(key: string) {
    try {
      const stored = await storage.get(key)
      if (stored == null) {
        return { ok: true, value: null } as const
      }
      const parsed = recordSchema.safeParse(stored)
      return parsed.success ? { ok: true, value: parsed.data } as const : storageError
    } catch {
      return storageError
    }
  }

  async function persist(key: string, record: SubmissionRecord) {
    try {
      await storage.set(key, record)
      return true
    } catch {
      return false
    }
  }

  async function receipt(submissionId: string, record: SubmissionRecord, connection: Connection) {
    const summary = { submissionId, project: record.project, kind: record.kind }
    if (record.status === 'pending') {
      return { ok: true, value: { ...summary, status: 'pending' } } as const
    }
    if (record.status === 'rejected') {
      return { ok: true, value: { ...summary, status: 'rejected', reason: record.reason } } as const
    }
    const { id, kind, project } = record
    const item = await getTapdTask(
      { connectionId: connection.id, projectId: project.id, sourceId: 'tapd', kind, id },
      connection.token,
      { requireAssignee: true }
    )
    const details = { ...summary, id, url: tapdTaskUrl(project.id, kind, id) }
    if (!item.ok || !item.value) {
      return { ok: true, value: { ...details, status: 'pending' } } as const
    }
    return {
      ok: true,
      value: { ...details, status: 'created', assignee: item.value.assignee }
    } as const
  }

  async function submit(input: Submission, connection: Connection) {
    const { submissionId, kind, fields } = input
    const key = keyFor(connection.id, submissionId)
    if (active.has(key)) {
      return { ok: false, code: 'busy' } as const
    }
    active.add(key)
    try {
      const stored = await read(key)
      if (!stored.ok) {
        return stored
      }
      const inputFingerprint = await fingerprint(input)
      if (stored.value) {
        return stored.value.fingerprint === inputFingerprint
          ? await receipt(submissionId, stored.value, connection)
          : { ok: false, code: 'conflict' } as const
      }

      const projects = await listTapdProjects(connection.author, connection.token)
      if (!projects.ok) {
        return projects
      }
      const exact = projects.value.find(({ id }) => id === input.project)
      const matches = exact ? [exact] : projects.value.filter(({ name }) => name === input.project)
      if (matches.length !== 1) {
        return matches.length === 0
          ? { ok: false, code: 'project-not-found' } as const
          : { ok: false, code: 'project-ambiguous', matches } as const
      }
      const [project] = matches
      const binding = { connectionId: connection.id, projectId: project.id }
      let assignee: string | undefined
      if (fields.assignee) {
        const members = await listTapdProjectMembers(binding, connection.token)
        if (!members.ok) {
          return members
        }
        const exact = members.value.find(({ nick }) => nick === fields.assignee)
        const matches = exact
          ? [exact]
          : members.value.filter(({ name }) => name === fields.assignee)
        if (matches.length !== 1) {
          return matches.length === 0
            ? { ok: false, code: 'assignee-not-found' } as const
            : { ok: false, code: 'assignee-ambiguous', matches } as const
        }
        assignee = matches[0].nick
      }

      const pending = { fingerprint: inputFingerprint, project, kind, status: 'pending' } as const
      // Once a create may have been sent, replay must never send it again.
      if (!(await persist(key, pending))) {
        return storageError
      }
      const created = await createTapdTask(binding, kind, { ...fields, assignee }, connection)
      if (!created.ok) {
        const reason = rejectionSchema.safeParse(created.code)
        if (reason.success) {
          const rejected = { ...pending, status: 'rejected', reason: reason.data } as const
          await persist(key, rejected)
          return receipt(submissionId, rejected, connection)
        }
        return receipt(submissionId, pending, connection)
      }

      const saved = { ...pending, status: 'created', id: created.value.id } as const
      if (!(await persist(key, saved))) {
        return {
          ok: true,
          value: {
            submissionId,
            project,
            kind,
            id: saved.id,
            url: tapdTaskUrl(project.id, kind, saved.id),
            status: 'pending',
            reason: 'storage'
          }
        } as const
      }
      return receipt(submissionId, saved, connection)
    } finally {
      active.delete(key)
    }
  }

  async function result(submissionId: string, connection: Connection) {
    const stored = await read(keyFor(connection.id, submissionId))
    if (!stored.ok) {
      return stored
    }
    return stored.value
      ? receipt(submissionId, stored.value, connection)
      : { ok: false, code: 'not-found' } as const
  }

  return { submit, result }
}
