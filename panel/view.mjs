/* global orca */

export const byId = (id) => document.getElementById(id)
export const field = (form, name) => form.elements.namedItem(name)
export const kinds = { story: '需求', bug: '缺陷', task: '任务' }
const panel = byId('panel')
const notice = byId('notice')

export function announce(message, tone = 'normal') {
  notice.textContent = message
  notice.dataset.tone = tone
}

export function view(id) {
  for (const section of panel.children) {
    section.hidden = section.id !== id
  }
  window.scrollTo(0, 0)
}

const errors = {
  credentials: 'TAPD 令牌缺失或已失效，请在连接设置中重新验证。',
  permission: '当前 TAPD 账号没有这项操作的权限。',
  conflict: '该工单已变更或当前状态无法流转，请返回列表刷新后重试。',
  'not-found': '工单不存在或已被移动。',
  'rate-limit': 'TAPD 请求过于频繁，请稍后再试。',
  unavailable: '暂时无法连接 TAPD，请重试。',
  invalid: 'TAPD 返回的数据或表单内容无效。',
  busy: '正在为该工单创建工作区。',
  'workspace-project': '所选 Orca Git 项目已不可用，请重新选择。',
  'workspace-create': '创建工作区失败。请检查项目、基准分支和初始化设置。'
}

export function request(name, input = {}) {
  return orca.plugin.request(name, input, { timeoutMs: 120_000 })
}

export async function tapd(name, input) {
  const result = await request(name, input)
  if (!result.ok) {
    throw new Error(errors[result.code] ?? '操作失败，请重试。')
  }
  return result.value
}

export async function run(action, loading = '加载中…') {
  if (panel.inert) {
    return
  }
  panel.inert = true
  panel.setAttribute('aria-busy', 'true')
  const settings = byId('settings-button')
  settings.disabled = true
  announce(loading, 'loading')
  try {
    await action()
    if (notice.dataset.tone === 'loading') {
      announce('')
    }
  } catch (error) {
    const messages = Object.values(errors)
    announce(
      messages.includes(error?.message) ? error.message : '操作失败，请检查连接后重试。',
      'error'
    )
  } finally {
    panel.inert = false
    panel.setAttribute('aria-busy', 'false')
    settings.disabled = false
    const search = document.querySelector('[data-focus-next]')
    if (search) {
      delete search.dataset.focusNext
      search.focus()
    }
  }
}

export function node(tag, content, className) {
  const element = document.createElement(tag)
  if (content) {
    element.textContent = content
  }
  if (className) {
    element.className = className
  }
  return element
}

export function button(label, onClick, className) {
  const element = node('button', label, className)
  element.type = 'button'
  element.addEventListener('click', onClick)
  return element
}

export function plainText(content) {
  const text = (content ?? '').replace(/<br\b[^>]*>|<\/(?:div|li|p|h[1-6])\s*>/gi, '\n')
  const parsed = new DOMParser().parseFromString(text, 'text/html')
  for (const element of parsed.querySelectorAll('script, style, template')) {
    element.remove()
  }
  return parsed.body.textContent.trim()
}

export function row(title, metadata, onClick) {
  const element = button('', onClick, 'row')
  element.append(node('strong', title), metadata)
  return element
}

export function on(id, callback, event = 'click') {
  byId(id).addEventListener(event, callback)
}

export function submit(id, callback, loading) {
  on(
    id,
    (event) => {
      event.preventDefault()
      const form = event.currentTarget
      void run(() => callback(form), loading)
    },
    'submit'
  )
}
