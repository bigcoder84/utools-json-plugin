import { h } from './dom.js'
import { icon } from './icons.js'
import { createImageElement, describeSize, loadImageMeta } from './imageMeta.js'
import { displayUrl } from './linkCard.js'

const PREVIEW_DELAY = 180

function hostOf(url) {
  if (url.startsWith('data:')) return 'data URI'
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function iconButton(iconName, title, onClick, extraClass = '') {
  return h(
    'button',
    {
      type: 'button',
      className: `icon-btn icon-btn--sm ${extraClass}`.trim(),
      title,
      'aria-label': title,
      onClick: (event) => {
        event.stopPropagation()
        onClick()
      },
    },
    h('span', { className: 'icon', html: icon(iconName, 15) }),
  )
}

/**
 * 图片列表面板。
 *
 * 重复链接的交互：
 * - 相同链接合并为一张卡片，徽标显示「N 处」
 * - 点击卡片定位到第 1 处，再次点击依次循环到下一处（徽标显示「2/N」）
 * - 展开后列出所有引用字段，可直接点选定位到某一处
 * - 激活后，编辑器中该链接的所有出现位置都会高亮，当前处更醒目
 *
 * @param {{onLocate: (url: string, index: number) => void, onOpen: (url: string) => void, onCopy: (text: string, label: string) => void, onClose: () => void}} handlers
 */
export function createImagePanel({ onLocate, onOpen, onCopy, onClose }) {
  const state = { images: [], total: 0, pathsAvailable: true, query: '', active: null, expanded: new Set() }
  let cards = new Map()

  const countEl = h('span', { className: 'image-panel__count' })
  const searchInput = h('input', {
    className: 'image-panel__search',
    type: 'search',
    placeholder: '筛选字段名 / 路径 / 链接',
    spellcheck: 'false',
    onInput: (event) => {
      state.query = event.target.value.trim().toLowerCase()
      renderList()
    },
  })
  const noticeEl = h('div', { className: 'image-panel__notice', hidden: true }, 'JSON 存在语法错误，暂以行号代替字段路径')
  const listEl = h('ul', { className: 'image-list' })
  const emptyEl = h('div', { className: 'image-panel__empty' })
  const preview = createHoverPreview()

  const root = h(
    'aside',
    { className: 'image-panel', 'aria-label': '图片列表' },
    h(
      'header',
      { className: 'image-panel__header' },
      h('span', { className: 'image-panel__title' }, '图片'),
      countEl,
      h('span', { className: 'spacer' }),
      iconButton('close', '收起图片列表', onClose),
    ),
    h('div', { className: 'image-panel__search-wrap' }, searchInput),
    noticeEl,
    listEl,
    emptyEl,
  )
  listEl.addEventListener('scroll', () => preview.hide())

  function matches(group) {
    if (!state.query) return true
    const query = state.query
    return (
      group.url.toLowerCase().includes(query) ||
      group.occurrences.some(
        (item) => item.label.toLowerCase().includes(query) || item.pathText?.toLowerCase().includes(query),
      )
    )
  }

  function renderList() {
    const visible = state.images.filter(matches)
    const next = new Map()
    const elements = visible.map((group) => {
      const card = cards.get(group.url) ?? createCard(group.url)
      updateCard(card, group)
      next.set(group.url, card)
      return card.root
    })
    cards = next
    listEl.replaceChildren(...elements)

    const unique = state.images.length
    countEl.textContent = unique === 0 ? '' : unique === state.total ? `${unique} 张` : `${unique} 张 · ${state.total} 处`
    noticeEl.hidden = state.pathsAvailable || unique === 0
    emptyEl.hidden = visible.length > 0
    emptyEl.replaceChildren(
      ...(unique === 0
        ? [h('strong', {}, '未发现图片链接'), h('span', {}, '识别 png / jpg / gif / webp / svg 等扩展名的链接与 data:image')]
        : [h('strong', {}, '没有匹配的图片')]),
    )
  }

  function createCard(url) {
    const thumb = h('div', { className: 'image-card__thumb is-loading' })
    const image = createImageElement(url, 'image-card__img', { lazy: true })
    thumb.append(image)

    const labelEl = h('span', { className: 'image-card__label' })
    const badgeEl = h('span', { className: 'image-card__badge' })
    const pathEl = h('div', { className: 'image-card__path' })
    const sizeEl = h('span', {})
    const metaEl = h('div', { className: 'image-card__meta' }, sizeEl, h('span', {}, hostOf(url)))
    const toggleBtn = iconButton('chevronRight', '展开全部引用位置', () => toggleExpanded(url), 'image-card__toggle')
    const occurrencesEl = h('ol', { className: 'image-card__occurrences' })

    image.addEventListener('load', () => {
      thumb.classList.remove('is-loading')
      sizeEl.textContent = describeSize({ ok: true, width: image.naturalWidth, height: image.naturalHeight })
    })
    image.addEventListener('error', () => {
      thumb.classList.remove('is-loading')
      thumb.classList.add('is-error')
      thumb.innerHTML = icon('imageOff', 20)
      sizeEl.textContent = '加载失败'
    })

    const main = h(
      'button',
      { type: 'button', className: 'image-card__main', onClick: () => handleCardClick(url) },
      thumb,
      h('div', { className: 'image-card__info' }, h('div', { className: 'image-card__title' }, labelEl, badgeEl), pathEl, metaEl),
    )
    thumb.addEventListener('mouseenter', () => preview.show(url, thumb))
    thumb.addEventListener('mouseleave', () => preview.hide())

    const cardRoot = h(
      'li',
      { className: 'image-card' },
      main,
      toggleBtn,
      h(
        'div',
        { className: 'image-card__actions' },
        url.startsWith('data:') ? null : iconButton('external', '在浏览器中打开', () => onOpen(url)),
        iconButton('copy', '复制图片链接', () => onCopy(url, '图片链接')),
      ),
      occurrencesEl,
    )

    return { root: cardRoot, labelEl, badgeEl, pathEl, toggleBtn, occurrencesEl, main }
  }

  function updateCard(card, group) {
    const count = group.occurrences.length
    const isActive = state.active?.url === group.url
    const currentIndex = isActive ? Math.min(state.active.index, count - 1) : 0
    const current = group.occurrences[currentIndex]
    const expanded = count > 1 && state.expanded.has(group.url)

    card.root.classList.toggle('is-active', isActive)
    card.root.classList.toggle('is-expanded', expanded)
    card.root.classList.toggle('has-duplicates', count > 1)
    card.labelEl.textContent = current.label
    card.badgeEl.hidden = count === 1
    card.badgeEl.textContent = isActive ? `${currentIndex + 1}/${count}` : `${count} 处`
    card.badgeEl.dataset.tooltip = count > 1 ? `该链接被 ${count} 个字段引用，再次点击卡片切换到下一处` : ''
    card.pathEl.textContent = current.pathText ? `this${current.pathText}` : current.label
    card.main.dataset.tooltip = `${displayUrl(group.url)}\n\n点击定位${count > 1 ? '（重复点击依次切换引用位置）' : ''}`
    card.toggleBtn.hidden = count === 1
    card.toggleBtn.dataset.tooltip = expanded ? '收起引用位置' : `展开全部 ${count} 处引用位置`
    card.toggleBtn.setAttribute('aria-label', card.toggleBtn.dataset.tooltip)
    card.toggleBtn.querySelector('.icon').innerHTML = icon(expanded ? 'chevronDown' : 'chevronRight', 15)

    if (!expanded) {
      card.occurrencesEl.replaceChildren()
      return
    }
    card.occurrencesEl.replaceChildren(
      ...group.occurrences.map((item, index) =>
        h(
          'li',
          { className: `occurrence${isActive && index === currentIndex ? ' is-current' : ''}` },
          h(
            'button',
            { type: 'button', className: 'occurrence__main', title: '定位到该字段', onClick: () => onLocate(group.url, index) },
            h('span', { className: 'occurrence__index' }, String(index + 1)),
            h('span', { className: 'occurrence__path' }, item.pathText ? `this${item.pathText}` : item.label),
            h('span', { className: 'occurrence__line' }, `L${item.line}`),
          ),
          item.pathExpression
            ? iconButton('path', '复制字段路径（可粘贴到 JS 过滤框）', () => onCopy(item.pathExpression, '字段路径'))
            : null,
        ),
      ),
    )
  }

  function handleCardClick(url) {
    const group = state.images.find((item) => item.url === url)
    if (!group) return
    const isActive = state.active?.url === url
    const index = isActive ? (state.active.index + 1) % group.occurrences.length : 0
    onLocate(url, index)
  }

  function toggleExpanded(url) {
    if (state.expanded.has(url)) state.expanded.delete(url)
    else state.expanded.add(url)
    renderList()
  }

  return {
    root,
    /** @param {{images: any[], total: number, pathsAvailable: boolean}} result */
    render(result) {
      state.images = result.images
      state.total = result.total
      state.pathsAvailable = result.pathsAvailable
      if (state.active && !result.images.some((group) => group.url === state.active.url)) state.active = null
      renderList()
    },
    setActive(url, index, { scroll = true } = {}) {
      const changed = state.active?.url !== url
      state.active = { url, index }
      const group = state.images.find((item) => item.url === url)
      if (changed && group && group.occurrences.length > 1) state.expanded.add(url)
      renderList()
      const card = cards.get(url)
      if (scroll && card) card.root.scrollIntoView({ block: 'nearest' })
    },
    clearActive() {
      if (!state.active) return
      state.active = null
      renderList()
    },
    get activeUrl() {
      return state.active?.url ?? null
    },
    focusSearch() {
      searchInput.focus()
    },
  }
}

/** 鼠标悬停缩略图时，在面板左侧显示大图 */
function createHoverPreview() {
  const image = h('div', { className: 'image-hover-preview__img' })
  const meta = h('div', { className: 'image-hover-preview__meta' })
  const root = h('div', { className: 'image-hover-preview', hidden: true }, image, meta)
  document.body.append(root)
  let timer = 0
  let currentUrl = null

  function position(anchor) {
    const panel = anchor.closest('.image-panel')?.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    const height = root.offsetHeight
    const top = Math.max(8, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - 8))
    root.style.top = `${top}px`
    root.style.right = `${window.innerWidth - (panel?.left ?? rect.left) + 8}px`
  }

  return {
    show(url, anchor) {
      clearTimeout(timer)
      timer = setTimeout(() => {
        currentUrl = url
        image.replaceChildren(createImageElement(url, ''))
        meta.textContent = '加载中…'
        root.hidden = false
        position(anchor)
        loadImageMeta(url).then((result) => {
          if (currentUrl !== url) return
          meta.textContent = result.ok ? describeSize(result) : '图片加载失败'
          position(anchor)
        })
      }, PREVIEW_DELAY)
    },
    hide() {
      clearTimeout(timer)
      currentUrl = null
      root.hidden = true
    },
  }
}
