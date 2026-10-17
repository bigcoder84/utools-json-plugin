import { h } from './dom.js'
import { icon } from './icons.js'

/**
 * 子视图路径导航：`← 返回  根 › [0].text › .data   已修改 · 返回时写回  [放弃修改]`
 * @param {{onNavigate: (depth: number) => void, onDiscard: () => void}} handlers
 */
export function createSubviewBar({ onNavigate, onDiscard }) {
  const crumbs = h('nav', { className: 'subview-bar__crumbs', 'aria-label': '嵌套层级' })
  const stateEl = h('span', { className: 'subview-bar__state' })
  const discardButton = h(
    'button',
    { type: 'button', className: 'subview-bar__discard', title: '丢弃当前层级的修改并返回上一级', onClick: onDiscard },
    '放弃修改',
  )
  const backButton = h(
    'button',
    { type: 'button', className: 'subview-bar__back', title: '返回上一级（有修改时自动写回）' },
    h('span', { className: 'icon', html: icon('back', 15) }),
    '返回',
  )
  const root = h('div', { className: 'subview-bar', hidden: true }, backButton, crumbs, h('span', { className: 'spacer' }), stateEl, discardButton)
  let depth = 0
  backButton.addEventListener('click', () => onNavigate(depth - 1))

  return {
    root,
    /** @param {{crumbs: string[], dirty: boolean, writable: boolean}} info */
    render({ crumbs: labels, dirty, writable }) {
      depth = labels.length
      root.hidden = depth === 0
      if (depth === 0) return

      const items = [h('button', { type: 'button', className: 'subview-bar__crumb', onClick: () => onNavigate(0) }, '根')]
      labels.forEach((label, index) => {
        items.push(h('span', { className: 'subview-bar__sep' }, '›'))
        const isCurrent = index === labels.length - 1
        items.push(
          isCurrent
            ? h('span', { className: 'subview-bar__crumb is-current', title: label }, label)
            : h('button', { type: 'button', className: 'subview-bar__crumb', title: label, onClick: () => onNavigate(index + 1) }, label),
        )
      })
      crumbs.replaceChildren(...items)

      stateEl.className = `subview-bar__state${dirty ? ' is-dirty' : ''}`
      stateEl.textContent = !writable ? '只读（来自过滤/展开结果）' : dirty ? '已修改 · 返回时写回' : '可编辑，返回时自动写回'
      discardButton.hidden = !dirty
    },
  }
}
