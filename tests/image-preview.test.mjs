import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import activate from '../worker.mjs'

const projectId = '12345678'
const imagePath = '/tfl/captures/example.png'
const signedUrl = 'https://file.tapd.cn/attachments/tmp_download/example'

function imageRequests() {
  const handlers = new Map()
  activate({
    panels: { handle: (name, handler) => handlers.set(name, handler) },
    secrets: {
      get: async () => JSON.stringify({ id: '19', author: 'test', token: 'fixture-token' })
    }
  })
  return async (name, data) => {
    const result = z.json().parse(await handlers.get(name)(data))
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024)
    return result
  }
}

test('TAPD images reach the panel in bounded chunks without forwarding the token', async (t) => {
  const png = Buffer.alloc(1_200_000)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
  const fetch = t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    if (url.host === 'api.tapd.cn') {
      assert.equal(url.pathname, '/files/get_image')
      assert.equal(url.searchParams.get('workspace_id'), projectId)
      assert.equal(url.searchParams.get('image_path'), imagePath)
      assert.equal(options.headers.Authorization, 'Bearer fixture-token')
      return Response.json({
        status: 1,
        data: { Attachment: { workspace_id: Number(projectId), download_url: signedUrl } }
      })
    }
    assert.equal(url.href, signedUrl)
    assert.equal(options.headers, undefined)
    assert.equal(options.redirect, 'error')
    return new Response(png)
  })
  const call = imageRequests()
  let response = await call('image-preview', { projectId, imagePath })
  const parts = []
  for (;;) {
    assert.equal(response.ok, true)
    assert.equal(response.value.mime, 'image/png')
    parts.push(response.value.base64)
    if (!response.value.next) break
    response = await call('image-preview-chunk', response.value.next)
  }
  assert.ok(parts.length > 1)
  assert.deepEqual(Buffer.from(parts.join(''), 'base64'), png)
  assert.equal(fetch.mock.callCount(), 2)
})

test('external hosts and non-image downloads cannot supply previews', async (t) => {
  let downloadUrl = 'https://example.com/remote'
  const fetch = t.mock.method(globalThis, 'fetch', async (input) => {
    if (new URL(input).host === 'api.tapd.cn') {
      return Response.json({
        status: 1,
        data: { Attachment: { workspace_id: projectId, download_url: downloadUrl } }
      })
    }
    return new Response('<!doctype html>sign in', { headers: { 'content-type': 'image/png' } })
  })
  const call = imageRequests()
  const invalid = { ok: false, code: 'invalid' }
  assert.deepEqual(await call('image-preview', {
    projectId,
    imagePath: 'https://example.com/tfl/captures/example.png'
  }), invalid)
  assert.equal(fetch.mock.callCount(), 0)
  assert.deepEqual(await call('image-preview', { projectId, imagePath }), invalid)
  assert.equal(fetch.mock.callCount(), 1)
  downloadUrl = signedUrl
  assert.deepEqual(await call('image-preview', { projectId, imagePath }), invalid)
  assert.equal(fetch.mock.callCount(), 3)
})
