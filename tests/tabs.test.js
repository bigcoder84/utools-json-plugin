import { describe, expect, it, vi } from 'vitest'
import { createTabController } from '../src/app/tabs.js'

function setup(documents = [{ id: 1, title: 'JSON 1', content: 'first' }], activeId = 1) {
  let session
  const onChange = vi.fn()
  const tabs = createTabController({
    documents,
    activeId,
    makeSession: (text) => ({ rootText: text, state: { text } }),
    capture: () => session,
    restore: (next) => { session = next },
    onChange,
  })
  tabs.start()
  return { tabs, onChange, session: () => session, edit: (text) => { session.rootText = text } }
}

describe('document tabs', () => {
  it('starts with one document and adds a blank tab only on request', () => {
    const { tabs, session } = setup()
    expect(tabs.list()).toEqual([{ id: 1, title: 'JSON 1' }])
    tabs.add()
    expect(tabs.activeId).toBe(2)
    expect(session().rootText).toBe('')
    expect(tabs.list()).toHaveLength(2)
  })

  it('keeps independent documents and preserves their session objects', () => {
    const { tabs, edit, session } = setup()
    const first = session()
    edit('edited first')
    tabs.add()
    edit('edited second')
    const second = session()
    tabs.activate(1)
    expect(session()).toBe(first)
    expect(session().rootText).toBe('edited first')
    tabs.activate(2)
    expect(session()).toBe(second)
    expect(session().rootText).toBe('edited second')
  })

  it('restores the selected saved tab and continues numbering', () => {
    const { tabs, session } = setup([
      { id: 2, title: 'a.json', content: 'a' },
      { id: 7, title: 'b.json', content: 'b' },
    ], 7)
    expect(session().rootText).toBe('b')
    expect(tabs.add()).toBe(8)
  })

  it('closes an inactive tab without replacing the active editor', () => {
    const { tabs, session } = setup()
    tabs.add()
    const second = session()
    tabs.close(1)
    expect(session()).toBe(second)
    expect(tabs.activeId).toBe(2)
    expect(tabs.list()).toHaveLength(1)
    expect(tabs.close(2)).toBe(false)
  })

  it('selects a neighbor when the active tab is closed', () => {
    const { tabs, edit, session } = setup()
    edit('retained')
    tabs.add()
    tabs.close(2)
    expect(tabs.activeId).toBe(1)
    expect(session().rootText).toBe('retained')
  })

  it('saves all root documents, names and the latest active edit', () => {
    const { tabs, edit } = setup()
    tabs.add()
    tabs.rename('example.json')
    edit('second')
    expect(tabs.snapshot()).toEqual([
      { id: 1, title: 'JSON 1', content: 'first' },
      { id: 2, title: 'example.json', content: 'second' },
    ])
  })

  it('routes a completed file read to its original tab without switching away', () => {
    const { tabs, session } = setup()
    tabs.add()
    const second = session()
    expect(tabs.replace(1, 'file contents', 'data.json')).toBe(true)
    expect(tabs.activeId).toBe(2)
    expect(session()).toBe(second)
    tabs.activate(1)
    expect(session().rootText).toBe('file contents')
    expect(tabs.list()[0].title).toBe('data.json')
    tabs.close(1)
    expect(tabs.replace(1, 'late read', 'data.json')).toBe(false)
    expect(tabs.list()).toHaveLength(1)
  })
})
