import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreload } from './helpers/preload.js'

const { createWindowBridge } = loadPreload()
const resources = []
const paths = []

function endpoint() {
  const name = `uj-test-${randomUUID().slice(0, 8)}`
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`)
  paths.push(socketPath)
  return socketPath
}

function bridge(socketPath = endpoint(), options = {}) {
  const instance = createWindowBridge({ socketPath, ...options })
  resources.push(() => instance.close())
  return instance
}

afterEach(async () => {
  for (const close of resources.splice(0)) await close()
  for (const socketPath of paths.splice(0)) {
    if (process.platform !== 'win32' && existsSync(socketPath)) unlinkSync(socketPath)
  }
})

describe('detached window IPC', () => {
  it('returns false immediately when no detached window exists', async () => {
    expect(await bridge().forward({ type: 'text' })).toBe(false)
  })

  it('discovers an existing window without importing or activating a document', async () => {
    const socketPath = endpoint()
    const onOpen = vi.fn()
    const onComplete = vi.fn()
    await bridge(socketPath).listen(onOpen, onComplete)
    expect(await bridge(socketPath).exists()).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('waits for handoff completion before raising the receiver again', async () => {
    const socketPath = endpoint()
    const onOpen = vi.fn()
    const onComplete = vi.fn()
    await bridge(socketPath).listen(onOpen, onComplete)
    expect(await bridge(socketPath).forward({ type: 'text' })).toBe(true)
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(onOpen.mock.invocationCallOrder[0]).toBeLessThan(onComplete.mock.invocationCallOrder[0])
  })

  it('never sends new workspace data to an older receiver without a protocol greeting', async () => {
    const socketPath = endpoint()
    const onData = vi.fn()
    const old = net.createServer((socket) => {
      socket.on('data', onData)
      socket.on('error', () => {})
    })
    await new Promise((resolve) => old.listen(socketPath, resolve))
    resources.push(() => new Promise((resolve) => old.close(resolve)))
    await expect(bridge(socketPath, { timeout: 50 }).forward({ type: 'workspace', payload: { documents: [] } })).rejects.toThrow('响应超时')
    expect(onData).not.toHaveBeenCalled()
  })

  it('transfers text, file requests and repeated opens without changing their payloads', async () => {
    const socketPath = endpoint()
    const owner = bridge(socketPath)
    const onOpen = vi.fn()
    expect(await owner.listen(onOpen)).toBe(true)
    const actions = [
      { type: 'regex', payload: '{\n"中文": "line\\nvalue"\n}' },
      { type: 'text', payload: 'JSON' },
      { type: 'files', payload: [{ path: '/data.json', name: 'data.json', isFile: true }] },
    ]
    for (const action of actions) expect(await bridge(socketPath).forward(action)).toBe(true)
    expect(onOpen.mock.calls.map(([action]) => action)).toEqual(actions)
  })

  it('supports payloads that span multiple socket chunks', async () => {
    const socketPath = endpoint()
    const payload = JSON.stringify({ text: '多字节内容\n'.repeat(100000) })
    const onOpen = vi.fn()
    await bridge(socketPath).listen(onOpen)
    expect(await bridge(socketPath).forward({ type: 'regex', payload })).toBe(true)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ type: 'regex', payload })
  })

  it('waits for the document handler before acknowledging the handoff', async () => {
    const socketPath = endpoint()
    let opened
    await bridge(socketPath).listen(() => new Promise((resolve) => { opened = resolve }))
    let acknowledged = false
    const result = bridge(socketPath).forward({ type: 'text' }).then((value) => { acknowledged = value })
    await vi.waitFor(() => expect(opened).toBeTypeOf('function'))
    expect(acknowledged).toBe(false)
    opened()
    await result
    expect(acknowledged).toBe(true)
  })

  it('does not replace a live receiver or open a tab during endpoint discovery', async () => {
    const socketPath = endpoint()
    const first = vi.fn()
    const second = vi.fn()
    await bridge(socketPath).listen(first)
    expect(await bridge(socketPath).listen(second)).toBe(false)
    expect(first).not.toHaveBeenCalled()
    await bridge(socketPath).forward({ type: 'text' })
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it('reports a failed handoff instead of treating it as an absent receiver', async () => {
    const socketPath = endpoint()
    await bridge(socketPath).listen(() => { throw new Error('cannot open') })
    await expect(bridge(socketPath).forward({ type: 'text' })).rejects.toThrow('未能打开文档')
  })

  it('reports an unresponsive receiver and closes its connection', async () => {
    const socketPath = endpoint()
    await bridge(socketPath).listen(() => new Promise(() => {}))
    await expect(bridge(socketPath, { timeout: 50 }).forward({ type: 'text' })).rejects.toThrow('响应超时')
  })

  it('releases the endpoint when a detached window closes', async () => {
    const socketPath = endpoint()
    const owner = bridge(socketPath)
    await owner.listen(() => {})
    owner.close()
    expect(await bridge(socketPath).forward({ type: 'text' })).toBe(false)
    expect(await bridge(socketPath).listen(() => {})).toBe(true)
  })

  it('does not leave a hidden receiver if the window exits while the endpoint is starting', async () => {
    const socketPath = endpoint()
    const owner = bridge(socketPath)
    const listening = owner.listen(() => {})
    owner.close()
    expect(await listening).toBe(false)
    expect(await bridge(socketPath).forward({ type: 'text' })).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('recovers a Unix endpoint left by a crashed process', async () => {
    const socketPath = endpoint()
    const child = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(process.argv[1], () => process.stdout.write('ready'))`, socketPath])
    resources.push(() => { if (child.exitCode === null) child.kill('SIGKILL') })
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.stdout.once('data', resolve)
    })
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
    expect(existsSync(socketPath)).toBe(true)
    const onOpen = vi.fn()
    expect(await bridge(socketPath).listen(onOpen)).toBe(true)
    await bridge(socketPath).forward({ type: 'text' })
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
