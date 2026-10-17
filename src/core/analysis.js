import { TokenType, isPropertyKey, tokenize } from './lexer.js'
import { detectNestedJson } from './nested.js'
import { parseJson } from './parser.js'
import { formatPathLevels, pathExpression, pathLabel } from './path.js'
import { findUrls } from './urls.js'

/** 嵌套 JSON 字符串内部再分析的最大层数 */
const MAX_NESTED_DEPTH = 4

/**
 * @typedef {(string|number)[]} PathSegments
 * @typedef {{
 *   from: number, to: number, line: number,
 *   path: PathSegments | null,      // 所在字符串字段在当前文档中的路径
 *   levels: PathSegments[] | null,  // 穿透嵌套字符串的完整路径，每层一段
 *   pathText: string | null,        // 展示用，如 `[0].text ▸ .background.logoImg`
 *   pathExpression: string | null,  // 可粘贴到过滤框的表达式
 *   label: string,
 * }} ImageOccurrence
 * @typedef {{url: string, occurrences: ImageOccurrence[]}} ImageGroup
 * @typedef {{from: number, to: number, line: number, kind: 'object'|'array', count: number, length: number,
 *   path: PathSegments | null, pathText: string | null, label: string}} NestedString
 */

/**
 * 一次分词 + 一次解析，得到：语法校验结果、图片（按链接分组）、嵌套 JSON 字符串。
 * JSON 不合法时仍能提取图片和嵌套字符串，只是没有字段路径（以行号代替）。
 *
 * @param {string} text
 * @param {{collectContainers?: boolean, depth?: number}} [options]
 */
export function analyzeDocument(text, { collectContainers = false, depth = 0 } = {}) {
  const tokens = tokenize(text)
  const { imageHits, nestedHits, trackPaths } = scanStrings(text, tokens, depth)
  const parse = parseJson(text, { tokens, trackPaths, collectContainers })
  const paths = parse.ok ? parse.paths : new Map()
  const innerLevels = createInnerLevelResolver(nestedHits, depth)

  const imageLines = lineNumbersAt(text, imageHits.map((hit) => hit.from))
  const occurrences = imageHits.map((hit, index) => {
    const path = paths.get(hit.tokenIndex) ?? null
    const levels = path ? [path, ...(innerLevels(hit) ?? [])] : null
    return { url: hit.url, ...describeLocation(hit, imageLines[index], path, levels) }
  })

  const nestedLines = lineNumbersAt(text, nestedHits.map((hit) => hit.from))
  const nested = nestedHits.map((hit, index) => {
    const path = paths.get(hit.tokenIndex) ?? null
    const { pathText, label } = describeLocation(hit, nestedLines[index], path, path ? [path] : null)
    return {
      from: hit.from,
      to: hit.to,
      line: nestedLines[index],
      kind: hit.nested.kind,
      count: hit.nested.count,
      length: hit.nested.text.length,
      path,
      pathText,
      label,
    }
  })

  const images = groupByUrl(occurrences)
  return { parse, images, total: occurrences.length, pathsAvailable: parse.ok, nested, occurrences }
}

function scanStrings(text, tokens, depth) {
  const imageHits = []
  const nestedHits = []
  const trackPaths = new Set()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== TokenType.STRING || isPropertyKey(tokens, i)) continue
    const raw = text.slice(token.from, token.to)
    const urls = findUrls(raw, token.from).filter((item) => item.isImage)
    const nested = depth < MAX_NESTED_DEPTH ? detectNestedJson(raw) : null
    if (urls.length === 0 && !nested) continue

    trackPaths.add(i)
    urls.forEach((item, order) => imageHits.push({ tokenIndex: i, order, ...item }))
    if (nested) nestedHits.push({ tokenIndex: i, from: token.from, to: token.to, nested })
  }
  return { imageHits, nestedHits, trackPaths }
}

/**
 * 图片位于嵌套 JSON 字符串内部时，解析字符串内容，找出该图片在内部的路径。
 * 原文与解码后的内容中链接出现顺序一致，按顺序 + 链接相同来对应。
 */
function createInnerLevelResolver(nestedHits, depth) {
  const byToken = new Map(nestedHits.map((hit) => [hit.tokenIndex, hit]))
  const cache = new Map()

  return (imageHit) => {
    const nestedHit = byToken.get(imageHit.tokenIndex)
    if (!nestedHit) return null
    if (!cache.has(imageHit.tokenIndex)) {
      const inner = analyzeDocument(nestedHit.nested.text, { depth: depth + 1 })
      cache.set(imageHit.tokenIndex, alignByOrder(inner.occurrences))
    }
    return cache.get(imageHit.tokenIndex)(imageHit)
  }
}

function alignByOrder(innerOccurrences) {
  const assigned = new Map()
  let pointer = 0
  return (imageHit) => {
    if (assigned.has(imageHit.order)) return assigned.get(imageHit.order)
    let levels = null
    for (let i = pointer; i < innerOccurrences.length; i++) {
      if (innerOccurrences[i].url === imageHit.url) {
        levels = innerOccurrences[i].levels
        pointer = i + 1
        break
      }
    }
    assigned.set(imageHit.order, levels)
    return levels
  }
}

function describeLocation(hit, line, path, levels) {
  const lastLevel = levels ? levels[levels.length - 1] : null
  return {
    from: hit.from,
    to: hit.to,
    line,
    path,
    levels,
    pathText: levels ? formatPathLevels(levels) : null,
    pathExpression: levels ? pathExpression(levels) : null,
    label: lastLevel ? pathLabel(lastLevel) : `第 ${line} 行`,
  }
}

function groupByUrl(occurrences) {
  const groups = new Map()
  for (const { url, ...occurrence } of occurrences) {
    const group = groups.get(url)
    if (group) group.occurrences.push(occurrence)
    else groups.set(url, { url, occurrences: [occurrence] })
  }
  return [...groups.values()]
}

/** 递增位置列表对应的行号（单次扫描） */
function lineNumbersAt(text, positions) {
  const lines = []
  let line = 1
  let scanned = 0
  for (const position of positions) {
    let index = text.indexOf('\n', scanned)
    while (index !== -1 && index < position) {
      line++
      index = text.indexOf('\n', index + 1)
    }
    scanned = position
    lines.push(line)
  }
  return lines
}
