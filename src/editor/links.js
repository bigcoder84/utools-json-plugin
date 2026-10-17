import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, hoverTooltip } from '@codemirror/view'
import { findUrls, isOpenableUrl } from '../core/urls.js'
import { createLinkCard } from '../ui/linkCard.js'

const STRING_NODES = new Set(['String', 'PropertyName'])
const LINK_CLASS = 'cm-link'

/** 查找文档位置 pos 处的链接 */
export function linkAt(state, pos) {
  const tree = syntaxTree(state)
  for (const side of [1, -1]) {
    const node = tree.resolveInner(pos, side)
    if (STRING_NODES.has(node.name)) {
      const links = findUrls(state.sliceDoc(node.from, node.to), node.from)
      return links.find((link) => link.from <= pos && pos <= link.to) ?? null
    }
  }
  return null
}

function buildDecorations(view) {
  const ranges = []
  const seen = new Set()
  const tree = syntaxTree(view.state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (!STRING_NODES.has(node.name)) return undefined
        if (seen.has(node.from)) return false
        seen.add(node.from)
        for (const link of findUrls(view.state.sliceDoc(node.from, node.to), node.from)) {
          const className = link.isImage ? `${LINK_CLASS} ${LINK_CLASS}-image` : LINK_CLASS
          const attributes = isOpenableUrl(link.url) ? { 'data-url': link.url } : undefined
          ranges.push(Decoration.mark({ class: className, attributes }).range(link.from, link.to))
        }
        return false
      },
    })
  }
  return Decoration.set(ranges, true)
}

const linkDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view)
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** 按住 ⌘/Ctrl 时给编辑器加 class，链接显示手型光标 */
const modifierTracker = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view
      this.onKey = (event) => this.toggle(event.metaKey || event.ctrlKey)
      this.onBlur = () => this.toggle(false)
      window.addEventListener('keydown', this.onKey)
      window.addEventListener('keyup', this.onKey)
      window.addEventListener('blur', this.onBlur)
    }

    toggle(active) {
      this.view.dom.classList.toggle('cm-mod-held', active)
    }

    destroy() {
      window.removeEventListener('keydown', this.onKey)
      window.removeEventListener('keyup', this.onKey)
      window.removeEventListener('blur', this.onBlur)
    }
  },
)

/**
 * 链接相关扩展：下划线装饰、⌘/Ctrl + 点击打开、悬浮卡片（图片预览）
 * @param {{onOpen: (url: string) => void, onCopy: (url: string) => void, modKey: string}} handlers
 */
export function linkExtensions({ onOpen, onCopy, modKey }) {
  const clickHandler = EditorView.domEventHandlers({
    mousedown(event) {
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
      const target = event.target instanceof Element ? event.target.closest('[data-url]') : null
      if (!target) return false
      event.preventDefault()
      onOpen(target.getAttribute('data-url'))
      return true
    },
  })

  const tooltip = hoverTooltip(
    (view, pos, side) => {
      const link = linkAt(view.state, pos)
      if (!link || (side < 0 && pos === link.from) || (side > 0 && pos === link.to)) return null
      return {
        pos: link.from,
        end: link.to,
        above: true,
        create: (tooltipView) => ({
          dom: createLinkCard(link, { onOpen, onCopy, modKey, onResize: () => tooltipView.requestMeasure() }),
        }),
      }
    },
    { hoverTime: 250 },
  )

  return [linkDecorations, modifierTracker, clickHandler, tooltip]
}
