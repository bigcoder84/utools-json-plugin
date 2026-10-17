import { describe, expect, it } from 'vitest'
import { TokenType, tokenize } from '../src/core/lexer.js'
import { parseJson } from '../src/core/parser.js'
import { lineColumnAt } from '../src/core/position.js'

describe('tokenize', () => {
  it('produces tokens with offsets', () => {
    expect(tokenize('{"a": [1, true]}').map((t) => t.type)).toEqual([
      TokenType.LBRACE,
      TokenType.STRING,
      TokenType.COLON,
      TokenType.LBRACKET,
      TokenType.NUMBER,
      TokenType.COMMA,
      TokenType.LITERAL,
      TokenType.RBRACKET,
      TokenType.RBRACE,
    ])
  })

  it('recognizes comments', () => {
    const tokens = tokenize('// a\r\n/* b */1')
    expect(tokens.map((t) => t.type)).toEqual([TokenType.LINE_COMMENT, TokenType.BLOCK_COMMENT, TokenType.NUMBER])
    expect(tokens[0]).toMatchObject({ from: 0, to: 4 })
  })

  it.each([
    ['"abc', '字符串未闭合'],
    ['"a\nb"', '字符串未闭合'],
    ['"a\\x"', '无效的转义字符'],
    ['"\\u12"', '无效的 Unicode 转义'],
    ['"\u0001"', '控制字符'],
    ['/* x', '块注释未闭合'],
    ['/x', "意外的字符 '/'"],
    ['undefined', "无法识别的内容 'undefined'"],
    ['01', "无法识别的内容 '01'"],
  ])('marks %j as invalid', (input, message) => {
    const invalid = tokenize(input).find((t) => t.type === TokenType.INVALID)
    expect(invalid.message).toContain(message)
  })
})

describe('parseJson', () => {
  it('builds values with BigInt for unsafe integers', () => {
    const result = parseJson('{"id": 12345678901234567890, "n": -1.5e2, "ok": true, "x": null}', { buildValue: true })
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ id: 12345678901234567890n, n: -150, ok: true, x: null })
  })

  it('accepts comments and trailing commas and reports them', () => {
    const result = parseJson('{\n// c\n"a": [1,],\n}')
    expect(result).toMatchObject({ ok: true, hasComments: true, hasTrailingComma: true })
  })

  it('treats empty input as an empty document', () => {
    expect(parseJson('  // only comment\n')).toMatchObject({ ok: true, empty: true })
  })

  it('keeps __proto__ as an own property', () => {
    const { value } = parseJson('{"__proto__": {"polluted": 1}}', { buildValue: true })
    expect(Object.keys(value)).toEqual(['__proto__'])
    expect({}.polluted).toBeUndefined()
  })

  it('records paths only for requested string tokens', () => {
    const text = '{"list": [{"img": "a"}, "b"], "other": "c"}'
    const tokens = tokenize(text)
    const target = tokens.findIndex((t) => text.slice(t.from, t.to) === '"b"')
    const result = parseJson(text, { tokens, trackPaths: new Set([target]) })
    expect([...result.paths.entries()]).toEqual([[target, ['list', 1]]])
  })

  it('collects container ranges and member counts when requested', () => {
    const text = '{"list": [1, [2, 3], {}], "obj": {"a": 1,},}'
    const { containers } = parseJson(text, { collectContainers: true })
    const summary = containers
      .map((c) => [text.slice(c.from, c.to), c.kind, c.count])
      .sort((a, b) => text.indexOf(a[0]) - text.indexOf(b[0]))
    expect(summary).toEqual([
      [text, 'object', 2],
      ['[1, [2, 3], {}]', 'array', 3],
      ['[2, 3]', 'array', 2],
      ['{}', 'object', 0],
      ['{"a": 1,}', 'object', 1],
    ])
    expect(parseJson(text).containers).toEqual([])
  })

  it.each([
    ['{"a":1 "b":2}', "缺少逗号 ',' 或 '}'", 1, 8],
    ['{"a" 1}', "缺少冒号 ':'", 1, 6],
    ['{a: 1}', '此处应为属性名', 1, 2],
    ['[1,,2]', "意外的符号 ','", 1, 4],
    ['{"a": [1, 2}', "缺少逗号 ',' 或 ']'", 1, 12],
    ['{"a":\n1', "缺少 '}'", 2, 2],
    ['{} []', '根节点之后存在多余内容', 1, 4],
    ['{"a": }', "意外的符号 '}'", 1, 7],
    ['{"a": "x', '字符串未闭合', 1, 7],
    ['[', "缺少 ']'，与第 1 行的 '[' 不匹配", 1, 2],
    ['{"a":', '意外的结尾', 1, 6],
  ])('reports %j: %s at %i:%i', (input, message, line, column) => {
    const result = parseJson(input)
    expect(result.ok).toBe(false)
    expect(result.error.reason).toContain(message)
    expect([result.error.line, result.error.column]).toEqual([line, column])
  })

  it('rejects excessively deep nesting without crashing', () => {
    const result = parseJson('['.repeat(3000) + ']'.repeat(3000))
    expect(result.ok).toBe(false)
    expect(result.error.reason).toBe('嵌套层级过深')
  })
})

describe('lineColumnAt', () => {
  it('converts offsets to 1-based line/column', () => {
    expect(lineColumnAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
    expect(lineColumnAt('ab', 99)).toEqual({ line: 1, column: 3 })
  })
})
