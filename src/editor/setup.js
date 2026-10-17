import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language'
import { lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'
import { icon } from '../ui/icons.js'
import { countExtensions } from './counts.js'
import { nestedActions, nestedExtensions } from './nested.js'
import { jsonc } from './language.js'
import { linkExtensions } from './links.js'
import { locateExtensions } from './locate.js'
import { editorTheme } from './theme.js'

export const indentCompartment = new Compartment()
export const wrapCompartment = new Compartment()

export const wrapExtension = (enabled) => (enabled ? EditorView.lineWrapping : [])

export function indentExtension(size) {
  return [indentUnit.of(' '.repeat(size)), EditorState.tabSize.of(size)]
}

function foldMarker(open) {
  const marker = document.createElement('span')
  marker.className = 'cm-fold-marker'
  marker.dataset.tooltip = open ? '折叠' : '展开'
  marker.innerHTML = icon(open ? 'chevronDown' : 'chevronRight', 14)
  return marker
}

/**
 * @param {string} doc
 * @param {{
 *   readOnly?: boolean,
 *   indent: number,
 *   wrap: boolean,
 *   appKeymap: import('@codemirror/view').KeyBinding[],
 *   links: Parameters<typeof linkExtensions>[0],
 *   nested: {onOpen: (view: EditorView, entry: object) => void, onCopy: (text: string) => void},
 *   onUpdate: (update: import('@codemirror/view').ViewUpdate) => void,
 *   onDropFile: (file: File) => void,
 * }} options
 */
export function createEditorState(doc, { readOnly = false, indent, wrap, appKeymap, links, nested, onUpdate, onDropFile }) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      foldGutter({ markerDOM: foldMarker }),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([
        ...appKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      wrapCompartment.of(wrapExtension(wrap)),
      jsonc(),
      editorTheme,
      indentCompartment.of(indentExtension(indent)),
      EditorState.readOnly.of(readOnly),
      readOnly ? [] : placeholder('粘贴或输入 JSON，支持注释、转义过的 JSON；也可以把 .json 文件拖进来'),
      EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      linkExtensions(links),
      locateExtensions,
      countExtensions,
      nestedExtensions,
      nestedActions.of(nested),
      EditorView.updateListener.of(onUpdate),
      EditorView.domEventHandlers({
        drop(event) {
          const file = event.dataTransfer?.files?.[0]
          if (!file) return false
          event.preventDefault()
          onDropFile(file)
          return true
        },
      }),
    ],
  })
}
