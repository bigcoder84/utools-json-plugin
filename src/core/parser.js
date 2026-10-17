import { TokenType, isCommentToken, tokenize } from './lexer.js'
import { JsonSyntaxError, lineColumnAt } from './position.js'

const MAX_DEPTH = 2000
const INTEGER_RE = /^-?\d+$/

/**
 * 宽松 JSON 解析：允许注释和尾随逗号，其余遵循标准 JSON。
 *
 * @param {string} text
 * @param {{buildValue?: boolean, trackPaths?: Set<number>, collectContainers?: boolean, tokens?: object[]}} [options]
 *   - buildValue: 是否构建 JS 值（超出安全范围的整数转为 BigInt，避免精度丢失）
 *   - trackPaths: 需要记录访问路径的 token 下标集合（只记录需要的，节省内存）
 *   - collectContainers: 是否记录每个对象/数组的位置与成员数量
 * @returns {{ok: true, empty: boolean, value: any, paths: Map<number, (string|number)[]>, containers: {from: number, to: number, kind: 'object'|'array', count: number}[], tokens: object[], hasComments: boolean, hasTrailingComma: boolean}
 *   | {ok: false, error: JsonSyntaxError, tokens: object[]}}
 */
export function parseJson(text, options = {}) {
  const tokens = options.tokens ?? tokenize(text)
  const parser = new Parser(text, tokens, options)
  try {
    return parser.parseDocument()
  } catch (error) {
    if (error instanceof JsonSyntaxError) return { ok: false, error, tokens }
    if (error instanceof RangeError) {
      return { ok: false, error: parser.errorAt('嵌套层级过深', parser.peekToken()), tokens }
    }
    throw error
  }
}

class Parser {
  constructor(text, tokens, { buildValue = false, trackPaths = null, collectContainers = false } = {}) {
    this.text = text
    this.tokens = tokens
    this.buildValue = buildValue
    this.containers = collectContainers ? [] : null
    this.trackPaths = trackPaths && trackPaths.size > 0 ? trackPaths : null
    this.significant = []
    this.hasComments = false
    for (let i = 0; i < tokens.length; i++) {
      if (isCommentToken(tokens[i])) this.hasComments = true
      else this.significant.push(i)
    }
    this.cursor = 0
    this.depth = 0
    this.pathStack = []
    this.paths = new Map()
    this.hasTrailingComma = false
  }

  parseDocument() {
    if (this.significant.length === 0) {
      return this.result(true, undefined)
    }
    const value = this.parseValue()
    if (this.cursor < this.significant.length) {
      throw this.errorAt('根节点之后存在多余内容', this.peekToken())
    }
    return this.result(false, value)
  }

  result(empty, value) {
    return {
      ok: true,
      empty,
      value,
      paths: this.paths,
      containers: this.containers ?? [],
      tokens: this.tokens,
      hasComments: this.hasComments,
      hasTrailingComma: this.hasTrailingComma,
    }
  }

  peekIndex() {
    return this.significant[this.cursor]
  }

  peekToken() {
    const index = this.peekIndex()
    return index === undefined ? undefined : this.tokens[index]
  }

  advance() {
    return this.significant[this.cursor++]
  }

  raw(token) {
    return this.text.slice(token.from, token.to)
  }

  errorAt(message, token) {
    const from = token ? token.from : this.text.length
    const to = token ? token.to : this.text.length
    const { line, column } = lineColumnAt(this.text, from)
    return new JsonSyntaxError(message, { from, to, line, column })
  }

  parseValue() {
    const token = this.peekToken()
    if (!token) throw this.errorAt('意外的结尾，缺少值', undefined)

    switch (token.type) {
      case TokenType.LBRACE:
        return this.parseContainer(true)
      case TokenType.LBRACKET:
        return this.parseContainer(false)
      case TokenType.STRING: {
        const index = this.advance()
        if (this.trackPaths?.has(index)) this.paths.set(index, this.currentPath())
        return this.buildValue ? JSON.parse(this.raw(token)) : undefined
      }
      case TokenType.NUMBER:
        this.advance()
        return this.buildValue ? toNumber(this.raw(token)) : undefined
      case TokenType.LITERAL:
        this.advance()
        return this.buildValue ? JSON.parse(this.raw(token)) : undefined
      case TokenType.INVALID:
        throw this.errorAt(token.message, token)
      default:
        throw this.errorAt(`意外的符号 '${this.raw(token)}'，此处应为值`, token)
    }
  }

  parseContainer(isObject) {
    const close = isObject ? TokenType.RBRACE : TokenType.RBRACKET
    const openToken = this.tokens[this.advance()]
    if (++this.depth > MAX_DEPTH) throw this.errorAt('嵌套层级过深', openToken)

    const container = this.buildValue ? (isObject ? {} : []) : undefined
    let count = 0

    while (true) {
      const token = this.peekToken()
      if (!token) throw this.errorAt(`缺少 '${close}'，与第 ${lineColumnAt(this.text, openToken.from).line} 行的 '${this.raw(openToken)}' 不匹配`, undefined)

      if (token.type === close) {
        if (count > 0) this.hasTrailingComma = true
        break
      }

      if (isObject) this.parseMember(container)
      else this.parseElement(container, count)
      count++

      const separator = this.peekToken()
      if (separator?.type === TokenType.COMMA) {
        this.advance()
        continue
      }
      if (separator?.type === close) break
      if (!separator) continue
      throw this.errorAt(`缺少逗号 ',' 或 '${close}'`, separator)
    }

    const closeToken = this.tokens[this.advance()]
    this.depth--
    this.containers?.push({ from: openToken.from, to: closeToken.to, kind: isObject ? 'object' : 'array', count })
    return container
  }

  parseMember(container) {
    const keyToken = this.peekToken()
    if (keyToken.type !== TokenType.STRING) {
      const reason = keyToken.type === TokenType.INVALID ? keyToken.message : `意外的符号 '${this.raw(keyToken)}'`
      throw this.errorAt(`${reason}，此处应为属性名（双引号字符串）`, keyToken)
    }
    const keyIndex = this.advance()

    const colon = this.peekToken()
    if (colon?.type !== TokenType.COLON) throw this.errorAt("属性名后缺少冒号 ':'", colon)
    this.advance()

    this.pathStack.push({ keyIndex })
    const value = this.parseValue()
    this.pathStack.pop()

    if (container) assignProperty(container, JSON.parse(this.raw(keyToken)), value)
  }

  parseElement(container, index) {
    this.pathStack.push(index)
    const value = this.parseValue()
    this.pathStack.pop()
    if (container) container.push(value)
  }

  currentPath() {
    return this.pathStack.map((segment) =>
      typeof segment === 'number' ? segment : JSON.parse(this.raw(this.tokens[segment.keyIndex])),
    )
  }
}

function toNumber(raw) {
  const value = Number(raw)
  if (INTEGER_RE.test(raw) && !Number.isSafeInteger(value)) return BigInt(raw)
  return value
}

function assignProperty(target, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  } else {
    target[key] = value
  }
}
