import { describe, expect, it } from 'vitest'
import { analyzeDocument } from '../src/core/analysis.js'
import { evaluateExpression } from '../src/core/evaluate.js'
import { formatJson } from '../src/core/format.js'
import { detectNestedJson, expandNestedJson } from '../src/core/nested.js'
import { formatPathLevels, pathExpression } from '../src/core/path.js'

const inner = {
  code: 'alipay',
  background: {
    titleImg: 'https://dimg04.c-ctrip.com/images/2335g12000qg5dpj8E54C.png',
    logoImg: 'https://dimg04.c-ctrip.com/images/2336112000qzo4aan575A.png',
  },
}
const sample = JSON.stringify(
  [{ code: 'alipay', icon: 'https://dimg04.c-ctrip.com/images/2335g12000qg5dpj8E54C.png', text: JSON.stringify(inner) }],
  null,
  4,
)

describe('detectNestedJson', () => {
  it('detects strings whose content is a non-empty object or array', () => {
    expect(detectNestedJson(JSON.stringify(JSON.stringify(inner)))).toMatchObject({ kind: 'object', count: 2 })
    expect(detectNestedJson(JSON.stringify('[1, 2, 3]'))).toMatchObject({ kind: 'array', count: 3 })
    expect(detectNestedJson(JSON.stringify('\n  {"a": 1}\n'))).toMatchObject({ kind: 'object', count: 1 })
  })

  it.each(['"plain text"', '"[备注]"', '"{}"', '"[]"', '"{not json}"', '"{"'])('ignores %s', (raw) => {
    expect(detectNestedJson(raw)).toBeNull()
  })
})

describe('expandNestedJson', () => {
  it('replaces nested JSON strings with real structures, recursively', () => {
    const doubly = JSON.stringify({ a: JSON.stringify({ b: JSON.stringify([1, 2]) }), keep: '{x}' })
    const { text, count } = expandNestedJson(doubly)
    expect(count).toBe(2)
    expect(JSON.parse(text)).toEqual({ a: { b: [1, 2] }, keep: '{x}' })
  })

  it('keeps big numbers and key order inside nested strings', () => {
    const doc = JSON.stringify({ s: '{"b":1,"2":2,"id":12345678901234567890}' })
    expect(expandNestedJson(doc).text).toBe('{"s":{"b":1,"2":2,"id":12345678901234567890}}')
  })

  it('does not touch property names that look like JSON', () => {
    const doc = '{"[1]": 1}'
    expect(expandNestedJson(doc)).toEqual({ text: doc, count: 0 })
  })

  it('returns the original text when nothing is nested', () => {
    expect(expandNestedJson('{"a":"b"}')).toEqual({ text: '{"a":"b"}', count: 0 })
  })

  it('produces output that formats as valid JSON', () => {
    expect(() => formatJson(expandNestedJson(sample).text)).not.toThrow()
  })
})

describe('analyzeDocument with nested strings', () => {
  it('lists nested JSON strings with their field path and size', () => {
    const { nested } = analyzeDocument(sample)
    expect(nested).toHaveLength(1)
    expect(nested[0]).toMatchObject({ kind: 'object', count: 2, pathText: '[0].text', label: 'text' })
    expect(sample.slice(nested[0].from, nested[0].to)).toBe(JSON.stringify(JSON.stringify(inner)))
    expect(nested[0].line).toBe(sample.slice(0, nested[0].from).split('\n').length)
  })

  it('resolves image paths inside nested strings', () => {
    const { images } = analyzeDocument(sample)
    const title = images.find((group) => group.url.endsWith('8E54C.png'))
    expect(title.occurrences.map((o) => o.pathText)).toEqual(['[0].icon', '[0].text ▸ .background.titleImg'])
    expect(title.occurrences[1].label).toBe('titleImg')
    const logo = images.find((group) => group.url.endsWith('575A.png'))
    expect(logo.occurrences[0].pathText).toBe('[0].text ▸ .background.logoImg')
  })

  it('produces a path expression that works in the JS filter', () => {
    const { images } = analyzeDocument(sample)
    const logo = images.find((group) => group.url.endsWith('575A.png')).occurrences[0]
    expect(logo.pathExpression).toBe('JSON.parse(this[0].text).background.logoImg')
    expect(evaluateExpression(sample, logo.pathExpression).value).toBe(inner.background.logoImg)
  })

  it('resolves paths through several nested levels', () => {
    const deep = JSON.stringify({ outer: JSON.stringify({ list: [JSON.stringify({ img: 'https://a.com/x.png' })] }) })
    const occurrence = analyzeDocument(deep).images[0].occurrences[0]
    expect(occurrence.pathText).toBe('.outer ▸ .list[0] ▸ .img')
    expect(evaluateExpression(deep, occurrence.pathExpression).value).toBe('https://a.com/x.png')
  })

  it('locates every occurrence of an image inside one nested string', () => {
    const doc = JSON.stringify({ s: JSON.stringify({ a: 'https://a.com/1.png', b: 'https://a.com/1.png' }) })
    const [group] = analyzeDocument(doc).images
    expect(group.occurrences.map((o) => o.pathText)).toEqual(['.s ▸ .a', '.s ▸ .b'])
  })

  it('falls back to line labels when the outer JSON is invalid', () => {
    const doc = `{\n "s": ${JSON.stringify(JSON.stringify(inner))},\n "x": }`
    const { nested, images } = analyzeDocument(doc)
    expect(nested[0]).toMatchObject({ path: null, pathText: null, label: '第 2 行' })
    expect(images[0].occurrences[0]).toMatchObject({ pathText: null, label: '第 2 行' })
  })
})

describe('path level helpers', () => {
  it('formats single and multi level paths', () => {
    expect(formatPathLevels([[0, 'text']])).toBe('[0].text')
    expect(pathExpression([[0, 'text']])).toBe('[0].text')
    expect(formatPathLevels([['a'], ['b-c', 1]])).toBe('.a ▸ ["b-c"][1]')
    expect(pathExpression([['a'], ['b-c', 1]])).toBe('JSON.parse(this.a)["b-c"][1]')
  })
})
