import { TokenType, isPropertyKey, tokenize } from './lexer.js'
import { parseJson } from './parser.js'

/**
 * 嵌套 JSON 字符串：值本身是字符串，但内容是一段 JSON，
 * 如 `"text": "{\"code\":\"alipay\"}"`。
 */

// 先用原文快速筛选（首尾是括号），避免对每个字符串都做解析
const OPEN_RE = /^"(?:\s|\\[nrt])*[{[]/
const CLOSE_RE = /[}\]](?:\s|\\[nrt])*"$/
const MAX_EXPAND_DEPTH = 5

/**
 * @param {string} raw 字符串 token 原文（含引号）
 * @returns {{text: string, kind: 'object'|'array', count: number} | null} 非空对象/数组才返回
 */
export function detectNestedJson(raw) {
  if (raw.length < 4 || !OPEN_RE.test(raw) || !CLOSE_RE.test(raw)) return null
  let text
  try {
    text = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = parseJson(text, { collectContainers: true })
  if (!parsed.ok || parsed.empty) return null
  // 容器按闭合顺序记录，最后一个就是根节点
  const root = parsed.containers[parsed.containers.length - 1]
  if (!root || root.count === 0) return null
  return { text, kind: root.kind, count: root.count }
}

/**
 * 把所有嵌套 JSON 字符串递归替换为真实结构（基于 token 替换，保留数字原文与键顺序）。
 * 结果仍需格式化后展示。
 *
 * @param {string} text
 * @returns {{text: string, count: number}} count 为展开的嵌套字符串总数（含多层）
 */
export function expandNestedJson(text, depth = MAX_EXPAND_DEPTH) {
  const tokens = tokenize(text)
  const parts = []
  let cursor = 0
  let count = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== TokenType.STRING || isPropertyKey(tokens, i)) continue
    const nested = detectNestedJson(text.slice(token.from, token.to))
    if (!nested) continue
    const inner = depth > 1 ? expandNestedJson(nested.text, depth - 1) : { text: nested.text, count: 0 }
    parts.push(text.slice(cursor, token.from), inner.text)
    cursor = token.to
    count += 1 + inner.count
  }

  if (count === 0) return { text, count }
  parts.push(text.slice(cursor))
  return { text: parts.join(''), count }
}
