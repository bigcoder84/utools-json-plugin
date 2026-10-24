import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../../public/preload.js', import.meta.url), 'utf8')

/** 按宿主脚本方式执行完整 preload：不提供 CommonJS 包装器或相对模块解析。 */
export function loadPreload({ pluginPath, api = {}, platform = process.platform, parentPid = process.ppid, focus = () => {}, requireModule = require, script = source } = {}) {
  const events = new Map()
  const window = {
    utools: { getPluginLocalDataPath: () => pluginPath, ...api },
    focus,
    addEventListener: (name, callback) => events.set(name, callback),
  }
  const context = vm.createContext({
    window,
    process: { platform, ppid: parentPid },
    Buffer,
    setTimeout,
    clearTimeout,
    require: (id) => {
      if (!id.startsWith('node:')) throw new Error(`preload 不能依赖本地模块：${id}`)
      return requireModule(id)
    },
  })
  vm.runInContext(script, context, { filename: 'preload.js' })
  return {
    services: window.services,
    unload: () => events.get('unload')?.(),
    createWindowBridge: vm.runInContext('createWindowBridge', context),
  }
}
