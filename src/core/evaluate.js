import { parseJson } from './parser.js'

const MEMBER_ACCESS_RE = /^\s*(?:\.|\[|\?\.)/

/**
 * 以 JSON 数据为 this 执行 JS 表达式。
 * - 以 `.`、`[`、`?.` 开头时拼接在 this 之后，如 `.list.map(x => x.id)`
 * - 否则作为完整表达式执行，可用 `this` 或 `$` 引用数据，如 `Object.keys($)`
 *
 * 每次重新解析原文，避免表达式（如 sort/reverse）修改数据后影响下一次执行。
 *
 * @param {string} text JSON 原文
 * @param {string} expression
 * @returns {{ok: true, value: any} | {ok: false, error: string}}
 */
export function evaluateExpression(text, expression) {
  const parsed = parseJson(text, { buildValue: true })
  if (!parsed.ok) return { ok: false, error: `JSON 不合法：${parsed.error.message}` }

  const body = MEMBER_ACCESS_RE.test(expression) ? `this${expression}` : expression
  let fn
  try {
    fn = new Function('$', `"use strict";\nreturn (${body}\n);`)
  } catch (error) {
    return { ok: false, error: `表达式语法错误：${error.message}` }
  }

  try {
    return { ok: true, value: fn.call(parsed.value, parsed.value) }
  } catch (error) {
    const message = error?.message ?? String(error)
    const hint = /BigInt/.test(message) ? '（超出安全范围的整数以 BigInt 表示，可用 Number(x) 或 String(x) 转换）' : ''
    return { ok: false, error: `执行出错：${message}${hint}` }
  }
}

/**
 * 与 JSON.stringify 语义一致的序列化，额外支持 BigInt（按原始数字输出，不加引号），
 * 顶层 undefined / 函数 / Symbol 返回可读文本。
 *
 * @param {any} value
 * @param {string} [indent='  ']
 */
export function stringifyValue(value, indent = '  ') {
  if (value === undefined) return 'undefined'
  if (typeof value === 'function' || typeof value === 'symbol') return String(value)
  const result = serialize(value, '', indent, '', new Set())
  return result === undefined ? 'undefined' : result
}

function serialize(input, key, indent, currentIndent, seen) {
  let value = input
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') {
    value = value.toJSON(key)
  }

  switch (typeof value) {
    case 'bigint':
      return value.toString()
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null'
    case 'boolean':
      return String(value)
    case 'string':
      return JSON.stringify(value)
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
    default:
      break
  }

  if (value === null) return 'null'
  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    return serialize(value.valueOf(), key, indent, currentIndent, seen)
  }
  if (seen.has(value)) throw new TypeError('存在循环引用，无法序列化')

  seen.add(value)
  const innerIndent = currentIndent + indent
  const separator = indent ? `,\n${innerIndent}` : ','
  const open = indent ? `\n${innerIndent}` : ''
  const close = indent ? `\n${currentIndent}` : ''
  let output

  if (Array.isArray(value)) {
    const items = Array.from(value, (item, index) => serialize(item, String(index), indent, innerIndent, seen) ?? 'null')
    output = items.length === 0 ? '[]' : `[${open}${items.join(separator)}${close}]`
  } else {
    const entries = []
    for (const name of Object.keys(value)) {
      const item = serialize(value[name], name, indent, innerIndent, seen)
      if (item !== undefined) entries.push(`${JSON.stringify(name)}:${indent ? ' ' : ''}${item}`)
    }
    output = entries.length === 0 ? '{}' : `{${open}${entries.join(separator)}${close}}`
  }

  seen.delete(value)
  return output
}
