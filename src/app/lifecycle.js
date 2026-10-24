/** 主窗口始终显示编辑器；仅用户分离窗口时才合并到已有独立窗口。 */
export function createPluginLifecycle({ createApp, platform, notify }) {
  let app = null
  let listening = false
  let forwarded = false
  let entered = false
  let pending = Promise.resolve()
  let generation = 0

  const canonicalScope = () => platform.getItem('workspace-scope', '')
  const clearDraft = () => {
    if (platform.getItem('main-workspace-scope') === app.storageScope) platform.setItem('main-workspace-scope', null)
  }
  const enqueue = (task) => {
    const version = generation
    pending = pending.then(() => task(version)).catch((error) => {
      console.error('[json-plugin] 打开插件失败', error)
      notify(error.message, 'error')
    })
    return pending
  }

  function open(action, newTab) {
    app.applyAppearance()
    let content
    let name
    if (action.type === 'files') {
      const file = Array.isArray(action.payload) ? action.payload.find((item) => item.isFile && item.path) : null
      if (!file) return
      try {
        content = platform.readTextFile(file.path)
        name = file.name
      } catch (error) {
        notify(`读取文件失败：${error.message}`, 'error')
        return
      }
    } else if (['regex', 'over'].includes(action.type) && typeof action.payload === 'string') {
      content = action.payload
    }
    if (newTab) app.newTab()
    if (content !== undefined) app.setContent(content, { name })
    if (name) notify(`已打开 ${name}`, 'success')
    app.focus()
  }

  async function listen(version) {
    if (listening) return true
    const claimed = await platform.listenDetached(async (action) => {
      if (version !== generation) throw new Error('独立窗口已退出')
      const transfer = action.type === 'workspace' ? action.payload : null
      if (!transfer || !Array.isArray(transfer.documents) || transfer.documents.length === 0
        || transfer.documents.some((doc) => typeof doc?.content !== 'string' || typeof doc?.title !== 'string')) {
        throw new Error('窗口传入的文档无效')
      }
      await platform.focusDetached()
      if (version !== generation) throw new Error('独立窗口已退出')
      app.importDocuments(transfer)
      app.flushSave()
    }, () => platform.focusDetached().catch((error) => notify(error.message, 'error')))
    if (version !== generation) return false
    listening = claimed
    return claimed
  }

  async function detach(version) {
    if (version !== generation || !app) return
    if (listening) return platform.focusDetached()
    const merge = async () => {
      const transfer = app.exportDocuments()
      const result = await platform.forwardToDetached({ type: 'workspace', payload: transfer })
      if (version !== generation || !result) return false
      forwarded = true
      clearDraft()
      app.stopSaving({ discard: app.storageScope !== canonicalScope() })
      platform.closeEntry()
      return true
    }
    if (await platform.hasDetached()) {
      if (version !== generation || await merge()) return
    }
    if (!await listen(version)) {
      if (version !== generation || await merge()) return
      throw new Error('独立窗口状态已变化，请重新打开插件')
    }
    if (version !== generation) return
    // 旧独立窗口在主窗口编辑期间关闭时，将它保存的文档一并恢复。
    app.mergeSavedWorkspace(canonicalScope())
    platform.setItem('workspace-scope', app.storageScope)
    clearDraft()
    app.flushSave()
    await platform.focusDetached()
  }

  return {
    get app() { return app },
    enter(action) {
      return enqueue(async (version) => {
        if (version !== generation) return
        if (!listening) {
          // 探测失败时仍显示主窗口，并使用独立草稿保存，避免覆盖其它窗口。
          const peer = await Promise.resolve().then(() => platform.hasDetached()).catch(() => true)
          if (version !== generation) return
          if (!app) {
            let scope = platform.getItem('main-workspace-scope')
            if (peer && (!scope || scope === canonicalScope())) scope = platform.createWorkspaceScope()
            app = createApp({ storageScope: scope ?? canonicalScope() })
          }
          platform.setItem('main-workspace-scope', app.storageScope)
          if (!peer) {
            app.mergeSavedWorkspace(canonicalScope())
            platform.setItem('workspace-scope', app.storageScope)
          }
        }
        forwarded = false
        open(action, entered && listening)
        entered = true
        if (platform.isDetached()) await detach(version)
      })
    },
    detach: () => enqueue(detach),
    out() {
      generation++
      if (!forwarded) app?.flushSave()
      platform.stopDetached()
      listening = false
      entered = false
    },
    flushSave() { if (!forwarded) app?.flushSave() },
  }
}
