/** 图片加载结果缓存：避免悬浮预览和图片列表重复请求同一张图 */

const MAX_ENTRIES = 500
const cache = new Map()

/**
 * @param {string} url
 * @returns {Promise<{ok: boolean, width?: number, height?: number}>}
 */
export function loadImageMeta(url) {
  const cached = cache.get(url)
  if (cached) {
    cache.delete(url)
    cache.set(url, cached)
    return cached
  }

  const promise = new Promise((resolve) => {
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.decoding = 'async'
    image.onload = () => resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ ok: false })
    image.src = url
  })
  cache.set(url, promise)
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
  return promise
}

export function createImageElement(url, className, { lazy = false } = {}) {
  const image = document.createElement('img')
  image.className = className
  image.referrerPolicy = 'no-referrer'
  image.decoding = 'async'
  image.alt = ''
  // loading 必须在 src 之前设置，否则会立即加载
  if (lazy) image.loading = 'lazy'
  image.src = url
  return image
}

export function describeSize(meta) {
  return meta?.ok ? `${meta.width} × ${meta.height}` : ''
}
