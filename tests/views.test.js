import { history, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { createViewController } from '../src/app/views.js'

const inner = { code: 'alipay', list: [1, 2] }
const doc = JSON.stringify({ name: 'x', text: JSON.stringify(inner) }, null, 2)

function setup(initial = doc) {
  const makeState = (text, readOnly) => EditorState.create({ doc: text, extensions: [history(), EditorState.readOnly.of(readOnly)] })
  const view = {
    state: makeState(initial, false),
    setState(state) {
      this.state = state
    },
    dispatch(...specs) {
      this.state = this.state.update(...specs).state
    },
    focus() {},
  }
  const notify = vi.fn()
  const views = createViewController({
    view,
    makeState,
    indentText: () => '  ',
    onStateReplaced: () => {},
    onBeforeResultView: () => {},
    onChange: () => {},
    notify,
    revealError: () => {},
  })
  const entryFor = (raw) => {
    const from = view.state.doc.toString().indexOf(raw)
    return { from, to: from + raw.length, kind: 'object', count: 2, label: 'text', pathText: '.text' }
  }
  const edit = (from, to, insert) => view.dispatch({ changes: { from, to, insert } })
  const text = () => view.state.doc.toString()
  return { view, views, notify, entryFor, edit, text, makeState }
}

describe('view controller: tab sessions', () => {
  it('restores edits, selection and undo history after a tab switch', () => {
    const { view, views, makeState, edit, text } = setup()
    edit(0, 0, ' ')
    view.dispatch({ selection: { anchor: 5 } })
    const first = views.capture()
    views.restore({ state: makeState('{}', false), rootText: '{}' })
    edit(1, 1, '"other":true')
    views.restore(first)
    expect(text()).toBe(' ' + doc)
    expect(view.state.selection.main.head).toBe(5)
    undo({ state: view.state, dispatch: (tr) => view.dispatch(tr) })
    expect(text()).toBe(doc)
  })

  it('retains a pending nested edit and writes back to the correct parent', () => {
    const { views, makeState, entryFor, edit, text } = setup()
    views.enterNested(entryFor(JSON.stringify(JSON.stringify(inner))))
    const at = text().indexOf('"alipay"')
    edit(at, at + 8, '"wechat"')
    const nestedTab = views.capture()
    expect(nestedTab.rootText).toBe(doc)
    views.restore({ state: makeState('{"different":true}', false) })
    expect(views.describe().crumbs).toEqual([])
    views.restore(nestedTab)
    expect(views.describe()).toMatchObject({ crumbs: ['.text'], dirty: true })
    views.back()
    expect(JSON.parse(JSON.parse(text()).text).code).toBe('wechat')
  })

  it('restores a read-only filter and can return to its original document', () => {
    const { views, view, makeState, text } = setup()
    views.setExpression('.name')
    views.setExpression('.missing.key')
    const filtered = views.capture()
    views.restore({ state: makeState('[]', false) })
    expect(views.describe().expression).toBe('')
    views.restore(filtered)
    expect(text()).toBe('"x"')
    expect(view.state.readOnly).toBe(true)
    expect(views.describe().filterError).toMatch(/执行出错/)
    views.exitResultView()
    expect(text()).toBe(doc)
  })
})

describe('view controller: result views', () => {
  it('shows a read-only filter result and restores the edit state', () => {
    const { view, views, text } = setup()
    views.setExpression('.name')
    expect(text()).toBe('"x"')
    expect(view.state.readOnly).toBe(true)
    expect(views.describe()).toMatchObject({ resultView: true, expression: '.name' })
    views.setExpression('')
    expect(text()).toBe(doc)
    expect(view.state.readOnly).toBe(false)
  })

  it('keeps the last result and reports filter errors', () => {
    const { views, text } = setup()
    views.setExpression('.name')
    views.setExpression('.nope.deep')
    expect(text()).toBe('"x"')
    expect(views.describe().filterError).toMatch(/执行出错/)
  })

  it('expands nested JSON strings and can filter the expanded data', () => {
    const { views, text } = setup()
    views.toggleExpandNested()
    expect(JSON.parse(text())).toEqual({ name: 'x', text: inner })
    expect(views.describe()).toMatchObject({ expandNested: true, expandedCount: 1 })
    views.setExpression('.text.list.length')
    expect(text()).toBe('2')
    views.exitResultView()
    expect(text()).toBe(doc)
  })
})

describe('view controller: nested sub-views', () => {
  const raw = JSON.stringify(JSON.stringify(inner))

  it('opens a nested string as an editable sub-view', () => {
    const { view, views, entryFor, text } = setup()
    views.enterNested(entryFor(raw))
    expect(JSON.parse(text())).toEqual(inner)
    expect(view.state.readOnly).toBe(false)
    expect(views.describe()).toMatchObject({ crumbs: ['.text'], writable: true, dirty: false })
    expect(views.rootDoc().toString()).toBe(doc)
  })

  it('returns without changes when nothing was edited', () => {
    const { views, entryFor, text } = setup()
    views.enterNested(entryFor(raw))
    views.back()
    expect(text()).toBe(doc)
  })

  it('writes edits back as a minified, escaped string', () => {
    const { views, entryFor, edit, text, notify } = setup()
    views.enterNested(entryFor(raw))
    const at = text().indexOf('"alipay"')
    edit(at, at + '"alipay"'.length, '"wechat"')
    expect(views.describe().dirty).toBe(true)
    views.back()
    expect(JSON.parse(JSON.parse(text()).text)).toEqual({ code: 'wechat', list: [1, 2] })
    expect(JSON.parse(text()).text).toBe('{"code":"wechat","list":[1,2]}')
    expect(notify).toHaveBeenCalledWith('已写回 .text', 'success')
  })

  it('keeps formatted layout when the original string had line breaks', () => {
    const pretty = JSON.stringify(JSON.stringify(inner, null, 2))
    const source = `{"text": ${pretty}}`
    const { views, entryFor, edit, text } = setup(source)
    views.enterNested(entryFor(pretty))
    edit(text().length - 1, text().length - 1, ',\n  "x": 1\n')
    views.back()
    expect(JSON.parse(text()).text).toContain('\n')
    expect(JSON.parse(JSON.parse(text()).text)).toEqual({ ...inner, x: 1 })
  })

  it('refuses to write back invalid JSON and allows discarding', () => {
    const { views, entryFor, edit, text, notify } = setup()
    views.enterNested(entryFor(raw))
    edit(0, 1, '')
    expect(views.back()).toBe(false)
    expect(notify.mock.calls.at(-1)[0]).toMatch(/无法写回/)
    expect(views.describe().crumbs).toEqual(['.text'])
    views.discard()
    expect(text()).toBe(doc)
  })

  it('propagates edits through several nested levels', () => {
    const deepInner = { data: JSON.stringify({ v: 1 }) }
    const source = JSON.stringify({ outer: JSON.stringify(deepInner) })
    const { views, view, edit, text } = setup(source)
    const at = (needle) => {
      const from = text().indexOf(needle)
      return { from, to: from + needle.length, kind: 'object', count: 1, label: 'x', pathText: null }
    }
    views.enterNested(at(JSON.stringify(JSON.stringify(deepInner))))
    views.enterNested(at(JSON.stringify(deepInner.data)))
    expect(views.describe().crumbs).toHaveLength(2)
    const pos = text().indexOf('1')
    edit(pos, pos + 1, '2')
    views.popTo(0)
    const outer = JSON.parse(JSON.parse(view.state.doc.toString()).outer)
    expect(JSON.parse(outer.data)).toEqual({ v: 2 })
  })

  it('opens nested strings inside a filter result as read-only', () => {
    const { view, views, text } = setup()
    views.setExpression('.text')
    const value = text()
    views.enterNested({ from: 0, to: value.length, kind: 'object', count: 2, label: 'text', pathText: null })
    expect(view.state.readOnly).toBe(true)
    expect(views.describe().writable).toBe(false)
    views.back()
    expect(views.describe()).toMatchObject({ resultView: true, expression: '.text', crumbs: [] })
    expect(text()).toBe(value)
  })

  it('resets to the root document, discarding sub-views', () => {
    const { views, entryFor, edit, text } = setup()
    views.enterNested(entryFor(raw))
    edit(0, 0, ' ')
    views.resetToRoot()
    expect(text()).toBe(doc)
    expect(views.describe()).toMatchObject({ crumbs: [], resultView: false })
  })
})
