import { h } from './dom.js'

const HOVER_DELAY = 120

/** 替代延迟不可控的原生 title，使用委托处理动态创建的按钮。 */
export function createTooltips(container) {
  const bubble = h('div', { className: 'ui-tooltip', id: 'ui-tooltip', role: 'tooltip', hidden: true })
  document.body.append(bubble)
  let target = null
  let timer = 0

  function hide() {
    clearTimeout(timer)
    if (target) {
      const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== bubble.id)
      if (ids.length) target.setAttribute('aria-describedby', ids.join(' '))
      else target.removeAttribute('aria-describedby')
    }
    target = null
    bubble.hidden = true
  }

  function show() {
    if (!target?.isConnected || !target.getClientRects().length) return hide()
    bubble.textContent = target.dataset.tooltip
    bubble.hidden = false
    const rect = target.getBoundingClientRect()
    const size = bubble.getBoundingClientRect()
    const left = Math.min(window.innerWidth - size.width - 8, Math.max(8, rect.left + (rect.width - size.width) / 2))
    const top = rect.top >= size.height + 16 ? rect.top - size.height - 8 : rect.bottom + 8
    bubble.style.left = `${left}px`
    bubble.style.top = `${Math.max(8, Math.min(top, window.innerHeight - size.height - 8))}px`
    const ids = new Set((target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean))
    ids.add(bubble.id)
    target.setAttribute('aria-describedby', [...ids].join(' '))
  }

  function enter(element, immediate = false) {
    const next = element.closest?.('[data-tooltip]')
    if (!next?.dataset.tooltip || next === target) return
    const visible = !bubble.hidden
    hide()
    target = next
    timer = setTimeout(show, immediate || visible ? 0 : HOVER_DELAY)
  }

  container.addEventListener('pointerover', (event) => enter(event.target))
  container.addEventListener('pointerout', (event) => {
    if (target && !target.contains(event.relatedTarget)) hide()
  })
  container.addEventListener('focusin', (event) => {
    if (event.target.matches(':focus-visible')) enter(event.target, true)
  })
  container.addEventListener('focusout', hide)
  container.addEventListener('pointerdown', hide)
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide() })
  document.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  window.addEventListener('blur', hide)
  return { hide }
}
