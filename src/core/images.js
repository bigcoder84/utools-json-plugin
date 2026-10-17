import { analyzeDocument } from './analysis.js'

/**
 * 提取 JSON 中所有图片链接（只看字符串值，不看属性名），按链接去重分组。
 * 完整的分析（含嵌套 JSON 字符串）见 analyzeDocument。
 *
 * @param {string} text
 * @param {{collectContainers?: boolean}} [options]
 */
export function extractImages(text, options) {
  const { images, total, pathsAvailable, parse } = analyzeDocument(text, options)
  return { images, total, pathsAvailable, parse }
}

/**
 * 构建按位置排序的出现位置索引，用于根据光标反查图片
 * @param {ImageGroup[]} images
 */
export function buildOccurrenceIndex(images) {
  const entries = []
  images.forEach((group, groupIndex) => {
    group.occurrences.forEach((occurrence, occurrenceIndex) => {
      entries.push({ from: occurrence.from, to: occurrence.to, groupIndex, occurrenceIndex })
    })
  })
  return entries.sort((a, b) => a.from - b.from)
}

/** 二分查找包含 pos 的出现位置（端点包含在内） */
export function occurrenceAt(index, pos) {
  let low = 0
  let high = index.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const entry = index[mid]
    if (pos < entry.from) high = mid - 1
    else if (pos > entry.to) low = mid + 1
    else return entry
  }
  return null
}
