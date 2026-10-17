import { foldEffect, foldedRanges } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { parseJson } from '../src/core/parser.js'
import { containerHints, countExtensions, setContainerCounts } from '../src/editor/counts.js'

const text = '{\n  "list": [\n    1,\n    2,\n    3\n  ],\n  "inline": [1, 2],\n  "empty": [\n  ],\n  "obj": {\n    "a": 1\n  }\n}'

function stateWithCounts(doc = text) {
  const state = EditorState.create({ doc, extensions: countExtensions })
  const { containers } = parseJson(doc, { collectContainers: true })
  return state.update({ effects: setContainerCounts.of(containers) }).state
}

describe('container count hints', () => {
  it('adds a hint after "[" only for multi-line non-empty arrays', () => {
    const state = stateWithCounts()
    expect(containerHints(state)).toEqual([{ pos: text.indexOf('[') + 1, count: 3 }])
  })

  it('never changes the document text (copy/select-all stay clean)', () => {
    const state = stateWithCounts()
    expect(state.doc.toString()).toBe(text)
    expect(state.sliceDoc(0, state.doc.length)).not.toContain('项')
  })

  it('keeps hints aligned when text is inserted before them', () => {
    const state = stateWithCounts()
    const next = state.update({ changes: { from: 0, insert: '  ' } }).state
    expect(containerHints(next)).toEqual([{ pos: text.indexOf('[') + 3, count: 3 }])
  })

  it('replaces hints when new counts arrive', () => {
    const state = stateWithCounts()
    const next = state.update({ effects: setContainerCounts.of([]) }).state
    expect(containerHints(next)).toEqual([])
  })

  it('works together with folding state', () => {
    const state = stateWithCounts()
    const open = text.indexOf('[')
    const folded = state.update({ effects: foldEffect.of({ from: open + 1, to: text.indexOf(']') }) }).state
    expect(foldedRanges(folded).size).toBe(1)
    expect(containerHints(folded)).toHaveLength(1)
  })
})
