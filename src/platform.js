/**
 * uTools API 适配层：在 uTools 中调用原生能力，在普通浏览器（开发调试）中降级。
 */
import { isOpenableUrl } from './core/urls.js'

const STORAGE_PREFIX = 'json-plugin/'
const utools = typeof window !== 'undefined' ? window.utools : undefined

export const isUtools = Boolean(utools)

export async function copyText(text) {
  try {
    if (utools?.copyText) return utools.copyText(text) !== false
    await navigator.clipboard.writeText(text)
    return true
  } catch (error) {
    console.error('[json-plugin] 复制失败', error)
    return false
  }
}

/** 仅允许打开 http/https 链接 */
export function openExternal(url) {
  if (!isOpenableUrl(url)) return false
  if (utools?.shellOpenExternal) {
    Promise.resolve(utools.shellOpenExternal(url)).catch((error) => console.error('[json-plugin] 打开链接失败', error))
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return true
}

export function getItem(key, fallback = null) {
  try {
    const value = utools?.dbStorage
      ? utools.dbStorage.getItem(STORAGE_PREFIX + key)
      : JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) ?? 'null')
    return value ?? fallback
  } catch (error) {
    console.warn('[json-plugin] 读取存储失败', key, error)
    return fallback
  }
}

export function setItem(key, value) {
  try {
    if (utools?.dbStorage) utools.dbStorage.setItem(STORAGE_PREFIX + key, value)
    else localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
    return true
  } catch (error) {
    console.warn('[json-plugin] 写入存储失败', key, error)
    return false
  }
}

export function isDarkMode() {
  if (utools?.isDarkColors) return utools.isDarkColors()
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function isMac() {
  if (utools?.isMacOS) return utools.isMacOS()
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

export function onPluginEnter(callback) {
  utools?.onPluginEnter?.(callback)
}

export function onPluginOut(callback) {
  utools?.onPluginOut?.(callback)
}

export function onPluginDetach(callback) {
  utools?.onPluginDetach?.(callback)
}

export function isDetached() {
  return utools?.getWindowType?.() === 'detach'
}

export function hasDetached() {
  if (isUtools && !window.services?.hasDetached) return Promise.reject(new Error('插件桥接脚本版本过旧，请结束旧插件进程后重试'))
  return window.services?.hasDetached?.() ?? Promise.resolve(false)
}

export function createWorkspaceScope() {
  return `workspace/${window.crypto.randomUUID()}/`
}

export function forwardToDetached(action) {
  if (isUtools && (!window.services?.hasDetached || !window.services?.forwardToDetached)) {
    throw new Error('插件桥接脚本未加载，请结束旧插件进程并重新加载 plugin.json')
  }
  return window.services?.forwardToDetached?.(action) ?? Promise.resolve(false)
}

export function listenDetached(callback, onComplete) {
  if (!window.services?.hasDetached || !window.services?.listenDetached) throw new Error('插件桥接脚本未加载，请结束旧插件进程并重新加载 plugin.json')
  return window.services.listenDetached(callback, onComplete)
}

export function stopDetached() {
  window.services?.stopDetached?.()
}

export function closeEntry() {
  if (!isDetached()) utools?.hideMainWindow?.(false)
  utools?.outPlugin?.(true)
}

export function focusDetached() {
  if (window.services?.focusDetached) return window.services.focusDetached()
  window.focus()
  return Promise.resolve()
}

/** 通过 preload 读取文件（仅 uTools 环境可用） */
export function readTextFile(filePath) {
  const reader = window.services?.readTextFile
  if (!reader) throw new Error('当前环境不支持读取本地文件')
  return reader(filePath)
}
