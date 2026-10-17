import {
  LRLanguage,
  LanguageSupport,
  continuedIndent,
  foldInside,
  foldNodeProp,
  indentNodeProp,
} from '@codemirror/language'
import { styleTags, tags as t } from '@lezer/highlight'
import { parser } from './jsonc-parser.js'

export const jsoncLanguage = LRLanguage.define({
  name: 'jsonc',
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Object: continuedIndent({ except: /^\s*\}/ }),
        Array: continuedIndent({ except: /^\s*\]/ }),
      }),
      foldNodeProp.add({ 'Object Array': foldInside }),
      styleTags({
        String: t.string,
        Number: t.number,
        'True False': t.bool,
        PropertyName: t.propertyName,
        Null: t.null,
        ',': t.separator,
        ':': t.punctuation,
        '[ ]': t.squareBracket,
        '{ }': t.brace,
        LineComment: t.lineComment,
        BlockComment: t.blockComment,
      }),
    ],
  }),
  languageData: {
    closeBrackets: { brackets: ['[', '{', '"'] },
    indentOnInput: /^\s*[}\]]$/,
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
})

export function jsonc() {
  return new LanguageSupport(jsoncLanguage)
}
