import { h } from './dom.js'
import { icon } from './icons.js'

/** 单个文档时隐藏；只有主动新增文档后才占用顶部空间。 */
export function createTabBar({ onSelect, onClose }) {
  const root = h('div', { className: 'tab-bar', role: 'tablist', 'aria-label': 'JSON 文档', hidden: true })
  let items = []
  let currentId = null

  root.addEventListener('keydown', (event) => {
    if (!event.target.matches('[role="tab"]')) return
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
      root.replaceChildren(...tabs.map(({ id, title }) => h(
        'div',
        { className: `document-tab${id === activeId ? ' is-active' : ''}`, role: 'presentation' },
        h('button', {
          type: 'button', className: 'document-tab__select', role: 'tab',
          'aria-selected': String(id === activeId), 'aria-controls': 'json-editor',
          tabindex: id === activeId ? '0' : '-1', title,
          onClick: () => onSelect(id),
        }, title),
        h('button', {
          type: 'button', className: 'document-tab__close', title: `关闭 ${title}`,
          onClick: () => onClose(id),
        }, h('span', { className: 'icon', html: icon('close', 12) })),
      )))
      root.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    },
  }
}
