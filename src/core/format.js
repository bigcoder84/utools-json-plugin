import { TokenType, isCommentToken, tokenize } from './lexer.js'
import { parseJson } from './parser.js'

const OPENERS = new Set([TokenType.LBRACE, TokenType.LBRACKET])
const CLOSERS = new Set([TokenType.RBRACE, TokenType.RBRACKET])
const MATCHING_CLOSE = { [TokenType.LBRACE]: TokenType.RBRACE, [TokenType.LBRACKET]: TokenType.RBRACKET }
const MAX_UNESCAPE_DEPTH = 3

/** 校验文本，非法时抛出 JsonSyntaxError，合法时返回 token 列表 */
function validTokens(text) {
  const result = parseJson(text)
  if (!result.ok) throw result.error
  return result.tokens
}

function nextSignificant(tokens, start) {
  for (let i = start; i < tokens.length; i++) {
    if (!isCommentToken(tokens[i])) return tokens[i]
  }
  return undefined
}

function hasNewlineBetween(text, from, to) {
  const index = text.indexOf('\n', from)
  return index !== -1 && index < to
}

/**
 * 基于 token 流的格式化：保留数字/字符串原文（不丢失大数精度、不重排键顺序），
 * 保留注释，去掉尾随逗号。
 *
 * @param {string} text
 * @param {string} [indent='  ']
 */
export function formatJson(text, indent = '  ') {
  const tokens = validTokens(text)
  const out = []
  let depth = 0
  let pendingNewline = false
  let pendingSpace = false
  let previous = null

  const flush = () => {
    if (pendingNewline && out.length > 0) {
      out.push('\n', indent.repeat(depth))
    } else if (pendingSpace) {
      out.push(' ')
    }
    pendingNewline = false
    pendingSpace = false
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const raw = text.slice(token.from, token.to)

    if (isCommentToken(token)) {
      const trailing = previous !== null && !hasNewlineBetween(text, previous.to, token.from)
      if (trailing) {
        out.push(' ', raw)
      } else {
        pendingNewline = true
        flush()
        out.push(raw)
      }
      if (token.type === TokenType.LINE_COMMENT || !trailing) {
        pendingNewline = true
      } else {
        pendingSpace = !pendingNewline
      }
      previous = token
      continue
    }

    if (OPENERS.has(token.type)) {
      flush()
      const next = tokens[i + 1]
      if (next && next.type === MATCHING_CLOSE[token.type]) {
        out.push(raw, text.slice(next.from, next.to))
        previous = next
        i++
        continue
      }
      out.push(raw)
      depth++
      pendingNewline = true
    } else if (CLOSERS.has(token.type)) {
      depth--
      pendingNewline = true
      pendingSpace = false
      flush()
      out.push(raw)
    } else if (token.type === TokenType.COMMA) {
      const next = nextSignificant(tokens, i + 1)
      if (next && CLOSERS.has(next.type)) continue
      pendingSpace = false
      // 行注释之后必须先换行，否则逗号会被并入注释
      if (previous?.type === TokenType.LINE_COMMENT) flush()
      out.push(raw)
      pendingNewline = true
    } else if (token.type === TokenType.COLON) {
      if (previous?.type === TokenType.LINE_COMMENT) flush()
      out.push(raw)
      pendingSpace = true
    } else {
      flush()
      out.push(raw)
    }
    previous = token
  }

  return out.join('')
}

/** 压缩：去除空白、注释与尾随逗号 */
export function minifyJson(text) {
  const tokens = validTokens(text)
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (isCommentToken(token)) continue
    if (token.type === TokenType.COMMA) {
      const next = nextSignificant(tokens, i + 1)
      if (next && CLOSERS.has(next.type)) continue
    }
    out.push(text.slice(token.from, token.to))
  }
  return out.join('')
}

/** 压缩并转义，结果可直接粘贴为字符串字面量的内容（不含首尾引号） */
export function escapeJson(text) {
  return JSON.stringify(minifyJson(text)).slice(1, -1)
}

function isHorizontalSpace(char) {
  return char === ' ' || char === '\t'
}

/**
 * 计算删除一个注释时应移除的文本范围 [from, to, 替换文本]，尽量不留下空行和多余空格。
 * 行内注释两侧都紧贴内容时（如数字 1 和 2 之间夹着一个块注释）替换为一个空格，
 * 避免拼接成 12 这类改变含义的结果。
 */
function commentRemovalRange(text, token) {
  let left = token.from
  while (left > 0 && isHorizontalSpace(text[left - 1])) left--
  let right = token.to
  while (right < text.length && isHorizontalSpace(text[right])) right++

  const atLineStart = left === 0 || text[left - 1] === '\n'
  const crlf = text[right] === '\r' && text[right + 1] === '\n'
  const atLineEnd = right === text.length || text[right] === '\n' || crlf

  if (atLineStart && atLineEnd) {
    const newlineLength = crlf ? 2 : text[right] === '\n' ? 1 : 0
    if (newlineLength === 0 && left > 0) {
      // 最后一行：连同前面的换行一起删除
      const previousBreak = text[left - 2] === '\r' ? left - 2 : left - 1
      return [previousBreak, right, '']
    }
    return [left, right + newlineLength, '']
  }
  if (atLineEnd) return [left, right, '']
  if (atLineStart) return [token.from, right, '']
  const glued = token.from > 0 && !/\s/.test(text[token.from - 1])
  return [token.from, right, glued ? ' ' : '']
}

/**
 * 去除注释，保留其余排版。即使 JSON 不合法也可以执行。
 * @returns {{text: string, count: number}}
 */
export function stripComments(text) {
  const comments = tokenize(text).filter(isCommentToken)
  if (comments.length === 0) return { text, count: 0 }

  const parts = []
  let cursor = 0
  for (const comment of comments) {
    const [from, to, replacement] = commentRemovalRange(text, comment)
    const start = Math.max(from, cursor)
    parts.push(text.slice(cursor, start), replacement)
    cursor = Math.max(cursor, to)
  }
  parts.push(text.slice(cursor))
  return { text: parts.join(''), count: comments.length }
}

/**
 * 识别被转义过的 JSON（如 `{\"a\":1}` 或 `"{\"a\":1}"`），返回去转义后的文本。
 * 无法识别时返回 null。
 */
export function tryUnescapeJson(text) {
  let current = text.trim()
  for (let depth = 0; depth < MAX_UNESCAPE_DEPTH; depth++) {
    const next = unescapeOnce(current)
    if (next === null) break
    current = next.trim()
    if (isStructured(current) && parseJson(current).ok) return current
  }
  return null
}

function isStructured(text) {
  return text.startsWith('{') || text.startsWith('[')
}

function unescapeOnce(text) {
  const candidates = []
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) candidates.push(text)
  if (isStructured(text) && text.includes('\\')) candidates.push(`"${text}"`)

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (typeof value === 'string' && value !== text) return value
    } catch {
      // 不是合法的字符串字面量，尝试下一个候选
    }
  }
  return null
}

/**
 * 智能格式化：合法 JSON 直接格式化；转义过的 JSON（或整体是一个 JSON 字符串字面量）先去转义再格式化。
 * @returns {{ok: true, text: string, unescaped: boolean} | {ok: false, error: import('./position.js').JsonSyntaxError}}
 */
export function smartFormat(text, indent = '  ') {
  const parsed = parseJson(text)
  if (parsed.ok) {
    if (!parsed.empty && text.trimStart().startsWith('"')) {
      const unescaped = tryUnescapeJson(text)
      if (unescaped !== null) return { ok: true, text: formatJson(unescaped, indent), unescaped: true }
    }
    return { ok: true, text: formatJson(text, indent), unescaped: false }
  }
  const unescaped = tryUnescapeJson(text)
  if (unescaped !== null) return { ok: true, text: formatJson(unescaped, indent), unescaped: true }
  return { ok: false, error: parsed.error }
}

/**
 * 计算把 oldText 替换为 newText 的最小变更（公共前后缀之外的部分），
 * 让光标、折叠状态在未变化的区域保持不动。
 */
export function minimalChange(oldText, newText) {
  const max = Math.min(oldText.length, newText.length)
  let start = 0
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++
  let oldEnd = oldText.length
  let newEnd = newText.length
  while (oldEnd > start && newEnd > start && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
    oldEnd--
    newEnd--
  }
  return { from: start, to: oldEnd, insert: newText.slice(start, newEnd) }
}
