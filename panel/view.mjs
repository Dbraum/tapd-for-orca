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
      messages.includes(error?.message) ? error.message : '操作失败，请重试。',
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

export async function openExternal(url, message = '无法打开链接。') {
  try {
    await orca.shell.openExternal(url)
  } catch {
    announce(message, 'error')
  }
}

export function externalLink(url, baseUrl) {
  if (!url?.trim()) {
    return null
  }
  try {
    const target = new URL(url, baseUrl)
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      return null
    }
    const link = document.createElement('a')
    link.href = target.href
    link.addEventListener('click', (event) => {
      event.preventDefault()
      void openExternal(target.href)
    })
    return link
  } catch {
    return null
  }
}

const richTags = new Set([
  'p', 'div', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup',
  'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'
])
const droppedRichTags = new Set([
  'script', 'style', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript'
])
const tapdImageOrigins = new Set(['https://www.tapd.cn', 'https://tapd.cn', 'https://file.tapd.cn'])
const rasterDataUrl = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+=*$/i

async function loadImagePreview(projectId, imagePath) {
  let chunk = await tapd('image-preview', { projectId, imagePath })
  const { mime } = chunk
  const parts = [chunk.base64]
  while (chunk.next) {
    chunk = await tapd('image-preview-chunk', chunk.next)
    parts.push(chunk.base64)
  }
  return `data:${mime};base64,${parts.join('')}`
}

// Load images as they approach the viewport, one at a time.
let loadingImages = Promise.resolve()
const imageLoads = new WeakMap()
const imageObserver = new IntersectionObserver((entries) => {
  for (const { isIntersecting, target } of entries) {
    if (!isIntersecting) continue
    imageObserver.unobserve(target)
    const load = imageLoads.get(target)
    imageLoads.delete(target)
    loadingImages = loadingImages.then(load).catch(() => {
      // The original link remains usable if the image cannot be loaded.
    })
  }
}, { rootMargin: '160px 0px' })

function richImage(source, baseUrl, projectId, insideLink) {
  const label = source.getAttribute('alt')?.trim() || '查看图片'
  const sources = ['data-src', 'data-original', 'src']
    .map((attribute) => source.getAttribute(attribute)?.trim())
    .filter(Boolean)
  const sourceLinks = sources.map((value) => externalLink(value, baseUrl)).filter(Boolean)
  const tapdLink = sourceLinks.find((link) => {
    const url = new URL(link.href)
    return tapdImageOrigins.has(url.origin) && url.pathname.startsWith('/tfl/')
  })
  const embedded = sources.find((value) => rasterDataUrl.test(value))
  const fallback = insideLink
    ? node('span')
    : tapdLink ?? sourceLinks[0] ?? externalLink(baseUrl) ?? node('span')
  fallback.textContent = label
  if (!embedded && (!tapdLink || !projectId)) {
    return fallback
  }
  const preview = node('span', '', 'detail-image')
  preview.append(fallback)
  imageLoads.set(preview, async () => {
    if (!preview.isConnected || preview.closest('[hidden]')) return
    const image = document.createElement('img')
    image.alt = source.getAttribute('alt')?.trim() || 'TAPD 图片'
    image.src = embedded ?? await loadImagePreview(projectId, tapdLink.href)
    await image.decode()
    if (preview.isConnected) {
      fallback.replaceChildren(image)
    }
  })
  imageObserver.observe(preview)
  return preview
}

function richChildren(source, baseUrl, projectId, insideLink = false) {
  const fragment = document.createDocumentFragment()
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      fragment.append(child.textContent)
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE || droppedRichTags.has(child.localName)) {
      continue
    }
    const tag = child.localName
    if (tag === 'img') {
      fragment.append(richImage(child, baseUrl, projectId, insideLink))
      continue
    }
    const link =
      tag === 'a' && !insideLink ? externalLink(child.getAttribute('href'), baseUrl) : null
    const children = richChildren(child, baseUrl, projectId, insideLink || Boolean(link))
    const displayTag = tag === 'h1' || tag === 'h2' ? 'h4' : tag
    // Recreate allowed elements and copy only explicitly validated attributes.
    const element = link ?? (richTags.has(displayTag) ? document.createElement(displayTag) : null)
    if (!element) {
      fragment.append(children)
      continue
    }
    if (tag === 'td' || tag === 'th') {
      for (const attr of ['colspan', 'rowspan']) {
        const span = child.getAttribute(attr)
        if (span && /^[1-9]\d{0,2}$/.test(span)) {
          element.setAttribute(attr, span)
        }
      }
    }
    element.append(children)
    if (tag === 'table') {
      const scroll = node('div', '', 'detail-table')
      scroll.tabIndex = 0
      scroll.setAttribute('role', 'region')
      scroll.setAttribute('aria-label', '表格')
      scroll.append(element)
      fragment.append(scroll)
    } else {
      fragment.append(element)
    }
  }
  return fragment
}

export function richText(content, baseUrl, projectId, empty = '暂无描述。') {
  const template = document.createElement('template')
  template.innerHTML = content ?? ''
  const result = richChildren(template.content, baseUrl, projectId)
  if (!result.textContent.trim()) {
    return node('p', empty, 'muted')
  }
  return template.content.childElementCount
    ? result
    : node('p', result.textContent, 'text-block')
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
