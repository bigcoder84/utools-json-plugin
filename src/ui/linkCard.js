import { isLikelyNonImageUrl, isOpenableUrl } from '../core/urls.js'
import { h } from './dom.js'
import { icon } from './icons.js'
import { createImageElement, describeSize, loadImageMeta } from './imageMeta.js'

const DATA_URL_PREVIEW_LENGTH = 48

export function displayUrl(url) {
  if (!url.startsWith('data:')) return url
  const kb = (url.length * 0.75) / 1024
  return `${url.slice(0, DATA_URL_PREVIEW_LENGTH)}…（约 ${kb.toFixed(1)} KB）`
}

function actionButton(label, iconName, onClick) {
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
 * 链接悬浮卡片：图片链接（按扩展名判断）自动显示预览。
 * 其它链接不会自动发请求（避免悬停就触发一次性链接等副作用），
 * 扩展名不明确的链接提供「预览图片」按钮，点击后才按图片加载。
 *
 * @param {{url: string, isImage: boolean}} link
 * @param {{onOpen: (url: string) => void, onCopy: (url: string) => void, onResize?: () => void, modKey: string}} handlers
 */
export function createLinkCard(link, { onOpen, onCopy, onResize, modKey }) {
  const canOpen = isOpenableUrl(link.url)
  const canProbe = !link.isImage && canOpen && !isLikelyNonImageUrl(link.url)

  const preview = h('div', { className: 'link-card__preview is-loading', hidden: !link.isImage }, '加载中…')
  const meta = h('span', { className: 'link-card__meta' })

  const loadPreview = (fromProbe) => {
    preview.hidden = false
    onResize?.()
    loadImageMeta(link.url).then((result) => {
      if (result.ok) {
        preview.className = 'link-card__preview'
        preview.replaceChildren(createImageElement(link.url, 'link-card__image'))
        meta.textContent = describeSize(result)
      } else {
        preview.className = 'link-card__preview is-error'
        preview.replaceChildren(
          h('span', { className: 'icon', html: icon('imageOff', 20) }),
          fromProbe ? '不是图片或无法加载' : '图片加载失败',
        )
      }
      onResize?.()
    })
  }
  const probeButton = canProbe
    ? actionButton('预览图片', 'image', () => {
        probeButton.remove()
        loadPreview(true)
      })
    : null

  const dom = h(
    'div',
    { className: 'link-card' },
    preview,
    h('div', { className: 'link-card__url', title: link.url.startsWith('data:') ? null : link.url }, displayUrl(link.url)),
    h(
      'div',
      { className: 'link-card__footer' },
      meta,
      h(
        'div',
        { className: 'link-card__actions' },
        probeButton,
        canOpen && actionButton('打开', 'external', () => onOpen(link.url)),
        actionButton('复制链接', 'copy', () => onCopy(link.url)),
      ),
    ),
    canOpen && h('div', { className: 'link-card__hint' }, `提示：${modKey} + 点击链接可直接打开`),
  )

  if (link.isImage) loadPreview(false)
  return dom
}
