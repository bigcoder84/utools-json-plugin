/**
 * preload 桥接层：遵循最小暴露原则，只提供读取 JSON 文本文件的能力。
 * 不直接暴露 fs 等 Node.js 对象。
 */
const fs = require('node:fs')
const path = require('node:path')

const ALLOWED_EXTENSIONS = new Set(['.json', '.jsonc', '.har', '.geojson'])
const MAX_FILE_BYTES = 20 * 1024 * 1024

function readTextFile(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('文件路径无效')
  }
  const extension = path.extname(filePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`不支持的文件类型：${extension || '无扩展名'}`)
  }
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error('不是有效的文件')
  if (stat.size > MAX_FILE_BYTES) throw new Error('文件过大（超过 20MB）')
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
}

window.services = Object.freeze({ readTextFile })
