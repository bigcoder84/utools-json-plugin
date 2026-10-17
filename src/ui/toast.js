import { h } from './dom.js'

const DURATION = { info: 1800, success: 1800, error: 4000 }

let container = null

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [kind='info']
 */
export function showToast(message, kind = 'info') {
  if (!container) {
    container = h('div', { className: 'toast-container', role: 'status', 'aria-live': 'polite' })
    document.body.append(container)
  }
  const toast = h('div', { className: `toast toast--${kind}` }, message)
  container.append(toast)
  while (container.children.length > 3) container.firstElementChild.remove()

  setTimeout(() => {
    toast.classList.add('is-leaving')
    setTimeout(() => toast.remove(), 200)
  }, DURATION[kind] ?? DURATION.info)
}
