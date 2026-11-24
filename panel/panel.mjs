/* global orca */

import {
  announce,
  button,
  byId,
  field,
  kinds,
  node,
  on,
  plainText,
  request,
  row,
  run,
  submit,
  tapd,
  view
} from './view.mjs'

let account = null
let projects = []
let project = null
let kind = 'story'
let items = []
let itemPage = 0
let task = null
let commentPage = 0
let statusMenu = null
let initialFields = null
let destinations = []

const selectionKey = () => `selected-project:${account.id}`
const ref = () => ({ projectId: project.id, kind, id: task.id })

function connectionView() {
  byId('account').textContent = account
    ? `当前账号 ${account.name}`
    : '使用 TAPD 个人访问令牌连接账号。'
  byId('disconnect').hidden = !account
  byId('connection-back').hidden = !account
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

function taskMetadata(item) {
  const values = [
    item.statusLabel || item.status,
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
  byId('item-title').textContent = task.title
  const meta = taskMetadata(task)
  meta.append(
    node('span', `#${task.id}`),
    ...(task.labels ?? []).map((label) => node('span', label, 'pill'))
  )
  byId('item-metadata').replaceChildren(meta)
  byId('item-description').textContent = plainText(task.description)
  byId('status-form').hidden = true
}

async function loadComments(reset) {
  const page = reset ? 1 : commentPage + 1
  const result = await tapd('comments', { ...ref(), page })
  const comments = result.items.map(({ author, created, body }) => {
    const article = node('article', '', 'comment stack compact')
    article.append(
      node('small', `${author} · ${created}`),
      node('p', plainText(body), 'text-block')
    )
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

async function openDetail(id) {
  const loaded = await tapd('item', { projectId: project.id, kind, id })
  if (!loaded) {
    announce('工单不存在或已被移动。', 'error')
    return
  }
  task = loaded
  renderTask()
  byId('comment-form').reset()
  byId('comments').replaceChildren()
  byId('linked-workspaces').replaceChildren()
  byId('more-comments').hidden = true
  byId('start').textContent = '开始'
  view('detail')
  const results = await Promise.allSettled([loadComments(true), loadWorkspaces()])
  if (results[0].status === 'rejected') {
    byId('comments').append(node('p', '无法加载评论，可返回列表后重试。', 'muted'))
  }
  if (results[1].status === 'rejected') {
    announce('暂时无法查询关联工作区。', 'error')
  }
}

async function openEditor(editing) {
  const form = byId('edit-form')
  form.reset()
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
  byId('editor-title').textContent = `${editing ? '编辑' : '新建'}${kinds[kind]}`
  byId('members').replaceChildren()
  view('editor')
  try {
    const members = await tapd('members', { projectId: project.id })
    byId('members').replaceChildren(
      ...members.map(({ nick, name }) => new Option(name || nick, nick))
    )
  } catch {
    announce('无法加载成员，可填写 TAPD 账号名。', 'error')
  }
}

async function openStart() {
  const form = byId('start-form')
  form.reset()
  destinations = await request('orca-projects')
  const saved = await orca.storage.get(`destination:${account.id}:${project.id}`)
  const options = destinations.map(
    ({ name, hostId }, index) =>
      new Option(hostId === 'local' ? name : `${name} · ${hostId}`, String(index))
  )
  field(form, 'destination').replaceChildren(...options)
  const index = destinations.findIndex(
    ({ id, hostId }) => saved?.id === id && saved?.hostId === hostId
  )
  field(form, 'destination').selectedIndex = index === -1 ? 0 : index
  field(form, 'name').value = `tapd-${kind}-${task.id}`
  const context = [
    `TAPD ${kinds[kind]} #${task.id}`,
    task.title,
    task.url,
    '',
    '工单描述（来自 TAPD）',
    plainText(task.description)
  ]
  field(form, 'prompt').value = context.join('\n').slice(0, 12_000)
  field(form, 'sendPrompt').disabled = true
  byId('confirm-start').disabled = !destinations.length
  view('workspace')
  if (!destinations.length) {
    announce('请先在 Orca 添加一个 Git 项目。', 'error')
  }
}

on('settings-button', () => {
  announce('')
  connectionView()
})
on('connection-back', () => void run(loadProjects))
on(
  'disconnect',
  () =>
    void run(async () => {
      await request('disconnect')
      account = null
      projects = []
      project = null
      task = null
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
on(
  'detail-back',
  () =>
    void run(async () => {
      view('list')
      await loadItems(true)
    })
)
on('external', async () => {
  await orca.host
    .call('shell.openExternal', { url: task.url })
    .catch(() => announce('无法打开 TAPD 链接。', 'error'))
})
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
on('edit', () => void run(() => openEditor(true)))
on('edit-cancel', () => {
  announce('')
  view(initialFields ? 'detail' : 'list')
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
    if (initialFields && !Object.keys(changed).length) {
      view('detail')
      return
    }
    const saved = initialFields
      ? await tapd('edit', { ...ref(), expectedModified: task.modified, fields: changed })
      : await tapd('create', { projectId: project.id, kind, fields: changed })
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
      .set(`destination:${account.id}:${project.id}`, {
        id: destination.id,
        hostId: destination.hostId
      })
      .catch(() => {})
    await loadWorkspaces().catch(() => {})
    const notes = []
    if (!result.linkSaved) {
      notes.push('工单关联暂时无法持久保存')
    }
    if (agent && !result.agentStarted) {
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
