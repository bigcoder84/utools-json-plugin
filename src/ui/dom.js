/**
 * 轻量 DOM 构建工具。子节点中的字符串一律作为文本插入（textContent），不解析 HTML，
 * JSON 中的内容（链接、字段名）不会被当作 HTML 执行。
 *
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...(Node|string|null|undefined|false)} children
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'className') element.className = value
    else if (key === 'title') {
      element.dataset.tooltip = value
      if (tag === 'button' && !props['aria-label']) element.setAttribute('aria-label', value)
    }
    else if (key === 'dataset') Object.assign(element.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'html') element.innerHTML = value // 仅用于内置 SVG 图标
    else element.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    element.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return element
}
