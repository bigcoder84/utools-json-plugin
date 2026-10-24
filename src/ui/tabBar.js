import { h } from './dom.js'
import { icon } from './icons.js'

/** 单个文档时隐藏；只有主动新增文档后才占用顶部空间。 */
export function createTabBar({ onSelect, onClose, onRename, onAdd }) {
  const root = h('div', { className: 'tab-bar', role: 'tablist', 'aria-label': 'JSON 文档', hidden: true })
  const elements = new Map()
  let items = []
  let currentId = null
  let editing = null
  root.append(h('button', {
    type: 'button', className: 'tab-bar__add', title: '新增标签页',
    onClick: () => { finishRename(true); onAdd() },
  }, h('span', { className: 'icon', html: icon('plus', 16) })))

  function finishRename(commit, focus = false) {
    if (!editing) return
    const { id, input, button } = editing
    editing = null
    const title = input.value.trim()
    input.replaceWith(button)
    if (commit && title && title !== items.find((tab) => tab.id === id)?.title) onRename(id, title)
    if (focus) button.focus()
  }

  function startRename(id) {
    if (editing?.id === id) return
    finishRename(true)
    const tab = items.find((item) => item.id === id)
    const button = elements.get(id)?.button
    if (!tab || !button) return
    const input = h('input', {
      type: 'text', className: 'document-tab__rename', value: tab.title,
      'aria-label': '标签名称', autocomplete: 'off', spellcheck: 'false',
      onBlur: () => finishRename(true),
      onKeydown: (event) => {
        // 中文输入法选词时的 Enter 不提交重命名。
        if (event.isComposing || event.keyCode === 229) return
        if (event.key !== 'Enter' && event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        finishRename(event.key === 'Enter', true)
      },
    })
    editing = { id, input, button }
    button.replaceWith(input)
    input.focus()
    input.select()
  }

  root.addEventListener('keydown', (event) => {
    if (!event.target.matches('[role="tab"]')) return
    if (event.key === 'F2') {
      event.preventDefault()
      startRename(currentId)
      return
    }
    const index = items.findIndex((tab) => tab.id === currentId)
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    onSelect(items[next].id)
    root.querySelector('[aria-selected="true"]')?.focus()
  })

  return {
    root,
    render(tabs, activeId) {
      items = tabs
      currentId = activeId
      root.hidden = tabs.length < 2
      for (const [id, entry] of elements) {
        if (tabs.some((tab) => tab.id === id)) continue
        if (editing?.id === id) finishRename(false)
        entry.row.remove()
        elements.delete(id)
      }
      tabs.forEach(({ id, title }, index) => {
        let entry = elements.get(id)
        if (!entry) {
          const button = h('button', {
            type: 'button', className: 'document-tab__select', role: 'tab', 'aria-controls': 'json-editor',
            onClick: () => onSelect(id),
            onDblclick: (event) => { event.preventDefault(); startRename(id) },
          })
          const close = h('button', {
            type: 'button', className: 'document-tab__close', onClick: () => onClose(id),
          }, h('span', { className: 'icon', html: icon('close', 12) }))
          entry = { button, close, row: h('div', { className: 'document-tab', role: 'presentation' }, button, close) }
          elements.set(id, entry)
        }
        const active = id === activeId
        entry.row.classList.toggle('is-active', active)
        entry.button.textContent = title
        entry.button.setAttribute('aria-label', title)
        entry.button.setAttribute('aria-selected', String(active))
        entry.button.tabIndex = active ? 0 : -1
        entry.button.dataset.tooltip = `${title}（双击或 F2 重命名）`
        entry.close.dataset.tooltip = `关闭 ${title}`
        entry.close.setAttribute('aria-label', `关闭 ${title}`)
        // 保留已有按钮，避免第一次单击切换标签时替换 DOM，导致双击失效。
        if (root.children[index] !== entry.row) root.insertBefore(entry.row, root.children[index] ?? null)
      })
      root.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    },
  }
}
