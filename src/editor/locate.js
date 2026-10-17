import { ensureSyntaxTree, foldEffect, foldedRanges, syntaxTree, unfoldEffect } from '@codemirror/language'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

const FLASH_DURATION = 1200
const FULL_PARSE_TIMEOUT = 1500

/** 设置同一图片所有出现位置的高亮：{ranges: {from, to}[], current: number} | null */
const setOccurrences = StateEffect.define()
const setFlash = StateEffect.define()

const occurrenceMark = Decoration.mark({ class: 'cm-image-occurrence' })
const currentMark = Decoration.mark({ class: 'cm-image-occurrence cm-image-occurrence-current' })
const flashMark = Decoration.mark({ class: 'cm-locate-flash' })

function rangeField(effect, build) {
  return StateField.define({
    create: () => Decoration.none,
    update(decorations, tr) {
      let next = decorations.map(tr.changes)
      for (const e of tr.effects) {
        if (e.is(effect)) next = e.value ? build(e.value, tr.state.doc.length) : Decoration.none
      }
      return next
    },
    provide: (field) => EditorView.decorations.from(field),
  })
}

const clampRange = (range, length) => range.from < range.to && range.to <= length

const occurrenceField = rangeField(setOccurrences, ({ ranges, current }, length) =>
  Decoration.set(
    ranges
      .map((range, index) => ({ ...range, index }))
      .filter((range) => clampRange(range, length))
      .map((range) => (range.index === current ? currentMark : occurrenceMark).range(range.from, range.to)),
    true,
  ),
)

const flashField = rangeField(setFlash, (range, length) =>
  clampRange(range, length) ? Decoration.set([flashMark.range(range.from, range.to)]) : Decoration.none,
)

export const locateExtensions = [occurrenceField, flashField]

export function highlightOccurrences(view, ranges, current) {
  view.dispatch({ effects: setOccurrences.of(ranges.length > 0 ? { ranges, current } : null) })
}

export function clearOccurrences(view) {
  view.dispatch({ effects: setOccurrences.of(null) })
}

let flashTimer = 0

/** 定位到指定范围：展开所在折叠区域、选中、居中滚动并闪烁提示 */
export function revealRange(view, rawFrom, rawTo) {
  // 位置可能来自上一次分析，文档随后被删短时需要截断
  const length = view.state.doc.length
  const from = Math.max(0, Math.min(rawFrom, length))
  const to = Math.max(from, Math.min(rawTo, length))
  const effects = []
  foldedRanges(view.state).between(from, to, (foldFrom, foldTo) => {
    effects.push(unfoldEffect.of({ from: foldFrom, to: foldTo }))
  })
  effects.push(EditorView.scrollIntoView(from, { y: 'center' }), setFlash.of({ from, to }))
  view.dispatch({ selection: { anchor: from, head: to }, effects, userEvent: 'select.locate' })
  view.focus()

  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: setFlash.of(null) })
  }, FLASH_DURATION)
}

/**
 * 折叠到指定层级：level=1 只保留根节点，level=2 折叠根节点的子节点（默认），以此类推
 */
export function foldToLevel(view, level = 2) {
  const { state } = view
  const tree = ensureSyntaxTree(state, state.doc.length, FULL_PARSE_TIMEOUT) ?? syntaxTree(state)
  const effects = []
  let depth = 0

  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Object' && node.name !== 'Array') return undefined
      depth++
      if (depth < level) return undefined
      const last = node.node.lastChild
      const from = node.from + 1
      const to = last && (last.name === '}' || last.name === ']') ? last.from : node.to
      if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number) {
        effects.push(foldEffect.of({ from, to }))
      }
      depth--
      return false
    },
    leave: (node) => {
      if (node.name === 'Object' || node.name === 'Array') depth--
    },
  })

  if (effects.length > 0) view.dispatch({ effects })
  return effects.length
}
