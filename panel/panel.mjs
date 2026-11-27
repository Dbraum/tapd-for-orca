/* global orca */

import {
  announce,
  button,
  byId,
  externalLink,
  field,
  kinds,
  node,
  on,
  openExternal,
  plainText,
  request,
  richText,
  row,
  run,
  statusText,
  submit,
  tapd,
  view
} from './view.mjs'
import { createTodoView } from './todos.mjs'

let account = null
let projects = []
let project = null
let kind = 'story'
let items = []
let itemPage = 0
let task = null
let detailContext = null
let relatedTasks = null
let todosDirty = false
let commentPage = 0
let statusMenu = null
let initialFields = null
let editorStory = null
let destinations = []

const selectionKey = () => `selected-project:${account.id}`
const ref = () => ({ projectId: detailContext.project.id, kind: detailContext.kind, id: task.id })
const todoView = createTodoView((item) => void run(() => openDetail(item.id, {
  project: item.project, kind: item.kind, typeLabel: item.typeLabel, source: 'todos'
})))

function showTodos() {
  todoView.show(projects, project?.id, todosDirty)
  todosDirty = false
}

function connectionView() {
  const connected = Boolean(account)
  const status = byId('connection-status')
  status.textContent = connected ? '已连接' : '未连接'
  status.dataset.connected = String(connected)
  const accountLabel = byId('account')
  accountLabel.textContent = account ? `当前账号 ${account.name}` : ''
  accountLabel.hidden = !connected
  byId('connection-token').placeholder = connected ? '粘贴新的个人访问令牌' : '粘贴个人访问令牌'
  byId('disconnect').hidden = !connected
  byId('connection-back').hidden = !connected
  view('connection')
}

function renderProjects() {
  const search = byId('project-search').value.trim().toLocaleLowerCase()
  const matches = projects.filter(
    ({ name, id }) => name.toLocaleLowerCase().includes(search) || id.includes(search)
  )
  byId('project-results').replaceChildren(
    ...matches.map(({ id, name }) =>
      row(
        name,
        node('small', id),
        () =>
          void run(async () => {
            await selectProject(id)
          })
      )
    )
  )
  if (!matches.length) {
    byId('project-results').append(node('p', '没有匹配的 TAPD 项目。', 'muted'))
  }
}

function showProjectPicker(show) {
  byId('project-picker').hidden = !show
  if (show) {
    byId('project-search').value = ''
    renderProjects()
    if (byId('panel').inert) {
      byId('project-search').dataset.focusNext = ''
    } else {
      byId('project-search').focus()
    }
  }
}

async function selectProject(id) {
  const selected = projects.find((candidate) => candidate.id === id)
  if (selected?.id !== project?.id) {
    byId('filters').reset()
    byId('item-results').replaceChildren()
    byId('item-empty').hidden = true
    byId('more-items').hidden = true
    items = []
    itemPage = 0
  }
  project = selected ?? null
  byId('project-name').textContent = project?.name ?? '选择 TAPD 项目'
  byId('project-name').title = project?.name ?? ''
  byId('issue-list').hidden = !project
  view('list')
  showProjectPicker(!project)
  if (project) {
    await orca.storage.set(selectionKey(), project.id)
    await loadItems(true)
  }
}

async function loadProjects() {
  projects = await tapd('projects')
  const previous = await orca.storage.get(selectionKey())
  await selectProject(previous ?? (projects.length === 1 ? projects[0].id : null))
}

function taskMetadata(item, itemKind) {
  const values = [
    statusText(itemKind, item),
    item.assignee || '未分配',
    item.priority,
    item.modified
  ].filter(Boolean)
  const element = node('div', '', 'bar muted')
  element.append(
    ...values.map((value, index) => node('span', value, index === 0 && item.status ? 'pill' : ''))
  )
  return element
}

async function loadItems(reset) {
  if (!project) {
    return
  }
  const form = byId('filters')
  const filters = Object.fromEntries(
    ['search', 'status', 'assignee', 'priority', 'label', 'sort'].flatMap((name) => {
      const value = field(form, name).value.trim()
      return value ? [[name, value]] : []
    })
  )
  const page = reset ? 1 : itemPage + 1
  const result = await tapd('items', {
    projectId: project.id,
    kind,
    page,
    ...filters,
    assignedToMe: field(form, 'assignedToMe').checked
  })
  items = reset
    ? result.items
    : [...new Map([...items, ...result.items].map((item) => [item.id, item])).values()]
  itemPage = page
  byId('item-results').replaceChildren(
    ...items.map((item) =>
      row(item.title, taskMetadata(item), () => void run(() => openDetail(item.id)))
    )
  )
  byId('item-empty').hidden = items.length > 0
  byId('more-items').hidden = !result.hasMore
}

async function loadWorkspaces() {
  const links = await request('workspaces', ref())
  byId('start').textContent = links.length ? '再建工作区' : '开始'
  byId('linked-workspaces').replaceChildren(
    ...links.map(({ id, name }) =>
      button(
        `打开工作区 · ${name}`,
        () => void run(() => tapd('open-workspace', { ...ref(), workspaceId: id })),
        'ellipsis'
      )
    )
  )
}

function renderTask() {
  const details = task.details ?? {}
  const { project: itemProject, kind: itemKind, typeLabel } = detailContext
  const label = typeLabel && !['STORY', 'BUG', 'TASK', 'ITEM'].includes(typeLabel)
    ? typeLabel
    : kinds[typeLabel === 'TASK' ? 'task' : itemKind]
  byId('item-reference').textContent = `${itemProject.name} · ${label} #${task.id}`
  byId('item-title').textContent = task.title
  byId('item-badges').replaceChildren(
    ...[statusText(itemKind, task), task.priority].filter(Boolean).map((value) => node('span', value, 'pill'))
  )
  byId('item-description').replaceChildren(richText(task.description, task.url, itemProject.id))
  const relatedStory = details.relatedStoryId
    ? externalLink(`/tapd_fe/${itemProject.id}/story/detail/${details.relatedStoryId}`, task.url)
    : null
  if (relatedStory) {
    relatedStory.textContent = `#${details.relatedStoryId}`
  }
  const properties = [
    ['负责人', task.assignee || '未分配'],
    ['创建人', task.creator],
    ['开发人员', details.developer],
    ['所属模块', details.module],
    [itemKind === 'story' ? '父需求' : '关联需求', relatedStory],
    ['迭代 ID', details.iterationId],
    ['进度', details.progress == null ? null : `${details.progress}%`],
    ['预计开始', details.begin],
    ['预计结束', details.due],
    ['完成时间', details.completed],
    ['创建时间', details.created],
    ['最近更新', task.modified],
    ['预估工时', details.effort],
    ['完成工时', details.completedEffort],
    ['剩余工时', details.remainingEffort]
  ]
  byId('item-metadata').replaceChildren(
    ...properties
      .filter(([, value]) => value != null && value !== '')
      .map(([label, value]) => {
        const group = node('div')
        const valueNode = node('dd')
        valueNode.append(value instanceof HTMLElement ? value : String(value))
        group.append(node('dt', label), valueNode)
        return group
      })
  )
  const labels = byId('item-labels')
  labels.hidden = !task.labels?.length
  labels.replaceChildren(
    node('span', '标签', 'muted'),
    ...(task.labels ?? []).map((label) => node('span', label, 'pill'))
  )
  byId('status-form').hidden = true
}

function relatedTaskStatus(message) {
  const status = byId('related-task-status')
  status.textContent = message
  status.hidden = !message
}

function showRelatedTasks() {
  const isStory = detailContext.kind === 'story' && detailContext.typeLabel !== 'TASK'
  relatedTasks = isStory ? { context: detailContext, storyId: task.id, page: 0, ids: new Set() } : null
  byId('related-tasks').hidden = !isStory
  byId('related-task-results').replaceChildren()
  byId('more-related-tasks').hidden = true
  if (isStory) void loadRelatedTasks()
}

function addRelatedTask(list, item, newest = false) {
  if (list.ids.has(item.id)) return
  const { context, storyId } = list
  const taskContext = {
    project: context.project,
    kind: 'task',
    source: context.source,
    parentStory: { id: storyId, context }
  }
  const taskRow = row(item.title, taskMetadata(item, 'task'), () =>
    void run(() => openDetail(item.id, taskContext))
  )
  const results = byId('related-task-results')
  list.ids.add(item.id)
  if (newest) results.prepend(taskRow)
  else results.append(taskRow)
  return taskRow
}

async function loadRelatedTasks() {
  const list = relatedTasks
  if (!list) return

  const { context, storyId } = list
  const page = list.page + 1
  const more = byId('more-related-tasks')
  more.disabled = true
  relatedTaskStatus('正在加载关联任务…')
  try {
    const result = await tapd('story-tasks', { projectId: context.project.id, storyId, page })
    if (list !== relatedTasks) return

    for (const item of result.items) {
      addRelatedTask(list, item)
    }
    list.page = page
    relatedTaskStatus(list.ids.size ? '' : '暂无关联任务。')
    more.textContent = '加载更多任务'
    more.hidden = !result.hasMore
  } catch {
    if (list !== relatedTasks) return

    relatedTaskStatus('无法加载关联任务。')
    more.textContent = '重试'
    more.hidden = false
  } finally {
    if (list === relatedTasks) more.disabled = false
  }
}

async function loadComments(reset) {
  const page = reset ? 1 : commentPage + 1
  const result = await tapd('comments', { ...ref(), page })
  const comments = result.items.map(({ author, created, body }) => {
    const article = node('article', '', 'comment stack compact')
    const content = node('div', '', 'detail-content')
    content.append(richText(body, task.url, detailContext.project.id, '暂无评论内容。'))
    article.append(node('small', `${author} · ${created}`), content)
    return article
  })
  if (reset) {
    byId('comments').replaceChildren(...comments)
    if (!comments.length) {
      byId('comments').append(node('p', '暂无评论', 'muted'))
    }
  } else {
    byId('comments').append(...comments)
  }
  commentPage = page
  byId('more-comments').hidden = !result.hasMore
}

async function openDetail(id, context = { project, kind, source: 'list' }) {
  const payload = { projectId: context.project.id, id }
  const board = context.kind === 'board'
  const loaded = board
    ? await tapd('todo-board-item', payload)
    : await tapd('item', { ...payload, kind: context.kind })
  if (!loaded) {
    announce('工单不存在或已被移动。', 'error')
    return
  }
  detailContext = context
  task = loaded
  renderTask()
  byId('comment-form').reset()
  byId('comments').replaceChildren()
  byId('linked-workspaces').replaceChildren()
  byId('more-comments').hidden = true
  byId('comments-section').hidden = board
  byId('edit').hidden = board
  byId('load-status').hidden = board
  byId('detail-back').textContent = context.parentStory
    ? '← 需求详情'
    : context.source === 'todos' ? '← 我的待办' : '← 工单列表'
  if (context.source === 'todos') todoView.pause()
  byId('start').textContent = '开始'
  view('detail')
  showRelatedTasks()
  const results = await Promise.allSettled([board ? Promise.resolve() : loadComments(true), loadWorkspaces()])
  if (results[0].status === 'rejected') {
    byId('comments').append(node('p', '无法加载评论，可返回列表后重试。', 'muted'))
  }
  if (results[1].status === 'rejected') {
    announce('暂时无法查询关联工作区。', 'error')
  }
}

async function openEditor(editing, story = null) {
  const form = byId('edit-form')
  form.reset()
  editorStory = story
  initialFields = editing
    ? {
        title: task.title,
        description: plainText(task.description),
        assignee: task.assignee,
        priority: task.priority ?? '',
        labels: (task.labels ?? []).join('|')
      }
    : null
  for (const [name, value] of Object.entries(initialFields ?? {})) {
    field(form, name).value = value
  }
  const scope = editing ? detailContext : { project: story?.context.project ?? project, kind }
  byId('editor-title').textContent = story ? '新建关联任务' : `${editing ? '编辑' : '新建'}${kinds[scope.kind]}`
  const storyLabel = byId('editor-story')
  storyLabel.textContent = story ? `所属需求 · ${task.title} #${story.storyId}` : ''
  storyLabel.hidden = !story
  field(form, 'description').placeholder = story ? '交付行为\n验收标准\n阻塞于（没有则填「无」）' : ''
  byId('members').replaceChildren()
  view('editor')
  try {
    const members = await tapd('members', { projectId: scope.project.id })
    byId('members').replaceChildren(
      ...members.map(({ nick, name }) => new Option(name || nick, nick))
    )
  } catch {
    announce('无法加载成员，可填写 TAPD 账号名。', 'error')
  }
}

async function saveRelatedTask(list, fields) {
  const { context, storyId } = list
  const saved = await tapd('create-story-task', { projectId: context.project.id, storyId, fields })
  todosDirty = true
  view('detail')
  if (saved.details?.relatedStoryId !== storyId) {
    announce(`任务 #${saved.id} 已创建，TAPD 尚未确认所属需求。请在 TAPD 核对关联。`, 'error')
    return
  }
  const taskRow = addRelatedTask(list, saved, true)
  if (taskRow) taskRow.dataset.focusNext = ''
  if (list.page && byId('more-related-tasks').hidden) relatedTaskStatus('')
  announce('关联任务已创建。')
}

function linkedTaskPrompt(item, projectId, storyId, story, limit) {
  const storyUrl = story?.url ?? new URL(`/tapd_fe/${projectId}/story/detail/${storyId}`, item.url).href
  const taskHeading = [`TAPD 任务 #${item.id}`, item.title.slice(0, 200), item.url, '', '任务描述与验收标准'].join('\n')
  const storyHeading = [`所属需求 #${storyId}`, story?.title.slice(0, 200), storyUrl, '', '需求目标与范围']
    .filter((line) => line !== undefined).join('\n')
  const handoff = '若需求变更影响任务验收，请先由负责人确认并更新任务。请在 Git PR 中回链任务，并将验证结果记录到 TAPD 任务。'
  const taskBody = plainText(item.description) || '请打开任务核对交付行为和验收标准。'
  const storyBody = plainText(story?.description) || '请打开需求核对目标和范围。'
  const budget = limit - taskHeading.length - storyHeading.length - handoff.length - 6
  const taskLimit = Math.min(taskBody.length, Math.max(Math.floor(budget * 2 / 3), budget - storyBody.length))
  const shorten = (body, size) => body.length > size ? `${body.slice(0, size - 1)}…` : body
  return [taskHeading, shorten(taskBody, taskLimit), '', storyHeading,
    shorten(storyBody, budget - taskLimit), '', handoff].join('\n')
}

async function openStart() {
  const { project: itemProject, kind: itemKind } = detailContext
  const form = byId('start-form')
  form.reset()
  const storyId = itemKind === 'task' ? task.details?.relatedStoryId : undefined
  const [optionsForStart, saved, story] = await Promise.all([
    request('orca-projects'),
    orca.storage.get(`destination:${account.id}:${itemProject.id}`),
    storyId
      ? tapd('item', { projectId: itemProject.id, kind: 'story', id: storyId }).catch(() => null)
      : null
  ])
  destinations = optionsForStart.destinations
  const options = destinations.map(
    ({ name, hostId }, index) =>
      new Option(hostId === 'local' ? name : `${name} · ${hostId}`, String(index))
  )
  field(form, 'destination').replaceChildren(...options)
  const preferred = optionsForStart.current ?? saved
  const index = destinations.findIndex(
    ({ id, hostId }) => preferred?.id === id && preferred?.hostId === hostId
  )
  field(form, 'destination').selectedIndex = index === -1 ? 0 : index
  const agent = field(form, 'agent')
  agent.querySelector('option[value="default"]')?.remove()
  if (optionsForStart.defaultAgentSupported) {
    agent.prepend(new Option('使用 Orca 默认 Agent', 'default'))
    agent.value = 'default'
  }
  field(form, 'name').value = `tapd-${itemKind}-${task.id}`
  const prompt = field(form, 'prompt')
  if (storyId) {
    prompt.value = linkedTaskPrompt(task, itemProject.id, storyId, story, prompt.maxLength)
  } else {
    prompt.value = [
      `TAPD ${kinds[itemKind]} #${task.id}`,
      task.title,
      task.url,
      '',
      '工单描述（来自 TAPD）',
      plainText(task.description)
    ].join('\n').slice(0, prompt.maxLength)
  }
  field(form, 'sendPrompt').disabled = !agent.value
  byId('confirm-start').disabled = !destinations.length
  view('workspace')
  if (!destinations.length) {
    announce('请先在 Orca 添加一个 Git 项目。', 'error')
  } else if (storyId && !story) {
    announce('暂时无法读取所属需求。工单上下文已保留需求链接。', 'error')
  }
}

on('settings-button', () => {
  announce('')
  todoView.pause()
  connectionView()
})
on('get-token', async (event) => {
  event.preventDefault()
  await openExternal(
    event.currentTarget.href,
    '无法打开 TAPD。请在浏览器进入「我的设置 → 个人访问令牌」。'
  )
})
on('connection-back', () => void run(loadProjects))
on(
  'disconnect',
  () =>
    void run(async () => {
      await request('disconnect')
      todoView.reset()
      todosDirty = false
      account = null
      projects = []
      project = null
      task = null
      detailContext = null
      relatedTasks = null
      byId('settings-button').hidden = true
      connectionView()
      announce('已断开 TAPD 连接。')
    })
)
submit(
  'connect-form',
  async (form) => {
    const token = field(form, 'token').value
    field(form, 'token').value = ''
    account = await tapd('connect', { token })
    todoView.reset()
    todosDirty = false
    byId('settings-button').hidden = false
    try {
      await loadProjects()
    } catch {
      connectionView()
      announce('令牌已保存，目前无法获取项目。', 'error')
    }
  },
  '正在验证 TAPD 连接…'
)
on('show-project-items', () => {
  if (byId('list').hidden) {
    announce('')
    todoView.pause()
    view('list')
  }
})
on('show-todos', () => {
  if (byId('todos').hidden) {
    announce('')
    showTodos()
  }
})
on('refresh-todos', () => void run(async () => {
  projects = await tapd('projects')
  if (!byId('project-picker').hidden) renderProjects()
  todoView.refresh(projects, project?.id)
  todosDirty = false
}))
on('choose-project', () => showProjectPicker(byId('project-picker').hidden))
on('project-search', renderProjects, 'input')
on('refresh', () => void run(() => (project ? loadItems(true) : loadProjects())))
on('kinds', (event) => {
  const next = event.target.closest('button[data-kind]')?.dataset.kind
  if (!next || next === kind) {
    return
  }
  void run(async () => {
    const previous = kind
    kind = next
    try {
      await loadItems(true)
    } catch (error) {
      kind = previous
      throw error
    }
    for (const control of byId('kinds').querySelectorAll('button[data-kind]')) {
      control.setAttribute('aria-pressed', String(control.dataset.kind === kind))
    }
  })
})
submit('filters', () => loadItems(true))
on('more-items', () => void run(() => loadItems(false)))
on('more-related-tasks', () => void loadRelatedTasks())
on(
  'detail-back',
  () =>
    void run(async () => {
      const { parentStory } = detailContext
      if (parentStory) {
        await openDetail(parentStory.id, parentStory.context)
        return
      }
      if (detailContext.source === 'todos') {
        showTodos()
        return
      }
      view('list')
      await loadItems(true)
    })
)
on('external', () => void openExternal(task.url, '无法打开 TAPD 链接。'))
on(
  'load-status',
  () =>
    void run(async () => {
      statusMenu = await tapd('status-options', ref())
      if (!statusMenu.options.length) {
        announce('当前工单没有可用的状态流转。')
        return
      }
      const select = byId('status-options')
      select.replaceChildren(new Option('选择目标状态', ''))
      for (const { id, label, requiresFields } of statusMenu.options) {
        const option = new Option(requiresFields ? `${label}（需要额外字段）` : label, id)
        option.disabled = requiresFields
        select.append(option)
      }
      byId('status-hint').hidden = !statusMenu.options.some(({ requiresFields }) => requiresFields)
      byId('status-form').hidden = false
    })
)
on('status-cancel', () => {
  byId('status-form').hidden = true
})
submit('status-form', async () => {
  const status = byId('status-options').value
  task = await tapd('status-change', { ...ref(), expectedStatus: statusMenu.current, status })
  todosDirty = true
  renderTask()
  announce('状态已更新。')
})
on('more-comments', () => void run(() => loadComments(false)))
submit(
  'comment-form',
  async (form) => {
    await tapd('comment', { ...ref(), body: field(form, 'body').value })
    form.reset()
    announce('评论已发布。')
    await loadComments(true).catch(() => announce('评论已发布，列表暂时无法刷新。', 'error'))
  },
  '正在发布评论…'
)
on('new-item', () => void run(() => openEditor(false)))
on('new-related-task', () => void run(() => openEditor(false, relatedTasks)))
on('edit', () => void run(() => openEditor(true)))
on('edit-cancel', () => {
  announce('')
  view(initialFields || editorStory ? 'detail' : 'list')
})
submit(
  'edit-form',
  async (form) => {
    const changed = Object.fromEntries(
      ['title', 'description', 'assignee', 'priority', 'labels'].flatMap((name) => {
        const value = field(form, name).value.trim()
        if (initialFields?.[name] === value || (!initialFields && !value)) {
          return []
        }
        return [
          [
            name,
            name === 'labels'
              ? value
                  .split('|')
                  .map((label) => label.trim())
                  .filter(Boolean)
              : value
          ]
        ]
      })
    )
    if (editorStory) {
      await saveRelatedTask(editorStory, changed)
      return
    }
    if (initialFields && !Object.keys(changed).length) {
      view('detail')
      return
    }
    const saved = initialFields
      ? await tapd('edit', { ...ref(), expectedModified: task.modified, fields: changed })
      : await tapd('create', { projectId: project.id, kind, fields: changed })
    todosDirty = true
    if (initialFields) {
      task = saved
      renderTask()
      view('detail')
    } else {
      try {
        await openDetail(saved.id)
      } catch {
        view('list')
        announce('工单已创建，详情暂时无法加载。', 'error')
        return
      }
    }
    announce('工单已保存。')
  },
  '正在保存工单…'
)
on('start', () => void run(openStart))
on('start-cancel', () => {
  announce('')
  view('detail')
})
on(
  'start-form',
  (event) => {
    if (event.target.name === 'agent') {
      const send = field(byId('start-form'), 'sendPrompt')
      send.disabled = !event.target.value
      if (send.disabled) {
        send.checked = false
      }
    }
  },
  'change'
)
submit(
  'start-form',
  async (form) => {
    const destination = destinations[field(form, 'destination').value]
    const agent = field(form, 'agent').value
    const baseBranch = field(form, 'baseBranch').value.trim()
    const sendPrompt = field(form, 'sendPrompt').checked
    if (!destination) {
      announce('请先选择 Orca Git 项目。', 'error')
      return
    }
    const result = await tapd('start-workspace', {
      ...ref(),
      destination: destination.id,
      hostId: destination.hostId,
      name: field(form, 'name').value,
      ...(baseBranch ? { baseBranch } : {}),
      ...(agent ? { agent } : {}),
      ...(agent && sendPrompt ? { prompt: field(form, 'prompt').value } : {}),
      ...(field(form, 'skipSetup').checked ? { skipSetup: true } : {})
    })
    view('detail')
    await orca.storage
      .set(`destination:${account.id}:${detailContext.project.id}`, {
        id: destination.id,
        hostId: destination.hostId
      })
      .catch(() => {})
    await loadWorkspaces().catch(() => {})
    const notes = []
    if (!result.linkSaved) {
      notes.push('工单关联暂时无法持久保存')
    }
    if (result.agentLaunchFailed) {
      notes.push('Agent 未能启动')
    }
    if (!result.opened) {
      notes.push('请从工作区列表打开')
    }
    announce(
      notes.length ? `工作区已创建。 ${notes.join('，')}。` : '工作区已创建。',
      notes.length ? 'error' : 'normal'
    )
  },
  '正在创建工作区…'
)

connectionView()
void run(async () => {
  account = (await request('connection')).account
  byId('settings-button').hidden = !account
  if (account) {
    connectionView()
    await loadProjects()
  }
})
