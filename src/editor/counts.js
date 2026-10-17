import { codeFolding } from '@codemirror/language'
import { RangeSet, RangeValue, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'

/**
 * 数组/对象成员数提示。
 *
 * 使用 widget 装饰渲染，提示文字不属于文档内容：全选、复制、压缩、转义、
 * 保存都不会带上它。数量来自完整解析（app 中每次分析后下发），
 * 两次分析之间的编辑通过位置映射保持对齐。
 */

/** @type {import('@codemirror/state').StateEffectType<{from: number, to: number, kind: string, count: number}[]>} */
export const setContainerCounts = StateEffect.define()

class CountMarker extends RangeValue {
  constructor(kind, count) {
    super()
    this.kind = kind
    this.count = count
  }

  eq(other) {
    return other.kind === this.kind && other.count === this.count
  }
}

class CountWidget extends WidgetType {
  constructor(count) {
    super()
    this.count = count
  }

  eq(other) {
    return other.count === this.count
  }

  toDOM() {
    const element = document.createElement('span')
    element.className = 'cm-count-hint'
    element.textContent = `${this.count} 项`
    element.setAttribute('aria-hidden', 'true')
    return element
  }

  ignoreEvent() {
    return false
  }
}

const describe = (marker) => (marker.kind === 'array' ? `${marker.count} 项` : `${marker.count} 个字段`)

function build(containers, doc) {
  const markers = []
  const widgets = []
  for (const { from, to, kind, count } of containers) {
    if (to > doc.length) continue
    markers.push(new CountMarker(kind, count).range(from))
    // 只给跨行的非空数组加行内提示；单行数组一眼可见，折叠后由占位符显示
    if (kind === 'array' && count > 0 && doc.lineAt(from).number !== doc.lineAt(to).number) {
      widgets.push(Decoration.widget({ widget: new CountWidget(count), side: 1 }).range(from + 1))
    }
  }
  return { markers: RangeSet.of(markers, true), widgets: Decoration.set(widgets, true) }
}

const countField = StateField.define({
  create: () => ({ markers: RangeSet.empty, widgets: Decoration.none }),
  update(value, tr) {
    let next = tr.docChanged ? { markers: value.markers.map(tr.changes), widgets: value.widgets.map(tr.changes) } : value
    for (const effect of tr.effects) {
      if (effect.is(setContainerCounts)) next = build(effect.value, tr.state.doc)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.widgets),
})

/** 折叠占位符：`[… 12 项]`、`{… 5 个字段}` */
const foldPlaceholder = codeFolding({
  preparePlaceholder(state, range) {
    let found = null
    // 折叠范围从左括号之后开始，左括号位置即 range.from - 1
    state.field(countField).markers.between(range.from - 1, range.from - 1, (from, _to, marker) => {
      if (from === range.from - 1) {
        found = marker
        return false
      }
      return undefined
    })
    return found ? describe(found) : null
  },
  placeholderDOM(_view, onclick, prepared) {
    const element = document.createElement('span')
    element.className = 'cm-foldPlaceholder'
    element.textContent = prepared ? `… ${prepared}` : '…'
    element.dataset.tooltip = '点击展开'
    element.setAttribute('aria-label', prepared ? `已折叠，${prepared}` : '已折叠')
    element.onclick = onclick
    return element
  },
})

export const countExtensions = [countField, foldPlaceholder]

/** 供测试使用：读取当前所有成员数提示 */
export function containerHints(state) {
  const hints = []
  state.field(countField).widgets.between(0, state.doc.length, (from, _to, decoration) => {
    hints.push({ pos: from, count: decoration.spec.widget.count })
  })
  return hints
}
