import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPluginLifecycle } from '../src/app/lifecycle.js'
import { createTabController } from '../src/app/tabs.js'

const keyword = { type: 'text', payload: 'JSON' }

function setup({ detached = false, peer = false, forwarded = true } = {}) {
  let session
  let receive
  let complete
  const store = new Map(peer ? [['workspace-scope', 'owner/']] : [])
  const tabs = createTabController({
    documents: [{ id: 1, title: 'original.json', content: 'original' }],
    makeSession: (rootText) => ({ rootText }), capture: () => session,
    restore: (next) => { session = next }, onChange: () => {},
  })
  tabs.start()
  const editor = {
    storageScope: '', applyAppearance: vi.fn(), focus: vi.fn(), flushSave: vi.fn(),
    newTab: vi.fn(() => tabs.add()),
    setContent: vi.fn((content, { name }) => { session.rootText = content; tabs.rename(name) }),
    exportDocuments: vi.fn(() => {
      const documents = tabs.snapshot()
      return { documents, activeIndex: documents.findIndex((tab) => tab.id === tabs.activeId) }
    }),
    importDocuments: vi.fn(({ documents, activeIndex = 0 }) => {
      const ids = documents.map(({ title, content }) => { const id = tabs.add(); tabs.replace(id, content, title); return id })
      tabs.activate(ids[activeIndex] ?? ids[0])
    }),
    mergeSavedWorkspace: vi.fn(), stopSaving: vi.fn(),
  }
  const platform = {
    isDetached: vi.fn(() => detached), hasDetached: vi.fn(async () => peer),
    forwardToDetached: vi.fn(async () => forwarded),
    listenDetached: vi.fn(async (callback, onComplete) => { receive = callback; complete = onComplete; return true }),
    closeEntry: vi.fn(), focusDetached: vi.fn(async () => {}), stopDetached: vi.fn(),
    readTextFile: vi.fn(() => 'file content'), createWorkspaceScope: vi.fn(() => 'workspace/draft/'),
    getItem: vi.fn((key, fallback = null) => store.get(key) ?? fallback),
    setItem: vi.fn((key, value) => store.set(key, value)),
  }
  const createApp = vi.fn(({ storageScope }) => { editor.storageScope = storageScope; return editor })
  const notify = vi.fn()
  const lifecycle = createPluginLifecycle({ createApp, platform, notify })
  return { lifecycle, editor, tabs, platform, createApp, notify, store, session: () => session, receive: (action) => receive(action), complete: () => complete() }
}

afterEach(() => vi.restoreAllMocks())

describe('plugin window lifecycle', () => {
  it('keeps normal opens in the main window even while a detached window is hidden', async () => {
    const { lifecycle, editor, createApp, tabs, platform } = setup({ peer: true })
    await lifecycle.enter({ type: 'regex', payload: '{"new":true}' })
    expect(createApp).toHaveBeenCalledWith({ storageScope: 'workspace/draft/' })
    expect(tabs.snapshot()[0].content).toBe('{"new":true}')
    expect(editor.focus).toHaveBeenCalledOnce()
    expect(platform.forwardToDetached).not.toHaveBeenCalled()
    expect(platform.listenDetached).not.toHaveBeenCalled()
    expect(platform.closeEntry).not.toHaveBeenCalled()
    expect(platform.focusDetached).not.toHaveBeenCalled()
  })

  it('retains main-window replacement and restores the canonical workspace', async () => {
    const { lifecycle, createApp, tabs, platform, store } = setup()
    store.set('workspace-scope', 'saved/')
    await lifecycle.enter(keyword)
    await lifecycle.enter({ type: 'over', payload: 'replacement' })
    expect(createApp).toHaveBeenCalledExactlyOnceWith({ storageScope: 'saved/' })
    expect(tabs.snapshot()).toEqual([{ id: 1, title: 'JSON 1', content: 'replacement' }])
    expect(platform.forwardToDetached).not.toHaveBeenCalled()
  })

  it('merges the current edited documents and names only when the user detaches', async () => {
    const { lifecycle, editor, tabs, platform, session, store } = setup({ peer: true })
    await lifecycle.enter({ type: 'regex', payload: 'initial payload' })
    session().rootText = 'edited after opening'
    tabs.rename('请求参数')
    tabs.add()
    session().rootText = 'another document'
    platform.isDetached.mockReturnValue(true)
    await lifecycle.detach()
    expect(platform.forwardToDetached).toHaveBeenCalledExactlyOnceWith({ type: 'workspace', payload: {
      documents: [
        { id: 1, title: '请求参数', content: 'edited after opening' },
        { id: 2, title: 'JSON 2', content: 'another document' },
      ], activeIndex: 1,
    } })
    expect(editor.stopSaving).toHaveBeenCalledWith({ discard: true })
    expect(store.get('main-workspace-scope')).toBeNull()
    expect(store.get('workspace-scope')).toBe('owner/')
    expect(platform.closeEntry).toHaveBeenCalledOnce()
    lifecycle.out()
    lifecycle.flushSave()
    expect(editor.flushSave).not.toHaveBeenCalled()
  })

  it('becomes the first detached window without rebuilding its editor sessions', async () => {
    const { lifecycle, tabs, platform, session, store } = setup()
    await lifecycle.enter(keyword)
    const original = session()
    platform.isDetached.mockReturnValue(true)
    await lifecycle.detach()
    expect(platform.listenDetached).toHaveBeenCalledOnce()
    expect(platform.forwardToDetached).not.toHaveBeenCalled()
    expect(session()).toBe(original)
    expect(tabs.list()).toHaveLength(1)
    expect(store.get('main-workspace-scope')).toBeNull()
  })

  it('activates the existing window, adds transferred tabs and restores the transferred selection', async () => {
    const { lifecycle, tabs, receive, complete, platform, editor } = setup({ detached: true })
    await lifecycle.enter(keyword)
    platform.focusDetached.mockClear()
    await receive({ type: 'workspace', payload: { documents: [
      { title: 'a.json', content: 'a' }, { title: 'b.json', content: 'b' },
    ], activeIndex: 0 } })
    expect(tabs.snapshot()).toEqual([
      { id: 1, title: 'original.json', content: 'original' },
      { id: 2, title: 'a.json', content: 'a' }, { id: 3, title: 'b.json', content: 'b' },
    ])
    expect(tabs.activeId).toBe(2)
    expect(platform.focusDetached.mock.invocationCallOrder[0]).toBeLessThan(editor.importDocuments.mock.invocationCallOrder[0])
    await complete()
    expect(platform.focusDetached).toHaveBeenCalledTimes(2)
  })

  it('rejects a transfer if native activation fails without changing either document', async () => {
    const { lifecycle, tabs, receive, platform, editor } = setup({ detached: true })
    await lifecycle.enter(keyword)
    platform.focusDetached.mockRejectedValueOnce(new Error('cannot activate'))
    await expect(receive({ type: 'workspace', payload: { documents: [{ title: 'new', content: 'data' }] } })).rejects.toThrow('cannot activate')
    expect(tabs.snapshot()).toEqual([{ id: 1, title: 'original.json', content: 'original' }])
    expect(editor.importDocuments).not.toHaveBeenCalled()
  })

  it('validates all transferred documents before importing any tabs', async () => {
    const { lifecycle, tabs, receive } = setup({ detached: true })
    await lifecycle.enter(keyword)
    await expect(receive({ type: 'workspace', payload: { documents: [
      { title: 'valid', content: 'data' }, { title: 'invalid', content: null },
    ] } })).rejects.toThrow('文档无效')
    expect(tabs.list()).toHaveLength(1)
  })

  it('keeps the source window and its saves on an unsuccessful handoff', async () => {
    const { lifecycle, editor, platform, notify } = setup({ peer: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await lifecycle.enter(keyword)
    platform.isDetached.mockReturnValue(true)
    platform.forwardToDetached.mockRejectedValueOnce(new Error('transfer timed out'))
    await lifecycle.detach()
    expect(notify).toHaveBeenCalledWith('transfer timed out', 'error')
    expect(platform.closeEntry).not.toHaveBeenCalled()
    expect(editor.stopSaving).not.toHaveBeenCalled()
    lifecycle.flushSave()
    expect(editor.flushSave).toHaveBeenCalledOnce()
  })

  it('takes ownership if the old window closes between discovery and handoff', async () => {
    const { lifecycle, platform, editor, store } = setup({ peer: true, forwarded: false })
    await lifecycle.enter(keyword)
    platform.isDetached.mockReturnValue(true)
    await lifecycle.detach()
    expect(platform.listenDetached).toHaveBeenCalledOnce()
    expect(editor.mergeSavedWorkspace).toHaveBeenCalledWith('owner/')
    expect(store.get('workspace-scope')).toBe('workspace/draft/')
    expect(platform.closeEntry).not.toHaveBeenCalled()
  })

  it('handles automatic separation before entry using the same explicit separation path', async () => {
    const { lifecycle, platform, editor } = setup({ detached: true, peer: true })
    await lifecycle.detach()
    expect(platform.listenDetached).not.toHaveBeenCalled()
    await lifecycle.enter({ type: 'regex', payload: 'initial' })
    expect(editor.setContent).toHaveBeenCalledWith('initial', { name: undefined })
    expect(platform.forwardToDetached).toHaveBeenCalledOnce()
    expect(platform.closeEntry).toHaveBeenCalledOnce()
  })

  it('opens local files in the main window without sending their original paths to another window', async () => {
    const { lifecycle, tabs, platform } = setup({ peer: true })
    await lifecycle.enter({ type: 'files', payload: [{ isFile: true, path: '/data.json', name: 'data.json' }] })
    expect(tabs.snapshot()[0]).toEqual({ id: 1, title: 'data.json', content: 'file content' })
    expect(platform.forwardToDetached).not.toHaveBeenCalled()
  })

  it('still displays the main editor when window communication cannot be initialized', async () => {
    const { lifecycle, platform, createApp, editor } = setup()
    platform.hasDetached.mockRejectedValueOnce(new Error('bridge unavailable'))
    await lifecycle.enter(keyword)
    expect(createApp).toHaveBeenCalledWith({ storageScope: 'workspace/draft/' })
    expect(editor.focus).toHaveBeenCalledOnce()
    expect(platform.closeEntry).not.toHaveBeenCalled()
  })

  it('displays the main editor even if preload initialization throws synchronously', async () => {
    const { lifecycle, platform, editor } = setup()
    platform.hasDetached.mockImplementationOnce(() => { throw new Error('preload failed') })
    await lifecycle.enter(keyword)
    expect(editor.focus).toHaveBeenCalledOnce()
    expect(editor.storageScope).toBe('workspace/draft/')
  })

  it('restores an independently saved main draft and merges history after the old owner has closed', async () => {
    const { lifecycle, editor, createApp, store } = setup()
    store.set('workspace-scope', 'closed-owner/')
    store.set('main-workspace-scope', 'draft/')
    await lifecycle.enter(keyword)
    expect(createApp).toHaveBeenCalledWith({ storageScope: 'draft/' })
    expect(editor.mergeSavedWorkspace).toHaveBeenCalledWith('closed-owner/')
    expect(store.get('workspace-scope')).toBe('draft/')
  })

  it('cancels a pending main entry after the user has exited it', async () => {
    const { lifecycle, platform, createApp } = setup()
    let found
    platform.hasDetached.mockReturnValueOnce(new Promise((resolve) => { found = resolve }))
    const entering = lifecycle.enter(keyword)
    await vi.waitFor(() => expect(platform.hasDetached).toHaveBeenCalledOnce())
    lifecycle.out()
    found(true)
    await entering
    expect(createApp).not.toHaveBeenCalled()
    expect(platform.closeEntry).not.toHaveBeenCalled()
  })

  it('does not close another uTools view if a detached handoff completes after this entry exited', async () => {
    const { lifecycle, platform, editor } = setup({ peer: true })
    await lifecycle.enter(keyword)
    let acknowledge
    platform.forwardToDetached.mockReturnValueOnce(new Promise((resolve) => { acknowledge = resolve }))
    const detaching = lifecycle.detach()
    await vi.waitFor(() => expect(platform.forwardToDetached).toHaveBeenCalledOnce())
    lifecycle.out()
    acknowledge(true)
    await detaching
    expect(platform.closeEntry).not.toHaveBeenCalled()
    expect(editor.stopSaving).not.toHaveBeenCalled()
  })
})
