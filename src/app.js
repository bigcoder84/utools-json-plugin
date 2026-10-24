import { isolateHistory } from '@codemirror/commands'
import { unfoldAll } from '@codemirror/language'
import { setDiagnostics } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { DEFAULT_SETTINGS, normalizeSettings } from './app/settings.js'
import { createTabController } from './app/tabs.js'
import { createViewController } from './app/views.js'
import { analyzeDocument } from './core/analysis.js'
import { escapeJson, minifyJson, minimalChange, smartFormat, stripComments } from './core/format.js'
import { buildOccurrenceIndex, occurrenceAt } from './core/images.js'
import { formatBytes, utf8Length } from './core/text.js'
import { setContainerCounts } from './editor/counts.js'
import { clearOccurrences, foldToLevel, highlightOccurrences, revealRange } from './editor/locate.js'
import { setNestedStrings } from './editor/nested.js'
import { createEditorState, indentCompartment, indentExtension, wrapCompartment, wrapExtension } from './editor/setup.js'
import { copyText, getItem, isDarkMode, isMac, openExternal, setItem } from './platform.js'
import { createBottomBar } from './ui/bottomBar.js'
import { h } from './ui/dom.js'
import { createImagePanel } from './ui/imagePanel.js'
import { createSettingsDialog } from './ui/settingsDialog.js'
import { createSubviewBar } from './ui/subviewBar.js'
import { createTabBar } from './ui/tabBar.js'
import { showToast } from './ui/toast.js'
import { createTooltips } from './ui/tooltip.js'

const FILTER_DELAY = 250
const SAVE_DELAY = 800
const MAX_SAVE_BYTES = 800 * 1024 // uTools 单个文档上限 1MB，留出余量
const MAX_FILE_BYTES = 20 * 1024 * 1024

const analysisDelay = (length) => Math.min(1000, 120 + length / 20000)

function readWorkspace(scope) {
  const storedTabs = getItem(`${scope}tabs`, null)
  const restoredIds = new Set()
  const documents = []
  for (const item of Array.isArray(storedTabs?.items) ? storedTabs.items : []) {
    if (!Number.isSafeInteger(item?.id) || item.id < 1 || restoredIds.has(item.id)) continue
    restoredIds.add(item.id)
    const text = getItem(`${scope}tab/${item.id}`, '')
    documents.push({
      id: item.id,
      title: typeof item.title === 'string' && item.title ? item.title : `JSON ${item.id}`,
      content: typeof text === 'string' ? text : '',
    })
  }
  const legacyContent = getItem(`${scope}content`, '')
  const hasSavedContent = documents.length > 0 || (typeof legacyContent === 'string' && legacyContent.length > 0)
  if (documents.length === 0) documents.push({ id: 1, title: 'JSON 1', content: typeof legacyContent === 'string' ? legacyContent : '' })
  return { storedTabs, restoredIds, documents, hasSavedContent }
}

export function createApp(container, { storageScope = '' } = {}) {
  const { storedTabs, restoredIds, documents, hasSavedContent } = readWorkspace(storageScope)
  let persistedTabIds = new Set(restoredIds)
  let savingEnabled = true
  const settings = normalizeSettings(Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, getItem(key, fallback)]),
  ))
  applyAppearance()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyAppearance)
  const mac = isMac()
  const keys = { mod: mac ? '⌘' : 'Ctrl+', shift: mac ? '⇧' : 'Shift+' }

  let analysis = { doc: null, images: [], index: [] }
  let activeImage = null // {url, index}
  let saveNotice = null // 最近一次保存提示，避免重复弹出
  const timers = { filter: 0, analysis: 0, save: 0 }

  const indentText = () => ' '.repeat(settings.indent)
  const currentText = () => view.state.doc.toString()
  const editable = () => !view.state.readOnly

  // ---------- UI ----------
  const bottomBar = createBottomBar({ onFilterInput: scheduleFilter, onAction: runAction, keys })
  const panel = createImagePanel({
    onLocate: (url, index) => setActiveImage(url, index, { reveal: true }),
    onOpen: openLink,
    onCopy: (text, label) => copy(text, label),
    onClose: () => setImagePanelOpen(false),
  })
  const subviewBar = createSubviewBar({
    onNavigate: (depth) => views.popTo(depth),
    onDiscard: () => views.discard(),
  })
  const tabBar = createTabBar({
    onAdd: () => runAction('newTab'),
    onSelect: switchTab,
    onClose: closeTab,
    onRename: (id, title) => tabs.rename(title, id),
  })
  const settingsDialog = createSettingsDialog({
    onChange: updateSetting,
    onReset: () => {
      // 缩进可能重排文档，放在其它显示选项同步之后。
      for (const name of ['theme', 'fontSize', 'wrap', 'imagePanelOpen', 'indent']) updateSetting(name, DEFAULT_SETTINGS[name])
    },
    onClose: () => bottomBar.setSettingsOpen(false),
  })
  const editorHost = h('div', { className: 'editor', id: 'json-editor', role: 'tabpanel', 'aria-label': 'JSON 编辑器' })
  container.append(
    h('div', { className: 'workspace' }, h('div', { className: 'editor-column' }, tabBar.root, subviewBar.root, editorHost), panel.root),
    bottomBar.root,
    settingsDialog.root,
  )
  const tooltips = createTooltips(container)

  const appKeymap = [
    { key: 'Mod-Shift-f', run: () => runAction('format') },
    { key: 'Alt-Shift-f', run: () => runAction('format') },
    { key: 'Mod-Shift-m', run: () => runAction('minify') },
    { key: 'Mod-Shift-e', run: () => runAction('escapeCopy') },
    { key: 'Mod-Shift-i', run: () => runAction('images') },
    { key: 'Mod-e', run: () => focusFilter() },
    { key: 'Alt-z', run: () => runAction('wrap') },
    { key: 'Mod-t', run: () => runAction('newTab') },
  ]

  const makeState = (doc, readOnly) =>
    createEditorState(doc, {
      readOnly,
      indent: settings.indent,
      wrap: settings.wrap,
      appKeymap,
      links: { onOpen: openLink, onCopy: (url) => copy(url, '链接'), modKey: mac ? '⌘' : 'Ctrl' },
      nested: { onOpen: (_view, entry) => views.enterNested(entry), onCopy: (text) => copy(text, '格式化结果') },
      onUpdate: handleUpdate,
      onDropFile: loadDroppedFile,
    })

  const view = new EditorView({ state: makeState('', false), parent: editorHost })

  const views = createViewController({
    view,
    makeState,
    indentText,
    onStateReplaced: () => {
      syncCompartments()
      activeImage = null
      panel.clearActive()
      runAnalysis()
    },
    onBeforeResultView: () => {
      flushSave()
      clearActiveImage()
    },
    onChange: syncViewUi,
    notify: showToast,
    revealError: (from, to) => revealRange(view, from, Math.max(from, to)),
  })

  const tabs = createTabController({
    documents,
    activeId: storedTabs?.activeId,
    makeSession: (text) => ({ state: makeState(text, false), rootText: text }),
    capture: () => ({ ...views.capture(), activeImage }),
    restore: (session) => {
      clearTimeout(timers.filter)
      clearTimeout(timers.analysis)
      tooltips.hide()
      views.restore(session)
      if (session.activeImage) setActiveImage(session.activeImage.url, session.activeImage.index)
    },
    onChange: () => {
      tabBar.render(tabs.list(), tabs.activeId)
      scheduleSave()
    },
  })

  bottomBar.setIndent(settings.indent)
  bottomBar.setWrap(settings.wrap)
  settingsDialog.render(settings)
  setImagePanelOpen(settings.imagePanelOpen, { persist: false })
  tabs.start()
  tabBar.render(tabs.list(), tabs.activeId)

  function syncCompartments() {
    view.dispatch({
      effects: [
        indentCompartment.reconfigure(indentExtension(settings.indent)),
        wrapCompartment.reconfigure(wrapExtension(settings.wrap)),
      ],
    })
  }

  function applyAppearance() {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark' || (settings.theme === 'system' && isDarkMode()))
    document.documentElement.style.setProperty('--editor-font-size', `${settings.fontSize}px`)
  }

  function updateSetting(name, value) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, name)) return
    const next = normalizeSettings({ ...settings, [name]: value })[name]
    if (settings[name] === next) return
    if (name === 'indent') setIndent(next)
    else if (name === 'wrap') setWrap(next)
    else if (name === 'imagePanelOpen') setImagePanelOpen(next)
    else {
      settings[name] = next
      persistSetting(name)
      applyAppearance()
      view.requestMeasure()
      settingsDialog.render(settings)
    }
  }

  function persistSetting(name) {
    if (!setItem(name, settings[name])) showToast('设置保存失败，本次运行仍然生效', 'error')
  }

  /** 视图切换（过滤、展开、进入/返回子视图）后同步底部栏和路径导航 */
  function syncViewUi() {
    const info = views.describe()
    bottomBar.setFilterMode(info.resultView)
    bottomBar.setFilterError(info.filterError)
    bottomBar.setFilterValue(info.expression)
    bottomBar.setExpandNested(info.expandNested)
    bottomBar.setEditable(editable())
    subviewBar.render(info)
  }

  // ---------- 编辑器事件 ----------
  function handleUpdate(update) {
    if (update.docChanged) {
      scheduleAnalysis()
      if (editable()) scheduleSave()
      if (isWholeDocumentPaste(update)) {
        const pastedDoc = update.state.doc
        setTimeout(() => { if (view.state.doc === pastedDoc) formatAfterPaste() }, 0)
      }
    } else if (update.selectionSet) {
      // 不能在 update 回调中同步 dispatch
      queueMicrotask(syncActiveImageFromCursor)
    }
  }

  function isWholeDocumentPaste(update) {
    return update.transactions.some((tr) => {
      if (!tr.isUserEvent('input.paste')) return false
      const { from, to } = tr.startState.selection.main
      return tr.startState.doc.length === 0 || (from === 0 && to === tr.startState.doc.length)
    })
  }

  function formatAfterPaste() {
    if (!editable()) return
    const result = smartFormat(currentText(), indentText())
    if (!result.ok || result.text === currentText()) return
    // 单独成为一条撤销记录：撤销一次即可回到粘贴的原文
    replaceDocument(result.text, 'format', { isolate: true })
    if (result.unescaped) showToast('已自动去除转义并格式化', 'success')
  }

  // ---------- 分析：语法校验、图片、嵌套 JSON、成员数 ----------
  function scheduleAnalysis() {
    clearTimeout(timers.analysis)
    timers.analysis = setTimeout(runAnalysis, analysisDelay(view.state.doc.length))
  }

  function runAnalysis() {
    clearTimeout(timers.analysis)
    const { state } = view
    const text = state.doc.toString()
    const result = analyzeDocument(text, { collectContainers: true })
    analysis = { doc: state.doc, images: result.images, index: buildOccurrenceIndex(result.images) }

    // JSON 暂时不合法（编辑中）时保留上一次的提示，随编辑映射位置，避免闪烁
    const effects = [setNestedStrings.of(result.nested)]
    if (result.parse.ok) effects.push(setContainerCounts.of(result.parse.containers))
    view.dispatch({ effects })

    panel.render(result)
    bottomBar.setImageCount(result.images.length)
    refreshActiveImage()
    subviewBar.render(views.describe())

    if (views.isResultView()) {
      bottomBar.setStatus(resultViewStatus())
      return
    }
    view.dispatch(setDiagnostics(state, result.parse.ok ? [] : [toDiagnostic(result.parse.error, state.doc.length)]))
    updateValidityStatus(result.parse, text)
  }

  function resultViewStatus() {
    const { expression, expandNested, expandedCount } = views.describe()
    const filtering = expression.trim().length > 0
    const text = expandNested && filtering ? '展开 + 过滤 · 只读' : filtering ? '过滤结果 · 只读' : `已展开 ${expandedCount} 处嵌套 · 只读`
    return { kind: 'info', text, title: '点击退出，回到编辑', onClick: exitResultView }
  }

  function toDiagnostic(error, length) {
    const from = Math.max(0, Math.min(error.from, length - 1))
    const to = Math.min(Math.max(error.to, from + 1), length)
    return { from, to, severity: 'error', message: error.message }
  }

  function updateValidityStatus(parse, text) {
    if (parse.ok && parse.empty) {
      bottomBar.setStatus(null)
      return
    }
    if (!parse.ok) {
      const { error } = parse
      bottomBar.setStatus({
        kind: 'error',
        text: `✗ 第 ${error.line} 行第 ${error.column} 列`,
        title: `${error.message}\n点击定位`,
        onClick: () => revealRange(view, error.from, Math.max(error.to, error.from)),
      })
      return
    }
    const notes = [parse.hasComments && '含注释', parse.hasTrailingComma && '含尾随逗号'].filter(Boolean)
    bottomBar.setStatus({
      kind: 'ok',
      text: `✓ ${formatBytes(utf8Length(text))}`,
      title: notes.length > 0 ? `JSON 有效（${notes.join('、')}，压缩/格式化时会自动处理）` : 'JSON 有效',
    })
  }

  // ---------- 图片定位 ----------
  function ensureFreshAnalysis() {
    if (analysis.doc !== view.state.doc) runAnalysis()
  }

  function setActiveImage(url, index, { reveal = false } = {}) {
    ensureFreshAnalysis()
    const group = analysis.images.find((item) => item.url === url)
    if (!group) return
    const safeIndex = Math.min(index, group.occurrences.length - 1)
    const unchanged = activeImage?.url === url && activeImage.index === safeIndex
    activeImage = { url, index: safeIndex }
    // 光标在同一个链接内移动时不重复渲染面板
    if (!unchanged) {
      highlightOccurrences(view, group.occurrences, safeIndex)
      panel.setActive(url, safeIndex)
    }
    if (reveal) {
      const target = group.occurrences[safeIndex]
      revealRange(view, target.from, target.to)
    }
  }

  function clearActiveImage() {
    if (!activeImage) return
    activeImage = null
    clearOccurrences(view)
    panel.clearActive()
  }

  /** 光标落在某个图片链接上时，同步激活面板中的卡片 */
  function syncActiveImageFromCursor() {
    if (analysis.doc !== view.state.doc) return
    const entry = occurrenceAt(analysis.index, view.state.selection.main.head)
    if (entry) setActiveImage(analysis.images[entry.groupIndex].url, entry.occurrenceIndex)
    else clearActiveImage()
  }

  /** 内容变化后重新应用激活状态（位置可能已变化） */
  function refreshActiveImage() {
    if (!activeImage) return
    const group = analysis.images.find((item) => item.url === activeImage.url)
    if (!group) {
      clearActiveImage()
      return
    }
    const index = Math.min(activeImage.index, group.occurrences.length - 1)
    highlightOccurrences(view, group.occurrences, index)
    // panel.render 已保留激活态，只有下标被截断时才需要再同步
    if (index !== activeImage.index) panel.setActive(activeImage.url, index, { scroll: false })
    activeImage = { ...activeImage, index }
  }

  function setImagePanelOpen(open, { persist = true } = {}) {
    settings.imagePanelOpen = open
    container.classList.toggle('panel-open', open)
    bottomBar.setImagePanelOpen(open)
    if (persist) persistSetting('imagePanelOpen')
    settingsDialog.render(settings)
  }

  // ---------- JS 过滤 / 展开嵌套 ----------
  function scheduleFilter(value) {
    clearTimeout(timers.filter)
    timers.filter = setTimeout(() => views.setExpression(value), FILTER_DELAY)
  }

  function exitResultView() {
    clearTimeout(timers.filter)
    views.exitResultView()
    view.focus()
  }

  function focusFilter() {
    bottomBar.input.focus()
    bottomBar.input.select()
    return true
  }

  // ---------- 文档标签 ----------
  function flushPendingFilter() {
    clearTimeout(timers.filter)
    if (bottomBar.input.value !== views.describe().expression) views.setExpression(bottomBar.input.value)
  }

  function switchTab(id) {
    if (id === tabs.activeId) return
    flushPendingFilter()
    tabs.activate(id)
    view.focus()
  }

  function newTab() {
    flushPendingFilter()
    return tabs.add()
  }

  function closeTab(id) {
    flushPendingFilter()
    tabs.close(id)
    view.focus()
  }

  // ---------- 工具栏动作 ----------
  const actions = {
    format: formatDocument,
    minify: minifyDocument,
    escapeCopy,
    copy: () => copy(currentText(), '全部内容'),
    stripComments: stripDocumentComments,
    foldAll: () => {
      if (foldToLevel(view, 2) === 0) showToast('没有可折叠的内容')
    },
    unfoldAll: () => unfoldAll(view),
    expandNested: () => {
      clearTimeout(timers.filter)
      views.toggleExpandNested()
    },
    indent: toggleIndent,
    wrap: toggleWrap,
    images: () => setImagePanelOpen(!settings.imagePanelOpen),
    newTab,
    settings: () => {
      tooltips.hide()
      settingsDialog.render(settings)
      settingsDialog.open()
      bottomBar.setSettingsOpen(true)
    },
  }

  function runAction(name) {
    actions[name]?.()
    if (name !== 'images' && name !== 'settings') view.focus()
    return true
  }

  function reportSyntaxError(prefix, error) {
    showToast(`${prefix}：${error.message}`, 'error')
    if (typeof error.from === 'number') revealRange(view, error.from, Math.max(error.to, error.from))
  }

  function formatDocument() {
    if (!editable()) return
    if (!currentText().trim()) {
      showToast('内容为空')
      return
    }
    const result = smartFormat(currentText(), indentText())
    if (!result.ok) {
      reportSyntaxError('格式化失败', result.error)
      return
    }
    replaceDocument(result.text, 'format')
    if (result.unescaped) showToast('已自动去除转义并格式化', 'success')
  }

  function minifyDocument() {
    if (!editable()) return
    try {
      replaceDocument(minifyJson(currentText()), 'minify')
    } catch (error) {
      reportSyntaxError('压缩失败', error)
    }
  }

  async function escapeCopy() {
    let escaped
    try {
      escaped = escapeJson(currentText())
    } catch (error) {
      reportSyntaxError('转义失败', error)
      return
    }
    if (await copyText(escaped)) showToast(`已复制压缩转义结果（${escaped.length} 字符）`, 'success')
    else showToast('复制失败', 'error')
  }

  function stripDocumentComments() {
    if (!editable()) return
    const { text, count } = stripComments(currentText())
    if (count === 0) {
      showToast('没有发现注释')
      return
    }
    replaceDocument(text, 'stripComments')
    showToast(`已去除 ${count} 处注释`, 'success')
  }

  function toggleIndent() {
    setIndent(settings.indent === 2 ? 4 : 2)
    showToast(`缩进：${settings.indent} 空格`)
  }

  function setIndent(size) {
    settings.indent = size
    persistSetting('indent')
    bottomBar.setIndent(settings.indent)
    settingsDialog.render(settings)
    syncCompartments()

    if (views.isResultView()) {
      views.refresh()
    } else if (editable()) {
      const result = smartFormat(currentText(), indentText())
      if (result.ok && !result.unescaped && currentText().includes('\n')) replaceDocument(result.text, 'format')
    }
  }

  function toggleWrap() {
    setWrap(!settings.wrap)
  }

  function setWrap(enabled) {
    settings.wrap = enabled
    persistSetting('wrap')
    bottomBar.setWrap(settings.wrap)
    settingsDialog.render(settings)
    syncCompartments()
  }

  async function copy(text, label) {
    if (await copyText(text)) showToast(`已复制${label}`, 'success')
    else showToast('复制失败', 'error')
  }

  function openLink(url) {
    if (openExternal(url)) showToast('已在浏览器中打开')
    else showToast('该链接无法在浏览器中打开', 'error')
  }

  // ---------- 文档读写 ----------
  function replaceDocument(text, event, { isolate = false } = {}) {
    const change = minimalChange(currentText(), text)
    if (change.from === change.to && change.insert === '') return
    view.dispatch({
      changes: change,
      userEvent: `input.${event}`,
      annotations: isolate ? isolateHistory.of('full') : undefined,
    })
  }

  /** 用新内容替换整个文档（插件进入、拖入文件），可以撤销回之前的内容 */
  function setContent(text, { name, tabId = tabs.activeId } = {}) {
    const result = smartFormat(text, indentText())
    if (tabId !== tabs.activeId) {
      // 文件仍在读取时切换了标签，只更新原来的文档，不改变当前页面。
      tabs.replace(tabId, result.ok ? result.text : text, name)
      return
    }
    // 取消尚未执行的过滤，并退出子视图/结果视图（子视图中未写回的修改会丢弃）
    clearTimeout(timers.filter)
    views.resetToRoot()
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.ok ? result.text : text },
      selection: { anchor: 0 },
      scrollIntoView: true,
      userEvent: 'input.replace',
      annotations: isolateHistory.of('full'),
    })
    if (result.ok && result.unescaped) showToast('已自动去除转义并格式化', 'success')
    tabs.rename(name || `JSON ${tabs.activeId}`)
    runAnalysis()
    view.focus()
  }

  async function loadDroppedFile(file) {
    const tabId = tabs.activeId
    if (file.size > MAX_FILE_BYTES) {
      showToast('文件过大（超过 20MB）', 'error')
      return
    }
    try {
      setContent(await file.text(), { name: file.name, tabId })
      showToast(`已打开 ${file.name}`, 'success')
    } catch (error) {
      showToast(`读取文件失败：${error.message}`, 'error')
    }
  }

  function scheduleSave() {
    clearTimeout(timers.save)
    timers.save = setTimeout(flushSave, SAVE_DELAY)
  }

  /** 每个标签单独保存根文档；子视图中的修改在返回写回后才会保存。 */
  function flushSave() {
    clearTimeout(timers.save)
    if (!savingEnabled) return
    const documents = tabs.snapshot()
    let saved = true
    let tooLarge = false
    for (const { id, content } of documents) {
      // 按每个存储文档的序列化体积计算，避免多标签共用 1MB 配额。
      const fits = utf8Length(JSON.stringify(content)) <= MAX_SAVE_BYTES
      tooLarge ||= !fits
      saved = setItem(`${storageScope}tab/${id}`, fits ? content : '') && saved
    }
    const indexSaved = setItem(`${storageScope}tabs`, { activeId: tabs.activeId, items: tabs.list() })
    saved = indexSaved && saved
    if (indexSaved) {
      const ids = new Set(documents.map((item) => item.id))
      for (const id of persistedTabIds) {
        if (!ids.has(id)) setItem(`${storageScope}tab/${id}`, null)
      }
      persistedTabIds = ids
    }
    const text = documents.find((item) => item.id === tabs.activeId).content
    saved = setItem(`${storageScope}content`, utf8Length(JSON.stringify(text)) <= MAX_SAVE_BYTES ? text : '') && saved
    const notice = tooLarge ? 'tooLarge' : saved ? null : 'failed'
    if (notice && notice !== saveNotice) {
      showToast(notice === 'tooLarge' ? '单个标签内容超过 800KB 时不会自动保存，关闭插件后该标签内容不保留' : '自动保存失败', 'error')
    }
    saveNotice = notice
  }

  function importDocuments({ documents, activeIndex = 0 }) {
    const ids = documents.map(({ title, content }) => {
      const id = newTab()
      setContent(content, { name: title })
      return id
    })
    switchTab(ids[activeIndex] ?? ids[0])
  }

  function exportDocuments() {
    const activeId = tabs.activeId
    // 分离时将合法的嵌套修改写回，不能写回时保留当前窗口供用户修正。
    for (const { id } of tabs.list()) {
      switchTab(id)
      flushPendingFilter()
      if (!views.popTo(0)) throw new Error('请先修正嵌套 JSON 的修改，再合并窗口')
    }
    switchTab(activeId)
    const documents = tabs.snapshot()
    return { documents, activeIndex: documents.findIndex((tab) => tab.id === activeId) }
  }

  function mergeSavedWorkspace(scope) {
    if (scope === storageScope) return
    const saved = readWorkspace(scope)
    if (!saved.hasSavedContent) return
    const activeId = tabs.activeId
    importDocuments({ documents: saved.documents })
    switchTab(activeId)
  }

  function stopSaving({ discard = false } = {}) {
    savingEnabled = false
    clearTimeout(timers.save)
    if (!discard) return
    for (const id of new Set([...persistedTabIds, ...tabs.list().map((tab) => tab.id)])) setItem(`${storageScope}tab/${id}`, null)
    setItem(`${storageScope}tabs`, null)
    setItem(`${storageScope}content`, null)
  }

  return {
    view,
    storageScope,
    exportDocuments,
    importDocuments,
    mergeSavedWorkspace,
    stopSaving,
    newTab,
    setContent,
    loadDroppedFile,
    flushSave,
    hasSavedContent,
    applyAppearance,
    focus: () => view.focus(),
  }
}
