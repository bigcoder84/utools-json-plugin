/**
 * 在 JSON 字符串 token 的原文中识别链接。
 * 原文可能包含 JSON 转义（`https:\/\/a.com`、`\u0026`），这里同时支持，
 * 返回的 from/to 指向原文中的位置，url 为解码后的真实地址。
 */

// 单个链接字符：排除空白、引号、尖括号、反斜杠以及常见中文标点；允许 \/ 与 \uXXXX 转义。
// 逗号是合法字符（如 OSS 的 resize,w_100），但后面紧跟另一个链接时视为分隔符
const URL_CHAR = String.raw`(?:[^\s"'<>\\\x60{}|^,，。；：！？、（）【】《》“”‘’]|,(?!(?:https?:)?(?:\\?\/){2})|\\\/|\\u[0-9a-fA-F]{4})`
const SLASHES = String.raw`(?:\\?\/){2}`
const HOST = String.raw`[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?`
const DATA_IMAGE = String.raw`data:image(?:\\?\/)[A-Za-z0-9.+-]+;base64,(?:[A-Za-z0-9+=]|\\?\/)+`

const URL_PATTERN = new RegExp(
  [
    String.raw`https?:${SLASHES}${URL_CHAR}+`,
    // 协议相对地址 //host/path，要求出现在字符串开头或引号、等号、括号、空白之后
    String.raw`(?<=["'=(\s,])${SLASHES}${HOST}(?:[/?#]${URL_CHAR}*)?`,
    DATA_IMAGE,
  ].join('|'),
  'g',
)

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif|apng|jfif)(?:[!@_][^/]*)?$/i
const NON_IMAGE_EXT_RE = /\.(?:html?|js|mjs|css|json|xml|pdf|zip|rar|7z|gz|txt|md|php|jsp|aspx?|mp4|mp3|m3u8|mov|avi|apk|ipa|exe|dmg|docx?|xlsx?|pptx?|csv)$/i
const QUICK_CHECK_RE = /\\?\/\\?\/|data:image/

/**
 * @param {string} raw 字符串 token 的原文（含首尾引号）
 * @param {number} [offset=0] raw 在文档中的起始偏移
 * @returns {{from: number, to: number, url: string, isImage: boolean}[]}
 */
export function findUrls(raw, offset = 0) {
  if (!QUICK_CHECK_RE.test(raw)) return []

  const results = []
  URL_PATTERN.lastIndex = 0
  let match
  while ((match = URL_PATTERN.exec(raw)) !== null) {
    const text = trimUrl(match[0])
    if (text.length === 0) continue
    const url = normalizeUrl(decodeJsonEscapes(text))
    if (!url) continue
    results.push({
      from: offset + match.index,
      to: offset + match.index + text.length,
      url,
      isImage: isImageUrl(url),
    })
  }
  return results
}

const TRAILING_CHARS = new Set(['.', ',', ';', ':', '!', '?'])
const BRACKET_PAIRS = { ')': '(', ']': '[' }

/** 去掉末尾标点和不成对的右括号（单次反向扫描，线性复杂度） */
function trimUrl(text) {
  const balance = { '(': 0, '[': 0 }
  for (const char of text) {
    if (char === '(' || char === '[') balance[char]++
    else if (char === ')' || char === ']') balance[BRACKET_PAIRS[char]]--
  }

  let end = text.length
  while (end > 0) {
    const char = text[end - 1]
    const open = BRACKET_PAIRS[char]
    if (TRAILING_CHARS.has(char)) {
      end--
    } else if (open && balance[open] < 0) {
      balance[open]++
      end--
    } else {
      break
    }
  }
  return text.slice(0, end)
}

function decodeJsonEscapes(text) {
  if (!text.includes('\\')) return text
  return text
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** 补全协议相对地址；非法地址返回 null */
export function normalizeUrl(url) {
  if (url.startsWith('data:')) return url
  const absolute = url.startsWith('//') ? `https:${url}` : url
  try {
    const parsed = new URL(absolute)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? absolute : null
  } catch {
    return null
  }
}

/** 根据扩展名判断是否为图片地址（不发起网络请求） */
export function isImageUrl(url) {
  if (url.startsWith('data:image/')) return true
  try {
    return IMAGE_EXT_RE.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** 扩展名明确不是图片（用于决定悬浮时是否尝试按图片加载） */
export function isLikelyNonImageUrl(url) {
  if (url.startsWith('data:')) return !url.startsWith('data:image/')
  try {
    return NON_IMAGE_EXT_RE.test(new URL(url).pathname)
  } catch {
    return true
  }
}

export function isOpenableUrl(url) {
  return /^https?:\/\//i.test(url)
}
