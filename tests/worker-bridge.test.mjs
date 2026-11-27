import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import activate from '../worker.mjs'

test('sparse TAPD responses cross the Orca panel bridge', async (t) => {
  const projectId = '12345678'
  const id = '1010000000000000001'
  const story = { id, workspace_id: projectId, name: 'Example story' }
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    assert.equal(url.origin + url.pathname, 'https://api.tapd.cn/stories')
    const data = options.method === 'POST' ? { Story: story } : [{ Story: story }]
    return Response.json({ status: 1, data })
  })
  const handlers = new Map()
  activate({
    panels: { handle: (name, handler) => handlers.set(name, handler) },
    secrets: {
      get: async () => JSON.stringify({ id: '19', author: 'test', token: 'fixture-token' })
    }
  })
  const scope = { projectId, kind: 'story' }
  // Orca validates structured-cloned responses with z.json() before delivery.
  const call = async (name, payload) => {
    const bridge = z.json().safeParse(await handlers.get(name)(payload))
    assert.ok(bridge.success, `Orca rejected the ${name} response as non-JSON`)
    return bridge.data
  }
  const list = await call('items', { ...scope, page: 1 })
  const detail = await call('item', { ...scope, id })
  const created = await call('create', { ...scope, fields: { title: story.name } })

  for (const result of [list, detail, created]) {
    assert.equal(result.ok, true)
  }
  for (const item of [list.value.items[0], detail.value, created.value]) {
    assert.equal(item.id, id)
    assert.equal(item.title, story.name)
    assert.equal(Object.hasOwn(item, 'details'), false)
    assert.equal(Object.hasOwn(item, 'description'), false)
  }
})

test('the sidebar can page through tasks linked to a TAPD requirement', async (t) => {
  const projectId = '12345678'
  const storyId = '1010000000000000001'
  const taskId = '1010000000000000042'
  const calls = []
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input)
    calls.push(url)
    const related = (id, name) => ({ Task: { id, workspace_id: projectId, story_id: storyId, name } })
    const data = url.searchParams.get('page') === '1'
      ? Array.from({ length: 30 }, (_, index) => related(String(101 + index), `Task ${index + 1}`))
      : [related(taskId, 'Verify the completed workflow')]
    return Response.json({ status: 1, data })
  })
  const handlers = new Map()
  activate({
    panels: { handle: (name, handler) => handlers.set(name, handler) },
    secrets: {
      get: async () => JSON.stringify({ id: '19', author: 'test', token: 'fixture-token' })
    }
  })

  const list = handlers.get('story-tasks')
  assert.ok(list, 'the panel can request tasks for a requirement')
  const first = z.json().parse(await list({ projectId, storyId, page: 1 }))
  const second = z.json().parse(await list({ projectId, storyId, page: 2 }))

  assert.equal(first.ok, true)
  assert.equal(first.value.items.length, 30)
  assert.equal(first.value.hasMore, true)
  assert.equal(second.ok, true)
  assert.equal(second.value.hasMore, false)
  assert.deepEqual(second.value.items.map(({ id, title }) => [id, title]), [
    [taskId, 'Verify the completed workflow']
  ])
  assert.deepEqual(calls.map(({ pathname, searchParams }) => [
    pathname, searchParams.get('workspace_id'), searchParams.get('story_id'), searchParams.get('page')
  ]), [
    ['/tasks', projectId, storyId, '1'],
    ['/tasks', projectId, storyId, '2']
  ])
})

test('a new task is created under the requirement selected in the sidebar', async (t) => {
  const projectId = '12345678'
  const storyId = '1010000000000000001'
  const taskId = '1010000000000000042'
  const title = 'Verify the completed workflow'
  const writes = []
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    if (options.method === 'POST') {
      writes.push([url.pathname, Object.fromEntries(options.body)])
      return Response.json({ status: 1, data: { Task: { id: taskId, workspace_id: projectId, name: title } } })
    }
    return Response.json({ status: 1, data: url.searchParams.get('id') === storyId
      ? [{ Story: { id: storyId, workspace_id: projectId, name: 'Example story' } }]
      : [] })
  })
  const handlers = new Map()
  activate({
    panels: { handle: (name, handler) => handlers.set(name, handler) },
    secrets: {
      get: async () => JSON.stringify({ id: '19', author: 'test', token: 'fixture-token' })
    }
  })

  const create = handlers.get('create-story-task')
  assert.ok(create, 'the panel can create a task from a requirement')
  const fields = { title, description: 'Acceptance criteria' }
  assert.deepEqual(await create({ projectId, storyId: '123', fields }), { ok: false, code: 'not-found' })
  const saved = z.json().parse(await create({ projectId, storyId, fields }))

  assert.equal(saved.ok, true)
  assert.equal(saved.value.id, taskId)
  assert.equal(saved.value.details.relatedStoryId, storyId)
  assert.deepEqual(writes, [['/tasks', {
    workspace_id: projectId, story_id: storyId, creator: 'test', name: title,
    description: '<p>Acceptance criteria</p>'
  }]])
})
