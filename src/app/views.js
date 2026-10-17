import { EditorView } from '@codemirror/view'
import { evaluateExpression, stringifyValue } from '../core/evaluate.js'
import { formatJson, minifyJson } from '../core/format.js'
import { expandNestedJson } from '../core/nested.js'
import { parseJson } from '../core/parser.js'

/**
 * 视图控制器：管理同一个 EditorView 上的几种「视图」。
 *
 * - 层级（level）：根文档，或进入的某个嵌套 JSON 字符串（子视图）。子视图可以多层，
 *   返回时若内容有修改，压缩转义后写回父级的字符串字段（可撤销）。
 * - 结果视图：在当前层级上做 JS 过滤 / 一键展开嵌套 JSON，结果只读；
 *   退出后恢复编辑态（撤销历史、折叠状态都保留）。
 *
 * 每个层级各自记录过滤表达式和展开开关，进入子视图时保存、返回时恢复。
 */

const newLevel = () => ({ snapshot: null, scroll: null, expression: '', expandNested: false, expandedCount: 0 })

/**
 * @param {{
 *   view: EditorView,
 *   makeState: (doc: string, readOnly: boolean) => import('@codemirror/state').EditorState,
 *   indentText: () => string,
 *   onStateReplaced: () => void,
 *   onBeforeResultView: () => void,
 *   onChange: () => void,
 *   notify: (message: string, kind?: string) => void,
 *   revealError: (from: number, to: number) => void,
 * }} deps
 */
export function createViewController({ view, makeState, indentText, onStateReplaced, onBeforeResultView, onChange, notify, revealError }) {
  let level = newLevel()
  /** @type {{parentState: any, parentLevel: any, from: number, to: number, entryDoc: any, writable: boolean, multiline: boolean, label: string}[]} */
  const frames = []
  let filterError = null

  /** 记录当前滚动位置（返回时恢复） */
  const scrollSnapshot = () => view.scrollSnapshot?.() ?? null

  /**
   * 切换显示的 EditorState。restoreScroll 为之前记录的滚动位置；
   * 不传时视为新打开的视图，滚动到左上角（否则会继承上一个视图的滚动位置）。
   */
  function replaceState(state, restoreScroll = null) {
    view.setState(state)
    onStateReplaced()
    view.dispatch({ effects: restoreScroll ?? EditorView.scrollIntoView(0, { y: 'start', x: 'start' }) })
    onChange()
  }

  const editState = () => level.snapshot ?? view.state

  // ---------- 结果视图（过滤 / 展开嵌套） ----------
  function computeResult() {
    let source = editState().doc.toString()
    let expandedCount = 0
    if (level.expandNested) {
      const expanded = expandNestedJson(source)
      try {
        source = formatJson(expanded.text, indentText())
      } catch (error) {
        return { error: `无法展开嵌套 JSON：${error.message}`, fromExpand: true }
      }
      expandedCount = expanded.count
    }
    if (!level.expression.trim()) return { text: source, expandedCount }

    const result = evaluateExpression(source, level.expression)
    if (!result.ok) return { error: result.error }
    try {
      return { text: stringifyValue(result.value, indentText()), expandedCount }
    } catch (error) {
      return { error: `结果无法序列化：${error.message}` }
    }
  }

  function refresh() {
    if (!level.expression.trim() && !level.expandNested) {
      filterError = null
      leaveResultView()
      onChange()
      return
    }
    const result = computeResult()
    if (result.error) {
      if (result.fromExpand) {
        level.expandNested = false
        notify(result.error, 'error')
      } else {
        filterError = result.error
      }
      onChange()
      return
    }
    filterError = null
    if (!level.snapshot) {
      onBeforeResultView()
      level.snapshot = view.state
      level.scroll = scrollSnapshot()
    }
    level.expandedCount = result.expandedCount
    replaceState(makeState(result.text, true))
  }

  function leaveResultView() {
    if (!level.snapshot) return
    const { snapshot, scroll } = level
    level.snapshot = null
    level.scroll = null
    replaceState(snapshot, scroll)
  }

  // ---------- 子视图 ----------
  function enterNested(entry) {
    let decoded
    let formatted
    try {
      decoded = JSON.parse(view.state.sliceDoc(entry.from, entry.to))
      formatted = formatJson(decoded, indentText())
    } catch (error) {
      notify(`无法进入：${error.message}`, 'error')
      return
    }
    const writable = !level.snapshot && !view.state.readOnly
    const child = makeState(formatted, !writable)
    frames.push({
      parentState: view.state,
      parentScroll: scrollSnapshot(),
      parentLevel: level,
      from: entry.from,
      to: entry.to,
      entryDoc: child.doc,
      writable,
      multiline: decoded.includes('\n'),
      label: entry.pathText ?? entry.label,
    })
    level = newLevel()
    filterError = null
    replaceState(child)
  }

  /** 返回上一级；有修改时写回。内容不合法时停留在当前层级并返回 false */
  function pop({ writeBack = true } = {}) {
    const frame = frames[frames.length - 1]
    if (!frame) return true

    let insert = null
    const childDoc = editState().doc
    if (writeBack && frame.writable && !childDoc.eq(frame.entryDoc)) {
      const text = childDoc.toString()
      const parsed = parseJson(text)
      if (!parsed.ok || parsed.empty) {
        leaveResultView()
        notify(`无法写回：${parsed.ok ? '内容为空' : parsed.error.message}。可以修正后再返回，或选择「放弃修改」`, 'error')
        if (!parsed.ok) revealError(parsed.error.from, parsed.error.to)
        return false
      }
      // 原字符串是压缩的就压缩写回，原本带换行的保留格式化排版
      insert = JSON.stringify(frame.multiline ? text : minifyJson(text))
    }

    frames.pop()
    level = frame.parentLevel
    filterError = null
    replaceState(frame.parentState, frame.parentScroll ?? EditorView.scrollIntoView(frame.from, { y: 'center' }))

    // 光标回到该字段开头；写回作为父级的一次普通修改，可撤销
    view.dispatch({
      changes: insert === null ? undefined : { from: frame.from, to: frame.to, insert },
      selection: { anchor: frame.from },
      userEvent: insert === null ? 'select' : 'input.nested',
    })
    if (insert !== null) notify(`已写回 ${frame.label}`, 'success')
    return true
  }

  function popTo(depth) {
    while (frames.length > depth) {
      if (!pop()) return false
    }
    view.focus()
    return true
  }

  /** 丢弃所有子视图和结果视图，回到根文档编辑态（加载新内容前调用） */
  function resetToRoot() {
    while (frames.length > 0) pop({ writeBack: false })
    level.expression = ''
    level.expandNested = false
    filterError = null
    leaveResultView()
    onChange()
  }

  return {
    refresh,
    setExpression(expression) {
      level.expression = expression
      refresh()
    },
    toggleExpandNested() {
      level.expandNested = !level.expandNested
      refresh()
      if (level.expandNested && level.snapshot) {
        notify(level.expandedCount > 0 ? `已展开 ${level.expandedCount} 处嵌套 JSON（只读）` : '没有发现嵌套 JSON 字符串', level.expandedCount > 0 ? 'success' : 'info')
      }
    },
    /** 清空过滤并关闭展开，回到当前层级的编辑态 */
    exitResultView() {
      level.expression = ''
      level.expandNested = false
      refresh()
    },
    enterNested,
    back: () => popTo(frames.length - 1),
    popTo,
    discard() {
      pop({ writeBack: false })
      view.focus()
    },
    resetToRoot,
    /** 切换文档时连同结果视图、子视图栈和滚动位置一起保存。 */
    capture() {
      return {
        state: view.state,
        scroll: scrollSnapshot(),
        level,
        frames: frames.slice(),
        filterError,
        rootText: this.rootDoc().toString(),
      }
    },
    restore(session) {
      level = session.level ?? newLevel()
      frames.splice(0, frames.length, ...(session.frames ?? []))
      filterError = session.filterError ?? null
      replaceState(session.state, session.scroll)
    },
    isResultView: () => level.snapshot !== null,
    /** 根文档的编辑态内容（用于保存） */
    rootDoc() {
      const root = frames[0]
      return root ? (root.parentLevel.snapshot ?? root.parentState).doc : editState().doc
    },
    describe() {
      const frame = frames[frames.length - 1]
      return {
        expression: level.expression,
        expandNested: level.expandNested,
        expandedCount: level.expandedCount,
        resultView: level.snapshot !== null,
        filterError,
        crumbs: frames.map((item) => item.label),
        writable: frame ? frame.writable : true,
        dirty: Boolean(frame?.writable && !editState().doc.eq(frame.entryDoc)),
      }
    },
  }
}
