import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { z } from 'zod'
import activate from '../worker.mjs'

test('TAPD todo pages preserve project, category and board item identity across the panel bridge', async (t) => {
  const projectId = '12345678'
  const otherProjectId = '87654321'
  const id = '1010000000000000001'
  const boardId = '1010000000000000002'
  const categoryId = '1010000000000000003'
  const secondCardId = '1010000000000000004'
  const boardCard = {
    id, workspace_id: projectId, name: 'Board card', owner: 'another;test;',
    b_board_id: boardId, status: 'open', description: 'Example description',
    modified: '2026-06-15T10:30:00+08:00'
  }
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    assert.equal(url.origin, 'https://api.tapd.cn')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    const query = url.searchParams
    if (url.pathname !== '/workspaces/user_participant_projects') {
      assert.equal(query.get('workspace_id'), projectId)
    }
    let data
    switch (url.pathname) {
      case '/workspaces/user_participant_projects':
        data = [{ Workspace: { id: projectId, name: 'Test project' } }]
        break
      case '/user_oauth/get_user_todo_story':
        data = [{ Story: {
          id, workspace_id: projectId, name: 'Functional requirement', workitem_type_id: categoryId,
          status: 'planning', due: '2026-12-01 00:00:00', priority: '4',
          modified: '2026-01-01 00:00:00'
        } }, ...Array.from({ length: 28 }, (_, offset) => ({
          Story: {
            id: String(1010000000000000100n + BigInt(offset)), workspace_id: projectId,
            name: `Requirement ${String(offset).padStart(2, '0')}`,
            status: 'planning', v_status: '规划中', priority_label: 'High',
            modified: ['2025-12-31 23:59:59', '2027-01-01', '2026-12-31 23:59:59'][offset]
          }
        }))]
        break
      case '/stories':
        assert.equal(query.get('with_v_status'), '1')
        data = [{ Story: { id, status: 'planning', v_status: '规划中', priority_label: 'Urgent' } }]
        break
      case '/workitem_types':
        assert.equal(query.get('id'), categoryId)
        data = [{ WorkitemType: { id: categoryId, english_name: 'FUNC' } }]
        break
      case '/user_oauth/get_user_todo_bug':
        assert.equal(query.get('page'), '1')
        data = [
          { Bug: { id, project_id: projectId, title: 'Bug', deadline: '2026-12-02' } },
          { Bug: { id: secondCardId, project_id: otherProjectId, title: 'Outside requested project' } }
        ]
        break
      case '/bugs':
        data = [{ Bug: { id, v_status: '待验证' } }]
        break
      case '/user_oauth/get_user_todo_task':
        data = []
        break
      case '/board_cards':
        if (query.get('id')) {
          assert.equal(query.get('id'), id)
          data = [{ BoardCard: boardCard }]
        } else {
          assert.equal(query.get('owner'), 'USER_OR<test>')
          assert.equal(query.get('status'), 'open')
          data = [
            { BoardCard: boardCard },
            { BoardCard: { ...boardCard, id: secondCardId, owner: 'testing;' } }
          ]
        }
        break
      default:
        assert.fail(`Unexpected route ${url.pathname}`)
    }
    return Response.json({ status: 1, data })
  })

  const handlers = new Map()
  activate({
    panels: { handle: (name, handler) => handlers.set(name, handler) },
    secrets: { get: async () => JSON.stringify({ id: '19', author: 'test', token: 'fixture-token' }) },
    storage: { get: async (key) => {
      assert.equal(key, `workspaces:19:${projectId}:board:${id}`)
      return []
    } }
  })
  const call = async (name, payload) => z.json().parse(await handlers.get(name)(payload))
  const pending = await call('todo-list', {})
  assert.equal(pending.value.progress.loading, true)
  let snapshot = pending.value
  for (let attempt = 0; snapshot.progress.loading && attempt < 20; attempt++) {
    await setImmediate()
    snapshot = (await call('todo-list', {})).value
  }
  assert.deepEqual(snapshot.progress, { loading: false, finished: 1, total: 1 })
  assert.equal(snapshot.failures, 1)
  assert.equal(snapshot.count, 31)
  assert.equal(snapshot.items.length, 30)
  assert.equal(snapshot.hasMore, true)
  const lastPage = await call('todo-list', { page: 2 })
  assert.equal(lastPage.value.items.length, 1)
  assert.equal(lastPage.value.hasMore, false)
  assert.deepEqual(snapshot.items[0], {
    id, title: 'Functional requirement', status: 'planning', statusLabel: '规划中',
    priority: 'Urgent', modified: '2026-01-01 00:00:00', due: '2026-12-01', typeLabel: 'FUNC',
    kind: 'story', project: { id: projectId, name: 'Test project' }
  })

  const updatedThisYear = await call('todo-list', { updatedYear: 2026, order: 'updated' })
  assert.equal(updatedThisYear.value.count, 3)
  assert.deepEqual(updatedThisYear.value.items.map(({ title }) => title), [
    'Requirement 02', 'Board card', 'Functional requirement'
  ])
  assert.equal(updatedThisYear.value.hasMore, false)
  const earlierYear = await call('todo-list', { updatedYear: 2025, type: 'STORY', projectId })
  assert.deepEqual(earlierYear.value.items.map(({ title }) => title), ['Requirement 00'])
  const unsupportedYear = await call('todo-list', { updatedYear: '2026' })
  assert.deepEqual(unsupportedYear, { ok: false, code: 'invalid' })

  const bug = await call('todo-list', { type: 'BUG' })
  assert.equal(bug.value.items.length, 1)
  assert.equal(bug.value.items[0].due, '2026-12-02')

  const board = await call('todo-list', { type: 'ITEM', projectId })
  assert.deepEqual(board.value.items.map(({ id, typeLabel }) => ({ id, typeLabel })), [{ id, typeLabel: 'ITEM' }])
  const detail = await call('todo-board-item', { projectId, id })
  assert.equal(detail.value.description, 'Example description')
  assert.equal(detail.value.url, `https://www.tapd.cn/${projectId}/board/card_detail_preview/${boardId}/${id}`)
  assert.deepEqual(await call('workspaces', { projectId, kind: 'board', id }), [])
})
