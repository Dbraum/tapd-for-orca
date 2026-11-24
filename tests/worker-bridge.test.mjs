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
