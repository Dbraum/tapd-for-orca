import { Marked } from 'marked'
import { externalTaskUrlSchema } from './contracts/external-task-source'

function escapeHtmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function tapdParagraphHtml(text: string): string {
  return `<p>${escapeHtmlText(text).replace(/\r\n?|\n/g, '<br>')}</p>`
}

const tapdMarkdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtmlText(text),
    image: ({ text }) => escapeHtmlText(text),
    link(token) {
      if (!externalTaskUrlSchema.safeParse(token.href).success) {
        return this.parser.parseInline(token.tokens)
      }
      return false
    }
  }
})

export function tapdMarkdownHtml(text: string): string {
  try {
    return tapdMarkdown.parse(text, { async: false, breaks: true }).trim()
  } catch {
    return tapdParagraphHtml(text)
  }
}
