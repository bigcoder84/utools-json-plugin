/**
 * 宽松 JSON（JSONC）词法分析器。
 * 支持标准 JSON + 行注释、块注释；遇到非法内容产出 INVALID token 而不是抛错，
 * 这样即使 JSON 不合法，去注释、链接/图片扫描等功能仍可工作。
 */

export const TokenType = Object.freeze({
  LBRACE: '{',
  RBRACE: '}',
  LBRACKET: '[',
  RBRACKET: ']',
  COLON: ':',
  COMMA: ',',
  STRING: 'string',
  NUMBER: 'number',
  LITERAL: 'literal',
  LINE_COMMENT: 'lineComment',
  BLOCK_COMMENT: 'blockComment',
  INVALID: 'invalid',
})

const PUNCTUATION = new Map([
  [0x7b, TokenType.LBRACE],
  [0x7d, TokenType.RBRACE],
  [0x5b, TokenType.LBRACKET],
  [0x5d, TokenType.RBRACKET],
  [0x3a, TokenType.COLON],
  [0x2c, TokenType.COMMA],
])

const LITERALS = ['true', 'false', 'null']
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const WORD_RE = /[^\s{}[\]:,"/]+/y
const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't'])
const HEX_RE = /^[0-9a-fA-F]{4}$/

const CH_SPACE = 0x20
const CH_TAB = 0x09
const CH_LF = 0x0a
const CH_CR = 0x0d
const CH_QUOTE = 0x22
const CH_BACKSLASH = 0x5c
const CH_SLASH = 0x2f
const CH_STAR = 0x2a

export function isCommentToken(token) {
  return token.type === TokenType.LINE_COMMENT || token.type === TokenType.BLOCK_COMMENT
}

/**
 * @param {string} text
 * @returns {{type: string, from: number, to: number, message?: string}[]}
 */
export function tokenize(text) {
  const tokens = []
  const length = text.length
  let pos = 0

  while (pos < length) {
    const code = text.charCodeAt(pos)

    if (code === CH_SPACE || code === CH_TAB || code === CH_LF || code === CH_CR || code === 0xfeff) {
      pos++
      continue
    }

    const punct = PUNCTUATION.get(code)
    if (punct) {
      tokens.push({ type: punct, from: pos, to: pos + 1 })
      pos++
      continue
    }

    if (code === CH_QUOTE) {
      const token = readString(text, pos)
      tokens.push(token)
      pos = token.to
      continue
    }

    if (code === CH_SLASH) {
      const token = readComment(text, pos)
      tokens.push(token)
      pos = token.to
      continue
    }

    const token = readWord(text, pos)
    tokens.push(token)
    pos = token.to
  }

  return tokens
}

function readString(text, start) {
  const length = text.length
  let pos = start + 1

  while (pos < length) {
    const code = text.charCodeAt(pos)
    if (code === CH_QUOTE) {
      return { type: TokenType.STRING, from: start, to: pos + 1 }
    }
    if (code === CH_LF || code === CH_CR) {
      return { type: TokenType.INVALID, from: start, to: pos, message: '字符串未闭合' }
    }
    if (code < 0x20) {
      return { type: TokenType.INVALID, from: start, to: pos + 1, message: '字符串中包含未转义的控制字符' }
    }
    if (code === CH_BACKSLASH) {
      const escapeChar = text[pos + 1]
      if (escapeChar === 'u') {
        if (!HEX_RE.test(text.slice(pos + 2, pos + 6))) {
          return { type: TokenType.INVALID, from: start, to: Math.min(pos + 6, length), message: '无效的 Unicode 转义' }
        }
        pos += 6
        continue
      }
      if (!VALID_ESCAPES.has(escapeChar)) {
        return { type: TokenType.INVALID, from: start, to: Math.min(pos + 2, length), message: `无效的转义字符 \\${escapeChar ?? ''}` }
      }
      pos += 2
      continue
    }
    pos++
  }

  return { type: TokenType.INVALID, from: start, to: length, message: '字符串未闭合' }
}

function readComment(text, start) {
  const next = text.charCodeAt(start + 1)

  if (next === CH_SLASH) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    if (text.charCodeAt(end - 1) === CH_CR) end--
    return { type: TokenType.LINE_COMMENT, from: start, to: end }
  }

  if (next === CH_STAR) {
    const end = text.indexOf('*/', start + 2)
    if (end === -1) {
      return { type: TokenType.INVALID, from: start, to: text.length, message: '块注释未闭合' }
    }
    return { type: TokenType.BLOCK_COMMENT, from: start, to: end + 2 }
  }

  return { type: TokenType.INVALID, from: start, to: start + 1, message: "意外的字符 '/'" }
}

function readWord(text, start) {
  NUMBER_RE.lastIndex = start
  const numberMatch = NUMBER_RE.exec(text)
  WORD_RE.lastIndex = start
  const wordMatch = WORD_RE.exec(text)
  const word = wordMatch ? wordMatch[0] : text[start]

  if (numberMatch && numberMatch[0].length === word.length) {
    return { type: TokenType.NUMBER, from: start, to: start + word.length }
  }
  if (LITERALS.includes(word)) {
    return { type: TokenType.LITERAL, from: start, to: start + word.length }
  }
  return { type: TokenType.INVALID, from: start, to: start + word.length, message: `无法识别的内容 '${truncate(word, 20)}'` }
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 字符串 token 后面紧跟冒号（忽略注释）即为属性名 */
export function isPropertyKey(tokens, index) {
  for (let i = index + 1; i < tokens.length; i++) {
    if (!isCommentToken(tokens[i])) return tokens[i].type === TokenType.COLON
  }
  return false
}
