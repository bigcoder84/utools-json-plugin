import { describe, expect, it } from 'vitest'
import { evaluateExpression, stringifyValue } from '../src/core/evaluate.js'

const data = '{"list": [{"id": 1, "name": "a"}, {"id": 2, "name": "b"}], "big": 12345678901234567890}'

describe('evaluateExpression', () => {
  it('appends member access to this', () => {
    expect(evaluateExpression(data, '.list[1].name')).toEqual({ ok: true, value: 'b' })
    expect(evaluateExpression('[[1,2],[3]]', '[0][1]')).toEqual({ ok: true, value: 2 })
    expect(evaluateExpression('{"a":null}', '?.a?.b')).toEqual({ ok: true, value: undefined })
  })

  it('supports array methods', () => {
    expect(evaluateExpression(data, '.list.map(x => x.id)').value).toEqual([1, 2])
  })

  it('supports full expressions with $ and this', () => {
    expect(evaluateExpression(data, 'Object.keys($)').value).toEqual(['list', 'big'])
    expect(evaluateExpression(data, 'this.list.length').value).toBe(2)
  })

  it('allows a trailing line comment', () => {
    expect(evaluateExpression(data, '.list.length // count').value).toBe(2)
  })

  it('re-parses so mutating expressions do not leak', () => {
    expect(evaluateExpression('[3,1,2]', '.sort()').value).toEqual([1, 2, 3])
    expect(evaluateExpression('[3,1,2]', '[0]').value).toBe(3)
  })

  it('keeps big integer precision', () => {
    expect(stringifyValue(evaluateExpression(data, '.big').value)).toBe('12345678901234567890')
  })

  it('explains BigInt mixing errors', () => {
    expect(evaluateExpression(data, '.big + 1').error).toMatch(/BigInt 表示/)
  })

  it('reports syntax, runtime and JSON errors', () => {
    expect(evaluateExpression(data, '.list.map(x =>').error).toMatch(/^表达式语法错误/)
    expect(evaluateExpression(data, '.nope.deep').error).toMatch(/^执行出错/)
    expect(evaluateExpression('{', '.a').error).toMatch(/^JSON 不合法/)
  })
})

describe('stringifyValue', () => {
  it('matches JSON.stringify for ordinary values', () => {
    const value = { a: [1, 'x', null, true, undefined, () => 1], b: { c: undefined, d: NaN }, e: new Date(0), f: [] }
    expect(stringifyValue(value, '  ')).toBe(JSON.stringify(value, null, 2))
    expect(stringifyValue(value, '')).toBe(JSON.stringify(value))
  })

  it('handles boxed primitives, sparse arrays and empty objects', () => {
    // eslint-disable-next-line no-new-wrappers
    expect(stringifyValue([new String('s'), new Number(1), new Boolean(false)], '')).toBe('["s",1,false]')
    expect(stringifyValue(new Array(2), '')).toBe('[null,null]')
    expect(stringifyValue({}, '  ')).toBe('{}')
  })

  it('serializes BigInt as raw digits', () => {
    expect(stringifyValue({ id: 2n ** 70n }, '')).toBe('{"id":1180591620717411303424}')
  })

  it('describes top-level non-JSON values', () => {
    expect(stringifyValue(undefined)).toBe('undefined')
    expect(stringifyValue(Symbol('s'))).toBe('Symbol(s)')
    expect(stringifyValue({ toJSON: () => undefined })).toBe('undefined')
  })

  it('throws on circular references', () => {
    const value = {}
    value.self = value
    expect(() => stringifyValue(value)).toThrow(/循环引用/)
  })
})
