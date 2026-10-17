/** 文档标签：各自持有完整编辑器 / 子视图状态，切换时不重建文档。 */
export function createTabController({ documents, activeId, makeSession, capture, restore, onChange }) {
  const tabs = documents.map(({ id, title, content }) => ({ id, title, session: makeSession(content) }))
  let currentId = tabs.some((tab) => tab.id === activeId) ? activeId : tabs[0].id
  let nextId = Math.max(...tabs.map((tab) => tab.id)) + 1
  const current = () => tabs.find((tab) => tab.id === currentId)
  const remember = () => { current().session = capture() }

  return {
    get activeId() { return currentId },
    list: () => tabs.map(({ id, title }) => ({ id, title })),
    start: () => restore(current().session),
    activate(id) {
      const tab = tabs.find((item) => item.id === id)
      if (!tab || id === currentId) return false
      remember()
      currentId = id
      restore(tab.session)
      onChange()
      return true
    },
    add() {
      remember()
      const id = nextId++
      const tab = { id, title: `JSON ${id}`, session: makeSession('') }
      tabs.push(tab)
      currentId = id
      restore(tab.session)
      onChange()
      return id
    },
    close(id) {
      const index = tabs.findIndex((tab) => tab.id === id)
      if (tabs.length === 1 || index < 0) return false
      tabs.splice(index, 1)
      if (id === currentId) {
        const next = tabs[Math.min(index, tabs.length - 1)]
        currentId = next.id
        restore(next.session)
      }
      onChange()
      return true
    },
    rename(title) {
      current().title = title || `JSON ${currentId}`
      onChange()
    },
    /** 异步读取文件结束时，更新发起读取的文档，避免覆盖后来切换到的标签。 */
    replace(id, content, title) {
      const tab = tabs.find((item) => item.id === id)
      if (!tab) return false
      tab.session = makeSession(content)
      tab.title = title || `JSON ${id}`
      if (id === currentId) restore(tab.session)
      onChange()
      return true
    },
    snapshot() {
      remember()
      return tabs.map(({ id, title, session }) => ({ id, title, content: session.rootText }))
    },
  }
}
