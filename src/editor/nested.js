import { indentUnit } from '@codemirror/language'
import { Facet, RangeSet, RangeValue, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, hoverTooltip } from '@codemirror/view'
import { createNestedPreview, describeNested } from '../ui/nestedPreview.js'
import { linkAt } from './links.js'

/**
 * 嵌套 JSON 字符串：值前面显示「{ } 4 个字段」标签（字符串通常很长，放在键名旁边才看得到），
 * 悬停字符串或标签预览格式化内容，点击标签进入子视图。
 * 标签是 widget，不属于文档内容，不影响复制。
 */

/**
 * @typedef {{from: number, to: number, kind: 'object'|'array', count: number, label: string, pathText: string | null}} NestedEntry
 * @type {Facet<{onOpen: (view: EditorView, entry: NestedEntry) => void, onCopy: (text: string) => void}, any>}
 */
export const nestedActions = Facet.define({ combine: (values) => values[values.length - 1] ?? null })

/** @type {import('@codemirror/state').StateEffectType<NestedEntry[]>} */
export const setNestedStrings = StateEffect.define()

class NestedMarker extends RangeValue {
  constructor(entry) {
    super()
    this.kind = entry.kind
    this.count = entry.count
    this.label = entry.label
    this.pathText = entry.pathText
  }

  eq(other) {
    return other.kind === this.kind && other.count === this.count && other.pathText === this.pathText
  }
}

function entryFrom(from, to, marker) {
  return { from, to, kind: marker.kind, count: marker.count, label: marker.label, pathText: marker.pathText }
}

/** 查找覆盖 pos 的嵌套字符串（端点包含在内） */
export function nestedAt(state, pos) {
  let found = null
  state.field(nestedField).markers.between(pos, pos, (from, to, marker) => {
    found = entryFrom(from, to, marker)
    return false
  })
  return found
}

class NestedChip extends WidgetType {
  constructor(kind, count) {
    super()
    this.kind = kind
    this.count = count
  }

  eq(other) {
    return other.kind === this.kind && other.count === this.count
  }

  toDOM(view) {
    const chip = document.createElement('span')
    chip.className = 'cm-nested-chip'
    chip.setAttribute('role', 'button')
    chip.title = '嵌套 JSON 字符串：悬停预览，点击进入查看'
    const brace = document.createElement('span')
    brace.className = 'cm-nested-chip__brace'
    brace.textContent = this.kind === 'array' ? '[ ]' : '{ }'
    chip.append(brace, describeNested(this))

    chip.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    chip.addEventListener('click', (event) => {
      event.preventDefault()
      const entry = nestedAt(view.state, view.posAtDOM(chip))
      const actions = view.state.facet(nestedActions)
      if (entry && actions) actions.onOpen(view, entry)
    })
    return chip
  }

  /** 让编辑器忽略标签上的事件（不移动光标），由标签自己处理点击 */
  ignoreEvent() {
    return true
  }
}

function build(entries, doc) {
  const markers = []
  const widgets = []
  for (const entry of entries) {
    if (entry.to > doc.length || entry.from >= entry.to) continue
    markers.push(new NestedMarker(entry).range(entry.from, entry.to))
    widgets.push(Decoration.widget({ widget: new NestedChip(entry.kind, entry.count), side: -1 }).range(entry.from))
  }
  return { markers: RangeSet.of(markers, true), widgets: Decoration.set(widgets, true) }
}

const nestedField = StateField.define({
  create: () => ({ markers: RangeSet.empty, widgets: Decoration.none }),
  update(value, tr) {
    let next = tr.docChanged ? { markers: value.markers.map(tr.changes), widgets: value.widgets.map(tr.changes) } : value
    for (const effect of tr.effects) {
      if (effect.is(setNestedStrings)) next = build(effect.value, tr.state.doc)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.widgets),
})

function decodedText(state, entry) {
  try {
    const value = JSON.parse(state.sliceDoc(entry.from, entry.to))
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

const nestedHover = hoverTooltip(
  (view, pos) => {
    const entry = nestedAt(view.state, pos)
    // 悬停在字符串里的链接上时交给链接卡片
    if (!entry || linkAt(view.state, pos)) return null
    const text = decodedText(view.state, entry)
    const actions = view.state.facet(nestedActions)
    if (text === null || !actions) return null
    return {
      pos: entry.from,
      end: entry.to,
      above: false,
      create: () => ({
        dom: createNestedPreview({
          text,
          kind: entry.kind,
          count: entry.count,
          indent: view.state.facet(indentUnit),
          onOpen: () => actions.onOpen(view, entry),
          onCopy: actions.onCopy,
        }),
      }),
    }
  },
  { hoverTime: 300 },
)

export const nestedExtensions = [nestedField, nestedHover]
