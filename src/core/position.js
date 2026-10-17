/** 将字符偏移量转换为 1 起始的行列号 */
export function lineColumnAt(text, offset) {
  let line = 1
  let lineStart = 0
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: end - lineStart + 1 }
}

export class JsonSyntaxError extends Error {
  /**
   * @param {string} message 不含位置信息的错误描述
   * @param {{from: number, to: number, line: number, column: number}} location
   */
  constructor(message, location) {
    super(`第 ${location.line} 行第 ${location.column} 列：${message}`)
    this.name = 'JsonSyntaxError'
    this.reason = message
    this.from = location.from
    this.to = location.to
    this.line = location.line
    this.column = location.column
  }
}
