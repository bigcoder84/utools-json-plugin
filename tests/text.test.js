import { describe, expect, it } from 'vitest'
import { formatBytes, utf8Length } from '../src/core/text.js'

describe('utf8Length', () => {
  it('matches TextEncoder for mixed text', () => {
    const text = 'a中文é😀{"x":1}'
    expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length)
  })
})

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
  })
})
