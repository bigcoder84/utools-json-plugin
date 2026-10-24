/**
 * preload 桥接层：只暴露受限文件读取和插件窗口间的打开请求。
 * 不直接暴露 fs 等 Node.js 对象。
 */
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const os = require('node:os')

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

// 通信初始化延后到首次使用，保证文件读取接口不受窗口初始化失败影响。
// 所有代码放在同一个 preload 中，兼容宿主对脚本和本地模块的不同加载方式。
let windows = null
function getWindows() {
  if (windows) return windows
  const api = window.utools
  const pluginPath = api?.getPluginLocalDataPath?.() || api?.getPath?.('module')
  if (typeof pluginPath !== 'string' || !pluginPath) throw new Error('无法获取插件目录，请重新加载插件配置')
  const windowKey = createHash('sha256').update(pluginPath).digest('hex').slice(0, 16)
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\utools-json-${windowKey}`
    : path.join(os.tmpdir(), `uj-${windowKey}.sock`)
  windows = createWindowBridge({ socketPath })
  return windows
}

window.services = Object.freeze({
  readTextFile,
  hasDetached: () => getWindows().exists(),
  forwardToDetached: (action) => getWindows().forward(action),
  listenDetached: (callback, onComplete) => getWindows().listen(callback, onComplete),
  stopDetached: () => windows?.close(),
  focusDetached,
})
window.addEventListener('unload', () => windows?.close())

/** macOS 的 BrowserView.focus() 不会激活被其它应用覆盖的原生窗口。 */
function focusDetached() {
  if (process.platform !== 'darwin') {
    window.focus()
    return Promise.resolve()
  }
  // 按宿主 PID 激活应用，无需辅助功能权限，也不会设置永久置顶。
  const pid = process.ppid
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.reject(new Error('无法确定独立窗口所属应用'))
  const script = `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions(3)`
  return new Promise((resolve, reject) => {
    require('node:child_process').execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 3000 }, (error, output) => {
      if (error || output.trim() !== 'true') {
        reject(new Error('无法将独立窗口带到前台，请重试'))
        return
      }
      window.focus()
      resolve()
    })
  })
}

/** 分离窗口持有本机 IPC 端点；后续入口收到确认后才退出，避免丢失打开请求。 */
const MAX_MESSAGE_BYTES = 24 * 1024 * 1024

function createWindowBridge({ socketPath, timeout = 5000 }) {
  const net = require('node:net')
  let server = null
  let starting = null
  let generation = 0
  const sockets = new Set()

  function connect(message) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath)
      let connected = false
      let sent = false
      let response = ''
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(() => finish(new Error('独立窗口响应超时，请稍后重试')), timeout)
      socket.setEncoding('utf8')
      socket.on('connect', () => {
        connected = true
        // 空消息仅探测端点，不打开文档。
        if (message === null) finish(null, true)
      })
      socket.on('data', (chunk) => {
        response += chunk
        let end
        while ((end = response.indexOf('\n')) >= 0 && !settled) {
          const line = response.slice(0, end)
          response = response.slice(end + 1)
          if (line === 'ready:2' && !sent) {
            sent = true
            socket.write(message)
          } else if (line === 'ok' && sent) finish(null, true)
          else if (line === 'error' && sent) finish(new Error('独立窗口未能打开文档，已保留当前窗口'))
          else finish(new Error('独立窗口未能接收文档，请结束旧插件进程后重试'))
        }
      })
      socket.on('error', (error) => {
        if (!connected && ['ENOENT', 'ECONNREFUSED'].includes(error.code)) finish(null, false)
        else finish(error)
      })
      socket.on('close', () => {
        if (!settled) finish(new Error('独立窗口连接已断开，请重新打开'))
      })
    })
  }

  async function listen(onOpen, onComplete) {
    if (server) return true
    if (starting) return starting
    const version = generation
    starting = (async () => {
      const candidate = net.createServer((socket) => {
        sockets.add(socket)
        let buffer = ''
        let bytes = 0
        let handled = false
        let accepted = false
        socket.setEncoding('utf8')
        socket.setTimeout(timeout, () => socket.destroy())
        socket.on('error', () => {})
        socket.on('close', () => {
          sockets.delete(socket)
          if (accepted && onComplete) Promise.resolve().then(onComplete).catch(() => {})
        })
        socket.on('data', (chunk) => {
          if (handled) return
          bytes += Buffer.byteLength(chunk)
          if (bytes > MAX_MESSAGE_BYTES) return socket.destroy()
          buffer += chunk
          if (!buffer.includes('\n')) return
          handled = true
          Promise.resolve().then(() => onOpen(JSON.parse(buffer))).then(
            () => { accepted = true; socket.end('ok\n') },
            () => socket.end('error\n'),
          )
        })
        // 先协商版本，避免新版文档被旧窗口当成空白 Tab 接收。
        socket.write('ready:2\n')
      })
      const bind = () => new Promise((resolve, reject) => {
        candidate.once('error', reject)
        candidate.listen(socketPath, () => {
          candidate.removeListener('error', reject)
          resolve()
        })
      })
      try {
        await bind()
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error
        if (await connect(null)) return false
        // Unix socket 在进程异常结束后可能残留；活跃端点不会被删除。
        if (process.platform !== 'win32') {
          try { fs.unlinkSync(socketPath) } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') throw unlinkError
          }
        }
        await bind()
      }
      if (version !== generation) {
        candidate.close()
        return false
      }
      server = candidate
      return true
    })()
    try { return await starting } finally { starting = null }
  }

  return {
    listen,
    exists: () => connect(null),
    forward(action) {
      const message = JSON.stringify({ type: action.type, payload: action.payload }) + '\n'
      if (Buffer.byteLength(message) > MAX_MESSAGE_BYTES) return Promise.reject(new Error('传入内容过大'))
      return connect(message)
    },
    close() {
      generation++
      for (const socket of sockets) socket.destroy()
      server?.close()
      server = null
    },
  }
}
