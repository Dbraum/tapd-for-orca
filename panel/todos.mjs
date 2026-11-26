import { byId, node, on, row, statusText, tapd, view } from './view.mjs'

const typeNames = new Map([
  ['STORY', '需求'],
  ['BUG', '缺陷'],
  ['TASK', '任务'],
  ['ITEM', '看板卡片']
])

export function createTodoView(openDetail) {
  const projectFilter = byId('todo-project')
  const typeFilter = byId('todo-type')
  const sort = byId('todo-sort')
  const summary = byId('todo-summary')
  const results = byId('todo-results')
  const more = byId('more-todos')
  const refreshButton = byId('refresh-todos')
  let snapshot = null
  let items = []
  let page = 1
  let preferredProjectId
  let revision = 0
  let poll

  function render() {
    const { types, progress, count, failures, hasMore } = snapshot
    const selected = typeFilter.value
    const categories = new Set(['', ...typeNames.keys(), ...types, selected])
    if (categories.size !== typeFilter.options.length ||
        [...typeFilter.options].some((option) => !categories.has(option.value))) {
      typeFilter.replaceChildren(new Option('全部类型', ''), ...[...categories]
        .filter(Boolean)
        .map((type) => new Option(typeNames.get(type) ?? type, type)))
      typeFilter.value = selected
    }
    let message = `共 ${count} 条待办`
    if (progress.loading) {
      message = progress.total == null ? '正在获取项目…'
        : `已找到 ${count} 条 · 已检查 ${progress.finished} / ${progress.total} 个项目`
    } else if (failures) {
      message = `已加载 ${count} 条待办`
    }
    summary.textContent = failures
      ? `${message} · ${failures} 个项目有待办未能加载，可刷新重试`
      : message
    byId('todo-empty').hidden = progress.loading || failures > 0 || count !== 0
    more.hidden = progress.loading || !hasMore
    more.disabled = false
    refreshButton.disabled = progress.loading
    const focused = results.contains(document.activeElement) ? document.activeElement.dataset.todoKey : ''
    const rendered = items.map((item) => {
      const meta = node('div', '', 'bar muted')
      meta.append(node('span', item.typeLabel, 'pill'), node('span', item.project.name))
      for (const label of [statusText(item.kind, item), item.priority, item.due]) {
        if (label) meta.append(node('span', label))
      }
      const control = row(item.title, meta, () => openDetail(item))
      control.dataset.todoKey = `${item.project.id}/${item.kind}/${item.id}`
      return control
    })
    results.replaceChildren(...rendered)
    if (focused) rendered.find((control) => control.dataset.todoKey === focused)?.focus({ preventScroll: true })
  }

  function pause() {
    clearTimeout(poll)
    revision++
  }

  async function load({ refresh = false, append = false } = {}) {
    pause()
    const requestRevision = revision
    const next = append ? page + 1 : 1
    refreshButton.disabled = true
    more.disabled = true
    if (refresh || !snapshot) summary.textContent = '正在加载待办…'
    try {
      const response = await tapd('todo-list', {
        ...(preferredProjectId ? { preferredProjectId } : {}),
        ...(projectFilter.value ? { projectId: projectFilter.value } : {}),
        ...(typeFilter.value ? { type: typeFilter.value } : {}),
        order: sort.value, page: next, refresh
      })
      if (requestRevision !== revision) return
      snapshot = response
      page = next
      items = append ? [...items, ...response.items] : response.items
      render()
      if (response.progress.loading && !byId('todos').hidden) {
        poll = setTimeout(() => void load(), 800)
      }
    } catch (error) {
      if (requestRevision !== revision) return
      summary.textContent = `无法加载待办。 ${error.message}`
      byId('todo-empty').hidden = true
      refreshButton.disabled = false
      more.disabled = false
    }
  }

  function setProjects(projects, preferredId) {
    preferredProjectId = preferredId
    const selected = projectFilter.value
    const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name))
    projectFilter.replaceChildren(new Option('全部项目', ''), ...sorted.map(({ id, name }) => new Option(name, id)))
    projectFilter.value = projects.some(({ id }) => id === selected) ? selected : ''
  }

  for (const control of [projectFilter, typeFilter, sort]) {
    control.addEventListener('change', () => void load())
  }
  on('more-todos', () => void load({ append: true }))

  return {
    pause,
    reset() {
      pause()
      snapshot = null
      items = []
      page = 1
      projectFilter.value = ''
      typeFilter.value = ''
      sort.value = 'due'
      summary.textContent = ''
      results.replaceChildren()
      more.hidden = true
      byId('todo-empty').hidden = true
    },
    refresh(projects, preferredId) {
      setProjects(projects, preferredId)
      void load({ refresh: true })
    },
    show(projects, preferredId, refresh = false) {
      view('todos')
      setProjects(projects, preferredId)
      if (refresh || !snapshot || snapshot.progress.loading) void load({ refresh })
    }
  }
}
