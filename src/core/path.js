const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/

/**
 * 把路径片段格式化为可直接粘贴到 JS 过滤框的形式，如 `[1].background["logo-img"]`
 * @param {(string|number)[]} segments
 */
export function formatPath(segments) {
  return segments
    .map((segment) => {
      if (typeof segment === 'number') return `[${segment}]`
      return IDENTIFIER_RE.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`
    })
    .join('')
}

/**
 * 字段的短标签：最后一个属性名 + 其后的数组下标，如 `images[2]`
 * @param {(string|number)[]} segments
 */
export function pathLabel(segments) {
  let start = segments.length
  while (start > 0 && typeof segments[start - 1] === 'number') start--
  const keyIndex = start - 1
  const indexes = segments.slice(start).map((index) => `[${index}]`).join('')
  if (keyIndex < 0) return indexes || '(根节点)'
  return `${segments[keyIndex]}${indexes}`
}

/** 穿过嵌套 JSON 字符串的路径分隔符（仅用于展示） */
export const NESTED_SEPARATOR = ' ▸ '

/**
 * 多层路径的展示文本，每一层是一个嵌套 JSON 字符串内部的路径，
 * 如 `[0].text ▸ .background.logoImg`
 * @param {(string|number)[][]} levels
 */
export function formatPathLevels(levels) {
  return levels.map(formatPath).join(NESTED_SEPARATOR)
}

/**
 * 可直接粘贴到 JS 过滤框的表达式：单层为 `.a[0]` 形式，
 * 多层为 `JSON.parse(this[0].text).background.logoImg`
 * @param {(string|number)[][]} levels
 */
export function pathExpression(levels) {
  if (levels.length === 1) return formatPath(levels[0])
  let expression = `this${formatPath(levels[0])}`
  for (const level of levels.slice(1)) expression = `JSON.parse(${expression})${formatPath(level)}`
  return expression
}
