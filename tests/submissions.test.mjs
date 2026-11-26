import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import activate from '../worker.mjs'

const project = { id: '12345678', name: 'Test project' }
const id = '1012345678000000001'
const submission = {
  submissionId: 'e5ca9c86-9dd6-4ff4-9025-dd51e88d739d',
  project: project.name,
  kind: 'bug',
  fields: { title: 'Example defect', description: 'Test description', assignee: 'Test Member' }
}
const tapd = (data) => Response.json({ status: 1, data })
const projects = (...entries) => tapd(entries.map((Workspace) => ({ Workspace })))
const members = (...entries) => tapd(entries.map((UserWorkspace) => ({ UserWorkspace })))
const receipt = {
  project,
  kind: submission.kind,
  submissionId: submission.submissionId
}

function bridge(records = new Map(), accountId = '19', store) {
  const handlers = new Map()
  activate({
    panels: { handle: (name, handler) => handlers.set(name, handler) },
    secrets: {
      get: async () => JSON.stringify({ id: accountId, author: 'reporter', token: 'fixture-token' })
    },
    storage: store ?? {
      get: async (key) => structuredClone(records.get(key)),
      set: async (key, value) => { records.set(key, structuredClone(value)) }
    }
  })
  const invoke = async (method, payload) => z.json().parse(await handlers.get(method)(payload))
  return {
    submit: (input = submission) => invoke('submit-work-item', input),
    result: (submissionId = submission.submissionId) =>
      invoke('submission-result', { submissionId }),
    upload: (input) => invoke('upload-submission-attachment', input)
  }
}

test('submissions read the actual assignee from TAPD and replay their recorded ID', async (t) => {
  const records = new Map()
  const request = t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    assert.equal(url.origin, 'https://api.tapd.cn')
    if (url.pathname === '/workspaces/user_participant_projects') {
      return projects(project)
    }
    if (url.pathname === '/workspaces/users') {
      assert.equal(url.searchParams.get('workspace_id'), project.id)
      return members({ user: 'member-nick', name: 'Test Member' })
    }
    assert.equal(url.pathname, '/bugs')
    const Bug = { id, workspace_id: project.id, title: 'Example defect' }
    if (options.method === 'POST') {
      assert.equal(options.body.get('current_owner'), 'member-nick')
      assert.equal([...records.values()][0].status, 'pending')
      return tapd({ Bug: { ...Bug, current_owner: 'unverified-post-value' } })
    }
    assert.equal(url.searchParams.get('id'), id)
    assert.equal([...records.values()][0].id, id)
    return tapd([{ Bug: { ...Bug, current_owner: 'actual-owner' } }])
  })
  const expected = {
    ok: true,
    value: {
      ...receipt,
      status: 'created',
      id,
      url: `https://www.tapd.cn/tapd_fe/${project.id}/bug/detail/${id}`,
      assignee: 'actual-owner'
    }
  }
  assert.deepEqual(await bridge(records).submit(), expected)
  const restarted = bridge(records)
  assert.deepEqual(await restarted.submit(), expected)
  assert.deepEqual(await restarted.result(), expected)
  assert.deepEqual(await restarted.submit({
    ...submission,
    fields: { ...submission.fields, title: 'Different defect' }
  }), { ok: false, code: 'conflict' })
  assert.deepEqual(await bridge(records, '20').result(), { ok: false, code: 'not-found' })
  assert.equal(request.mock.calls.filter(({ arguments: [, options] }) => options.method === 'POST').length, 1)
  const [stored] = records.values()
  assert.equal(Object.hasOwn(stored, 'fields'), false)
  assert.equal(Object.hasOwn(stored, 'token'), false)
})

test('a lost create response stays pending across concurrent calls and worker restart', async (t) => {
  const records = new Map()
  const requestStarted = Promise.withResolvers()
  const response = Promise.withResolvers()
  const request = t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (options.method === 'POST') {
      assert.equal(new URL(input).pathname, '/stories')
      requestStarted.resolve()
      return response.promise
    }
    return projects(project)
  })
  const story = { ...submission, kind: 'story', fields: { title: 'Example story' } }
  const worker = bridge(records)
  const running = worker.submit(story)
  await requestStarted.promise
  assert.deepEqual(await worker.submit(story), { ok: false, code: 'busy' })
  response.reject(new DOMException('Timed out after TAPD committed', 'TimeoutError'))
  const expected = { ok: true, value: { ...receipt, kind: 'story', status: 'pending' } }
  assert.deepEqual(await running, expected)
  assert.deepEqual(await bridge(records).submit(story), expected)
  assert.deepEqual(await bridge(records).result(), expected)
  assert.equal(request.mock.callCount(), 2)
})

test('ambiguous projects or members are reported before creating a work item', async (t) => {
  const secondProject = { id: '23456789', name: project.name }
  const duplicateMembers = [
    { user: 'member-one', name: 'Test Member' },
    { user: 'member-two', name: 'Test Member' }
  ]
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.equal(options.method, 'GET')
    return new URL(input).pathname === '/workspaces/users'
      ? members(...duplicateMembers)
      : projects(project, secondProject)
  })
  const worker = bridge()
  assert.deepEqual(await worker.submit(), {
    ok: false, code: 'project-ambiguous', matches: [project, secondProject]
  })
  assert.deepEqual(await worker.submit({ ...submission, project: project.id }), {
    ok: false,
    code: 'assignee-ambiguous',
    matches: duplicateMembers.map(({ user, name }) => ({ nick: user, name }))
  })
})

test('a known work item stays pending until its assignee can be read back', async (t) => {
  const records = new Map()
  let verified = false
  const request = t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    if (url.pathname === '/workspaces/user_participant_projects') {
      return projects(project)
    }
    assert.equal(url.pathname, '/stories')
    const Story = { id, workspace_id: project.id, name: 'Example story' }
    if (options.method === 'POST') {
      return tapd({ Story })
    }
    return tapd([{ Story: verified ? { ...Story, owner: null } : Story }])
  })
  const story = { ...submission, kind: 'story', fields: { title: 'Example story' } }
  const expected = {
    ...receipt, kind: 'story', id, url: `https://www.tapd.cn/tapd_fe/${project.id}/story/detail/${id}`
  }
  assert.deepEqual(await bridge(records).submit(story), {
    ok: true, value: { ...expected, status: 'pending' }
  })
  verified = true
  assert.deepEqual(await bridge(records).result(), {
    ok: true, value: { ...expected, status: 'created', assignee: '' }
  })
  assert.equal(request.mock.callCount(), 4)
})

test('failed persistence does not allow a create to be sent without a pending record', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.equal(options.method, 'GET')
    assert.equal(new URL(input).pathname, '/workspaces/user_participant_projects')
    return projects(project)
  })
  const worker = bridge(undefined, '19', {
    get: async () => null,
    set: async () => { throw new Error('Unable to persist') }
  })
  assert.deepEqual(await worker.submit({
    ...submission,
    fields: { title: submission.fields.title }
  }), { ok: false, code: 'storage' })
})

test('attachment replay confirms an uncertain upload and only retries a definitive failure', async (t) => {
  const records = new Map()
  const fileId = 'fce60f0d-47be-4fbf-9256-f6d47f5f51f7'
  const retryId = 'ddc164ae-7aba-42a0-9941-4f44a09c4a57'
  const file = {
    submissionId: submission.submissionId,
    attachmentId: fileId,
    name: 'test.txt',
    contentType: 'text/plain',
    base64: 'aGVsbG8='
  }
  const uploadedId = '1012345678000000002'
  const actualUploads = []
  let listVisible = false
  let isRateLimited = true
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    assert.equal(url.origin, 'https://api.tapd.cn')
    if (url.pathname === '/workspaces/user_participant_projects') {
      return projects(project)
    }
    const scope = { workspace_id: project.id, type: 'story', entry_id: id }
    if (url.pathname === '/files/upload_attachment') {
      assert.equal(options.method, 'POST')
      for (const [key, value] of Object.entries(scope)) {
        assert.equal(options.body.get(key), value)
      }
      const file = options.body.get('file')
      assert.equal(await file.text(), 'hello')
      actualUploads.push(file.name)
      if (file.name.includes(retryId) && isRateLimited) {
        return new Response(null, { status: 429 })
      }
      // A successful native TAPD upload may acknowledge without an attachment ID.
      return tapd({})
    }
    if (url.pathname === '/attachments') {
      assert.equal(options.method, 'GET')
      for (const [key, value] of Object.entries(scope)) {
        assert.equal(url.searchParams.get(key), value)
      }
      const filename = url.searchParams.get('filename')
      const entry = { ...scope, id: uploadedId, filename }
      return tapd(listVisible ? [
        { Attachment: { ...entry, entry_id: '1012345678000000003' } },
        { Attachment: entry }
      ] : [])
    }
    assert.equal(url.pathname, '/stories')
    const Story = { id, workspace_id: project.id, name: 'Example story', owner: '' }
    return tapd(options.method === 'POST' ? { Story } : [{ Story }])
  })

  const worker = bridge(records)
  assert.deepEqual(await worker.upload(file), { ok: false, code: 'not-found' })
  assert.equal((await worker.submit({
    ...submission, kind: 'story', fields: { title: 'Example story' }
  })).value.status, 'created')
  assert.equal((await worker.upload(file)).value.status, 'pending')
  assert.deepEqual(actualUploads, [`test-${fileId}.txt`])
  listVisible = true
  const restarted = bridge(records)
  assert.equal((await restarted.upload(file)).value.id, uploadedId)
  assert.equal((await restarted.upload(file)).value.status, 'uploaded')
  assert.deepEqual(await restarted.upload({ ...file, base64: 'Z29vZGJ5ZQ==' }), {
    ok: false, code: 'conflict'
  })
  const second = { ...file, attachmentId: retryId }
  assert.equal((await restarted.upload(second)).value.status, 'retryable')
  isRateLimited = false
  assert.equal((await restarted.upload(second)).value.status, 'uploaded')
  assert.deepEqual(actualUploads, [`test-${fileId}.txt`, `test-${retryId}.txt`, `test-${retryId}.txt`])
})
