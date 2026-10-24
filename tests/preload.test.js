import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreload } from './helpers/preload.js'

const require = createRequire(import.meta.url)
const preloads = []
const exampleFile = fileURLToPath(new URL('../examples/demo.json', import.meta.url))

function preload(options = {}) {
  const instance = loadPreload({ pluginPath: `json-plugin-test-${randomUUID()}`, ...options })
  preloads.push(instance)
  return instance.services
}

afterEach(() => {
  for (const instance of preloads.splice(0)) instance.unload()
})

describe('complete preload bootstrap', () => {
  it('loads as CommonJS through the real Node loader inside this ESM project', () => {
    const loader = fileURLToPath(new URL('./helpers/require-preload.cjs', import.meta.url))
    const script = fileURLToPath(new URL('../public/preload.js', import.meta.url))
    const result = spawnSync(process.execPath, [loader, script], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['readTextFile', 'hasDetached', 'forwardToDetached', 'listenDetached', 'stopDetached', 'focusDetached'])
  })

  it('exposes file and window services without __dirname, module or local require support', async () => {
    const services = preload()
    expect(Object.keys(services)).toEqual(['readTextFile', 'hasDetached', 'forwardToDetached', 'listenDetached', 'stopDetached', 'focusDetached'])
    expect(services.readTextFile(exampleFile)).toBe(readFileSync(exampleFile, 'utf8'))
    expect(await services.forwardToDetached({ type: 'text' })).toBe(false)
  })

  it('keeps file reading available when window initialization is unavailable', () => {
    const services = preload({ pluginPath: undefined })
    expect(services.readTextFile(exampleFile)).toBe(readFileSync(exampleFile, 'utf8'))
    expect(() => services.listenDetached(() => {})).toThrow('无法获取插件目录')
    expect(() => services.stopDetached()).not.toThrow()
  })

  it('does not initialize IPC or query native paths until a window service is used', () => {
    const getPluginLocalDataPath = vi.fn(() => { throw new Error('native API not ready') })
    const services = preload({ api: { getPluginLocalDataPath } })
    expect(getPluginLocalDataPath).not.toHaveBeenCalled()
    expect(() => services.stopDetached()).not.toThrow()
    expect(getPluginLocalDataPath).not.toHaveBeenCalled()
  })

  it('supports older uTools versions exposing the plugin module directory', async () => {
    const getPath = vi.fn(() => `legacy-json-plugin-${randomUUID()}`)
    const services = preload({ api: { getPluginLocalDataPath: undefined, getPath } })
    expect(await services.forwardToDetached({ type: 'text' })).toBe(false)
    expect(getPath).toHaveBeenCalledWith('module')
  })

  it('forwards between separately bootstrapped preloads using the native plugin identity', async () => {
    const pluginPath = `shared-json-plugin-${randomUUID()}`
    const owner = preload({ pluginPath })
    const entry = preload({ pluginPath })
    const onOpen = vi.fn()
    expect(await owner.listenDetached(onOpen)).toBe(true)
    const action = { type: 'regex', payload: '{"hello":"中文"}' }
    expect(await entry.forwardToDetached(action)).toBe(true)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(action)
    owner.stopDetached()
    expect(await entry.forwardToDetached(action)).toBe(false)
  })

  it('releases the receiver when the preload unloads', async () => {
    const pluginPath = `unloaded-json-plugin-${randomUUID()}`
    const owner = preload({ pluginPath })
    const entry = preload({ pluginPath })
    await owner.listenDetached(() => {})
    preloads[0].unload()
    expect(await entry.forwardToDetached({ type: 'text' })).toBe(false)
  })

  it('uses a valid Windows named pipe even when the host has no __dirname', async () => {
    let socketPath
    const services = preload({
      platform: 'win32',
      requireModule: (id) => {
        if (id !== 'node:net') return require(id)
        return {
          createConnection: (value) => {
            socketPath = value
            const socket = new EventEmitter()
            socket.setEncoding = () => {}
            socket.destroy = () => {}
            queueMicrotask(() => socket.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })))
            return socket
          },
        }
      },
    })
    expect(await services.forwardToDetached({ type: 'text' })).toBe(false)
    expect(socketPath).toMatch(/^\\\\\.\\pipe\\utools-json-[a-f0-9]{16}$/)
  })

  it('activates the native macOS host before focusing the detached editor', async () => {
    const focus = vi.fn()
    let activate
    const execFile = vi.fn((_file, _args, _options, callback) => { activate = callback })
    const services = preload({
      platform: 'darwin', parentPid: 1234, focus,
      requireModule: (id) => id === 'node:child_process' ? { execFile } : require(id),
    })
    const result = services.focusDetached()
    expect(focus).not.toHaveBeenCalled()
    expect(execFile).toHaveBeenCalledWith('/usr/bin/osascript', [
      '-l', 'JavaScript', '-e', expect.stringContaining('runningApplicationWithProcessIdentifier(1234).activateWithOptions(3)'),
    ], { timeout: 3000 }, expect.any(Function))
    activate(null, 'true\n')
    await result
    expect(focus).toHaveBeenCalledOnce()
  })

  it('reports native activation failure so the source window remains available', async () => {
    const focus = vi.fn()
    const services = preload({
      platform: 'darwin', parentPid: 1234, focus,
      requireModule: (id) => id === 'node:child_process'
        ? { execFile: (_file, _args, _options, callback) => callback(new Error('activation failed'), '') }
        : require(id),
    })
    await expect(services.focusDetached()).rejects.toThrow('无法将独立窗口带到前台')
    expect(focus).not.toHaveBeenCalled()
  })
})
