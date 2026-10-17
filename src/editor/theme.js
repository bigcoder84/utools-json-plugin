import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** 颜色全部走 CSS 变量，亮/暗主题只需切换 <html> 上的 class */
export const highlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--hl-key)' },
  { tag: t.string, color: 'var(--hl-string)' },
  { tag: t.number, color: 'var(--hl-number)' },
  { tag: [t.bool, t.null], color: 'var(--hl-keyword)' },
  { tag: [t.lineComment, t.blockComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.brace, t.squareBracket, t.separator, t.punctuation], color: 'var(--hl-punct)' },
])

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size)',
    color: 'var(--fg)',
    backgroundColor: 'var(--editor-bg)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--caret)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--gutter-fg)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 12px', minWidth: '32px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--gutter-active-fg)' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-fold-marker': { display: 'inline-flex', alignItems: 'center', height: '100%', color: 'var(--gutter-fg)' },
  '.cm-fold-marker:hover': { color: 'var(--fg)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--fold-bg)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    borderRadius: '4px',
    padding: '0 6px',
    margin: '0 2px',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'var(--selection)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--bracket-match)',
    outline: '1px solid var(--border-strong)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match)', outline: '1px solid var(--search-match-border)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-match-selected)' },
  '.cm-panels': { backgroundColor: 'var(--panel-bg)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { fontFamily: 'var(--font-ui)', padding: '6px 8px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--input-bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--fg)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--button-bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--fg)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover-bg)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow)',
    color: 'var(--fg)',
  },
  '.cm-tooltip.cm-tooltip-hover': { padding: '0' },
  '.cm-diagnostic': { fontFamily: 'var(--font-ui)', padding: '6px 10px' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
})

export const editorTheme = [baseTheme, syntaxHighlighting(highlightStyle)]
