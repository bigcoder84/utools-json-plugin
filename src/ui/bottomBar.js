import { h } from './dom.js'
import { icon } from './icons.js'

const FILTER_PLACEHOLDER = 'JS 过滤；示例 ".key.subkey"、"[0][1]"、".map(x=>x.val)"'

/** 只在可编辑视图中可用（过滤 / 展开结果为只读） */
const EDIT_ONLY_ACTIONS = new Set(['format', 'minify', 'stripComments'])

/**
 * @param {{mod: string, shift: string}} keys 快捷键显示文本
 */
function toolbarButtons({ mod, shift }) {
  return [
    { action: 'format', icon: 'format', title: `格式化（${mod}${shift}F）· 自动识别转义过的 JSON` },
    { action: 'foldAll', icon: 'foldAll', title: '折叠（折叠到第 2 层）' },
    { action: 'unfoldAll', icon: 'unfoldAll', title: '全部展开' },
    { action: 'expandNested', icon: 'nested', title: '展开全部嵌套 JSON 字符串（只读查看，可再配合 JS 过滤）' },
    { action: 'stripComments', icon: 'stripComments', title: '去除注释' },
    'divider',
    { action: 'minify', icon: 'minify', title: `压缩（${mod}${shift}M）` },
    { action: 'escapeCopy', icon: 'escape', title: `压缩转义并复制（${mod}${shift}E）` },
    { action: 'copy', icon: 'copy', title: '复制全部内容' },
    'divider',
    { action: 'wrap', text: '换行', title: '自动换行（Alt+Z）' },
    { action: 'indent', text: true, title: '切换缩进（2 空格 / 4 空格）' },
    { action: 'images', icon: 'image', title: `图片列表（${mod}${shift}I）`, badge: true },
    'divider',
    { action: 'newTab', icon: 'newTab', title: `新增标签页（${mod}T）` },
  ]
}

/**
 * @param {{onFilterInput: (value: string) => void, onAction: (action: string) => void, keys: {mod: string, shift: string}}} options
 */
export function createBottomBar({ onFilterInput, onAction, keys }) {
  const input = h('input', {
    className: 'filter__input',
    type: 'text',
    placeholder: FILTER_PLACEHOLDER,
    spellcheck: 'false',
    autocomplete: 'off',
    title: `以 . / [ / ?. 开头时拼接在 this 之后；也可以写完整表达式，用 this 或 $ 引用数据（${keys.mod}E 聚焦）`,
    onInput: () => {
      clearButton.hidden = input.value.length === 0
      onFilterInput(input.value)
    },
  })
  const clearButton = h(
    'button',
    {
      type: 'button',
      className: 'filter__clear',
      title: '清除过滤，回到编辑',
      hidden: true,
      onClick: () => {
        input.value = ''
        clearButton.hidden = true
        onFilterInput('')
        input.focus()
      },
    },
    h('span', { className: 'icon', html: icon('close', 14) }),
  )
  const errorEl = h('div', { className: 'filter__error', hidden: true })
  const filter = h('label', { className: 'filter' }, h('span', { className: 'filter__prefix' }, 'this'), input, clearButton, errorEl)

  const status = h('button', { type: 'button', className: 'status-chip', hidden: true })
  let statusClick = null
  status.addEventListener('click', () => statusClick?.())

  const buttons = new Map()
  let badge = null
  const toolbar = h(
    'div',
    { className: 'toolbar', role: 'toolbar' },
    toolbarButtons(keys).map((item) => {
      if (item === 'divider') return h('span', { className: 'toolbar__divider' })
      const button = h(
        'button',
        {
          type: 'button',
          className: `icon-btn${item.text ? ' icon-btn--text' : ''}`,
          title: item.title,
          'aria-label': item.title,
          dataset: { action: item.action },
          onClick: () => onAction(item.action),
        },
        item.icon ? h('span', { className: 'icon', html: icon(item.icon) }) : typeof item.text === 'string' ? item.text : null,
      )
      if (item.badge) {
        badge = h('span', { className: 'icon-btn__badge', hidden: true })
        button.append(badge)
      }
      buttons.set(item.action, button)
      return button
    }),
  )

  const root = h('footer', { className: 'bottom-bar' }, filter, status, toolbar)

  return {
    root,
    input,
    setFilterError(message) {
      errorEl.hidden = !message
      errorEl.textContent = message ?? ''
      filter.classList.toggle('has-error', Boolean(message))
    },
    clearFilter() {
      input.value = ''
      clearButton.hidden = true
      this.setFilterError(null)
    },
    setFilterMode(active) {
      filter.classList.toggle('is-active', active)
    },
    /** 设置输入框内容但不触发过滤（切换层级时恢复该层级的表达式） */
    setFilterValue(value) {
      input.value = value
      clearButton.hidden = value.length === 0
    },
    setEditable(editable) {
      for (const action of EDIT_ONLY_ACTIONS) buttons.get(action).disabled = !editable
    },
    setExpandNested(on) {
      buttons.get('expandNested').classList.toggle('is-on', on)
    },
    /** @param {{kind: 'ok'|'error'|'info', text: string, title?: string, onClick?: () => void} | null} next */
    setStatus(next) {
      status.hidden = !next
      if (!next) return
      status.className = `status-chip status-chip--${next.kind}`
      status.textContent = next.text
      status.dataset.tooltip = next.title ?? ''
      status.disabled = !next.onClick
      statusClick = next.onClick ?? null
    },
    setImageCount(count) {
      badge.hidden = count === 0
      badge.textContent = count > 99 ? '99+' : String(count)
    },
    setImagePanelOpen(open) {
      buttons.get('images').classList.toggle('is-on', open)
    },
    setWrap(enabled) {
      buttons.get('wrap').classList.toggle('is-on', enabled)
    },
    setIndent(size) {
      buttons.get('indent').textContent = `缩进 ${size}`
    },
  }
}
