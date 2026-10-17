import { highlightCode } from '@lezer/highlight'
import { formatJson } from '../core/format.js'
import { jsoncLanguage } from '../editor/language.js'
import { highlightStyle } from '../editor/theme.js'
import { h } from './dom.js'
import { icon } from './icons.js'

const MAX_PREVIEW_LINES = 300

export function describeNested({ kind, count }) {
  return kind === 'array' ? `${count} 项` : `${count} 个字段`
}

/** 用 Lezer 解析树做静态高亮，文本一律走 textContent */
function highlighted(code) {
  const pre = h('pre', { className: 'nested-preview__code' })
  let line = h('div', { className: 'nested-preview__line' })
  pre.append(line)
  highlightCode(
    code,
    jsoncLanguage.parser.parse(code),
    highlightStyle,
    (text, classes) => line.append(classes ? h('span', { className: classes }, text) : text),
    () => {
      line = h('div', { className: 'nested-preview__line' })
      pre.append(line)
    },
  )
  return pre
}

function action(label, iconName, onClick) {
  return h(
    'button',
    {
      type: 'button',
      className: 'link-card__action',
      onMousedown: (event) => event.preventDefault(),
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      },
    },
    h('span', { className: 'icon', html: icon(iconName, 14) }),
    label,
  )
}

/**
 * 嵌套 JSON 字符串的悬浮预览卡片
 * @param {{text: string, kind: 'object'|'array', count: number, indent: string, onOpen: () => void, onCopy: (formatted: string) => void}} options
 */
export function createNestedPreview({ text, kind, count, indent, onOpen, onCopy }) {
  let formatted
  try {
    formatted = formatJson(text, indent)
  } catch {
    formatted = text
  }
  const lines = formatted.split('\n')
  const truncated = lines.length > MAX_PREVIEW_LINES
  const shown = truncated ? lines.slice(0, MAX_PREVIEW_LINES).join('\n') : formatted

  return h(
    'div',
    { className: 'nested-preview' },
    h(
      'div',
      { className: 'nested-preview__header' },
      h('span', { className: 'nested-preview__title' }, kind === 'array' ? '嵌套 JSON 数组' : '嵌套 JSON 对象'),
      h('span', { className: 'nested-preview__meta' }, `${describeNested({ kind, count })} · ${lines.length} 行`),
      h('span', { className: 'spacer' }),
      action('进入查看', 'enter', onOpen),
      action('复制格式化', 'copy', () => onCopy(formatted)),
    ),
    highlighted(shown),
    truncated && h('div', { className: 'nested-preview__more' }, `仅预览前 ${MAX_PREVIEW_LINES} 行，共 ${lines.length} 行，点击「进入查看」看完整内容`),
  )
}
