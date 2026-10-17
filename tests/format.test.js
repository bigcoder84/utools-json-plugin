import { describe, expect, it } from 'vitest'
import { escapeJson, formatJson, minifyJson, minimalChange, smartFormat, stripComments, tryUnescapeJson } from '../src/core/format.js'

describe('formatJson', () => {
  it('formats nested objects and arrays with the given indent', () => {
    expect(formatJson('{"a":1,"b":[1,2,{"c":null}],"d":{}}', '  ')).toBe(
      '{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ],\n  "d": {}\n}',
    )
  })

  it('supports 4-space and tab indentation', () => {
    expect(formatJson('[1]', '    ')).toBe('[\n    1\n]')
    expect(formatJson('[1]', '\t')).toBe('[\n\t1\n]')
  })

  it('keeps big integers, number text and key order exactly as written', () => {
    const input = '{"b":1,"2":2,"id":12345678901234567890,"f":1.50,"e":1E+3}'
    expect(minifyJson(formatJson(input))).toBe(input)
  })

  it('keeps string escapes as written', () => {
    expect(formatJson('{"a":"\\u4e2d\\n\\"x\\""}')).toBe('{\n  "a": "\\u4e2d\\n\\"x\\""\n}')
  })

  it('drops trailing commas', () => {
    expect(formatJson('{"a":[1,2,],}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
  })

  it('keeps trailing line comments on the same line', () => {
    const input = '{"a":1, // first\n"b":2}'
    expect(formatJson(input)).toBe('{\n  "a": 1, // first\n  "b": 2\n}')
  })

  it('keeps own-line comments on their own line with indentation', () => {
    const input = '// header\n{\n// note\n"a":1\n/* end */\n}'
    expect(formatJson(input)).toBe('// header\n{\n  // note\n  "a": 1\n  /* end */\n}')
  })

  it('keeps inline block comments inline', () => {
    expect(formatJson('{"a": /* c */ 1}')).toBe('{\n  "a": /* c */ 1\n}')
  })

  it('moves a trailing comma comment correctly when the comma is dropped', () => {
    expect(formatJson('[1, // c\n]')).toBe('[\n  1 // c\n]')
  })

  it('never swallows a comma or colon into a preceding line comment', () => {
    const arrayOutput = formatJson('[1 // c\n, 2]')
    expect(arrayOutput).toBe('[\n  1 // c\n  ,\n  2\n]')
    expect(minifyJson(arrayOutput)).toBe('[1,2]')
    const objectOutput = formatJson('{"a" // c\n : 1}')
    expect(minifyJson(objectOutput)).toBe('{"a":1}')
  })

  it('returns empty output for empty input', () => {
    expect(formatJson('   ')).toBe('')
  })

  it('throws a positioned error for invalid JSON', () => {
    expect(() => formatJson('{"a":1 "b":2}')).toThrow(/第 1 行第 8 列/)
  })
})

describe('minifyJson / escapeJson', () => {
  it('removes whitespace, comments and trailing commas', () => {
    expect(minifyJson('{\n  "a": 1, // c\n  /* x */ "b": [1, 2,],\n}')).toBe('{"a":1,"b":[1,2]}')
  })

  it('escapes the minified JSON without surrounding quotes', () => {
    expect(escapeJson('{ "a": "x\\"y", "b": [1] }')).toBe('{\\"a\\":\\"x\\\\\\"y\\",\\"b\\":[1]}')
  })

  it('round-trips through tryUnescapeJson', () => {
    const source = '{"url":"https://a.com/x.png","n":[1,2]}'
    expect(tryUnescapeJson(escapeJson(source))).toBe(source)
  })

  it('throws for invalid JSON', () => {
    expect(() => minifyJson('{')).toThrow(/缺少 '}'/)
  })
})

describe('stripComments', () => {
  it('removes comment-only lines entirely', () => {
    const result = stripComments('{\n  // remove me\n  "a": 1\n}')
    expect(result).toEqual({ text: '{\n  "a": 1\n}', count: 1 })
  })

  it('removes trailing comments together with the space before them', () => {
    expect(stripComments('{\n  "a": 1, // note\n  "b": 2\n}').text).toBe('{\n  "a": 1,\n  "b": 2\n}')
  })

  it('removes inline and multi-line block comments', () => {
    expect(stripComments('{"a": /* x */ 1}').text).toBe('{"a": 1}')
    expect(stripComments('{\n  /*\n   * doc\n   */\n  "a": 1\n}').text).toBe('{\n  "a": 1\n}')
  })

  it('removes a comment on the last line without leaving a blank line', () => {
    expect(stripComments('{"a":1}\n// end').text).toBe('{"a":1}')
  })

  it('handles CRLF line endings', () => {
    expect(stripComments('{\r\n  // x\r\n  "a": 1\r\n}').text).toBe('{\r\n  "a": 1\r\n}')
  })

  it('does not treat // inside strings as comments', () => {
    const input = '{"u": "https://a.com/x.png"}'
    expect(stripComments(input)).toEqual({ text: input, count: 0 })
  })

  it('keeps tokens separated when an inline comment is glued to them', () => {
    expect(stripComments('[1/**/2]').text).toBe('[1 2]')
    expect(stripComments('{"a":/*x*/1}').text).toBe('{"a": 1}')
  })

  it('works on invalid JSON', () => {
    expect(stripComments('{"a": 1, // x\n').text).toBe('{"a": 1,\n')
  })
})

describe('tryUnescapeJson', () => {
  it('unescapes escaped JSON without quotes', () => {
    expect(tryUnescapeJson('{\\"a\\":1}')).toBe('{"a":1}')
  })

  it('unescapes a quoted JSON string literal', () => {
    expect(tryUnescapeJson('"[1,{\\"b\\":2}]"')).toBe('[1,{"b":2}]')
  })

  it('unescapes multiple levels', () => {
    expect(tryUnescapeJson('{\\\\\\"a\\\\\\":1}')).toBe('{"a":1}')
  })

  it('returns null for text that is not escaped JSON', () => {
    expect(tryUnescapeJson('"hello"')).toBeNull()
    expect(tryUnescapeJson('not json')).toBeNull()
    expect(tryUnescapeJson('{\\"a\\":}')).toBeNull()
  })
})

describe('smartFormat', () => {
  it('formats valid JSON', () => {
    expect(smartFormat('{"a":1}')).toEqual({ ok: true, text: '{\n  "a": 1\n}', unescaped: false })
  })

  it('unescapes escaped JSON before formatting', () => {
    expect(smartFormat('{\\"a\\":1}', '    ')).toEqual({ ok: true, text: '{\n    "a": 1\n}', unescaped: true })
    expect(smartFormat('"{\\"a\\":1}"')).toMatchObject({ ok: true, unescaped: true })
  })

  it('keeps a plain JSON string as is', () => {
    expect(smartFormat('"hello"')).toEqual({ ok: true, text: '"hello"', unescaped: false })
  })

  it('returns the parse error for invalid input', () => {
    const result = smartFormat('{"a":}')
    expect(result.ok).toBe(false)
    expect(result.error.line).toBe(1)
  })
})

describe('minimalChange', () => {
  it('returns only the changed middle part', () => {
    expect(minimalChange('{"a":1,"b":2}', '{"a":1,"b":3}')).toEqual({ from: 11, to: 12, insert: '3' })
    expect(minimalChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' })
    expect(minimalChange('', 'x')).toEqual({ from: 0, to: 0, insert: 'x' })
    expect(minimalChange('aXa', 'aa')).toEqual({ from: 1, to: 2, insert: '' })
  })
})
