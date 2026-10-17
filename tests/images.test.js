import { describe, expect, it } from 'vitest'
import { buildOccurrenceIndex, extractImages, occurrenceAt } from '../src/core/images.js'
import { formatPath, pathLabel } from '../src/core/path.js'
import { findUrls, isImageUrl, isLikelyNonImageUrl, isOpenableUrl, normalizeUrl } from '../src/core/urls.js'

const quote = (value) => JSON.stringify(value)

describe('findUrls', () => {
  it('finds a plain URL with document offsets', () => {
    const raw = quote('https://dimg04.c-ctrip.com/images/a.png')
    expect(findUrls(raw, 10)).toEqual([
      { from: 11, to: 10 + raw.length - 1, url: 'https://dimg04.c-ctrip.com/images/a.png', isImage: true },
    ])
  })

  it('finds URLs embedded in HTML and text', () => {
    const raw = quote("<img src='https://a.com/x.jpg'> 详见 https://b.com/page，谢谢")
    expect(findUrls(raw).map((u) => u.url)).toEqual(['https://a.com/x.jpg', 'https://b.com/page'])
  })

  it('decodes JSON escapes in URLs', () => {
    const raw = String.raw`"https:\/\/a.com\/x.png?a=1\u0026b=2"`
    expect(findUrls(raw)[0]).toMatchObject({ url: 'https://a.com/x.png?a=1&b=2', isImage: true, from: 1, to: raw.length - 1 })
  })

  it('stops at escaped quotes inside strings', () => {
    const raw = String.raw`"<a href=\"https://a.com/p\">x</a>"`
    expect(findUrls(raw).map((u) => u.url)).toEqual(['https://a.com/p'])
  })

  it('supports protocol-relative URLs only at a boundary', () => {
    expect(findUrls(quote('//pic.c-ctrip.com/a.png')).map((u) => u.url)).toEqual(['https://pic.c-ctrip.com/a.png'])
    expect(findUrls(quote('a//b.com'))).toEqual([])
  })

  it('splits comma-separated URLs but keeps commas inside a URL', () => {
    const raw = quote('https://a.com/1.png,https://a.com/2.png,//b.com/3.png')
    expect(findUrls(raw).map((u) => u.url)).toEqual([
      'https://a.com/1.png',
      'https://a.com/2.png',
      'https://b.com/3.png',
    ])
    expect(findUrls(quote('https://o.com/a.jpg?x-oss-process=image/resize,w_100'))[0].url).toBe(
      'https://o.com/a.jpg?x-oss-process=image/resize,w_100',
    )
  })

  it('trims trailing punctuation and unbalanced brackets', () => {
    expect(findUrls(quote('see (https://a.com/x).')).map((u) => u.url)).toEqual(['https://a.com/x'])
    expect(findUrls(quote('https://a.com/wiki/A_(b)')).map((u) => u.url)).toEqual(['https://a.com/wiki/A_(b)'])
  })

  it('trims long runs of closing brackets in linear time', () => {
    const raw = quote(`https://a.com/x${')'.repeat(50000)}`)
    const start = performance.now()
    expect(findUrls(raw)[0].url).toBe('https://a.com/x')
    expect(performance.now() - start).toBeLessThan(200)
  })

  it('recognizes data:image URIs', () => {
    const raw = quote('data:image/png;base64,iVBORw0KGgo=')
    expect(findUrls(raw)[0]).toMatchObject({ url: 'data:image/png;base64,iVBORw0KGgo=', isImage: true })
  })

  it('returns nothing for strings without links', () => {
    expect(findUrls(quote('plain text'))).toEqual([])
  })
})

describe('url helpers', () => {
  it.each([
    ['https://a.com/x.PNG', true],
    ['https://a.com/x.jpg?w=1', true],
    ['https://a.com/x.jpg_.webp', true],
    ['https://a.com/x.jpg!thumb', true],
    ['https://a.com/x.jpg@100w', true],
    ['https://a.com/x.html', false],
    ['https://a.com/images/x', false],
    ['not a url', false],
  ])('isImageUrl(%s) = %s', (url, expected) => {
    expect(isImageUrl(url)).toBe(expected)
  })

  it('classifies obviously non-image URLs', () => {
    expect(isLikelyNonImageUrl('https://a.com/a.json')).toBe(true)
    expect(isLikelyNonImageUrl('https://a.com/api/img')).toBe(false)
    expect(isLikelyNonImageUrl('data:text/plain,abc')).toBe(true)
    expect(isLikelyNonImageUrl('::bad')).toBe(true)
  })

  it('normalizes and validates URLs', () => {
    expect(normalizeUrl('//a.com/x')).toBe('https://a.com/x')
    expect(normalizeUrl('https://')).toBeNull()
    expect(isOpenableUrl('https://a.com')).toBe(true)
    expect(isOpenableUrl('data:image/png;base64,AA')).toBe(false)
  })
})

describe('path helpers', () => {
  it('formats paths usable in the JS filter', () => {
    expect(formatPath([1, 'background', 'titleImg'])).toBe('[1].background.titleImg')
    expect(formatPath(['logo-img', 0])).toBe('["logo-img"][0]')
    expect(formatPath([])).toBe('')
  })

  it('builds short labels', () => {
    expect(pathLabel([1, 'background', 'titleImg'])).toBe('titleImg')
    expect(pathLabel(['list', 2, 0])).toBe('list[2][0]')
    expect(pathLabel([3])).toBe('[3]')
    expect(pathLabel([])).toBe('(根节点)')
  })
})

describe('extractImages', () => {
  const sample = JSON.stringify(
    [
      { code: 'weixin', icon: 'https://a.com/same.png' },
      {
        code: 'alipay',
        link: 'https://a.com/page',
        background: { titleImg: 'https://a.com/title.png', logoImg: 'https://a.com/same.png' },
      },
    ],
    null,
    2,
  )

  it('groups duplicate URLs and records every field path', () => {
    const { images, total, pathsAvailable } = extractImages(sample)
    expect(pathsAvailable).toBe(true)
    expect(total).toBe(3)
    expect(images.map((g) => g.url)).toEqual(['https://a.com/same.png', 'https://a.com/title.png'])
    expect(images[0].occurrences.map((o) => o.pathText)).toEqual(['[0].icon', '[1].background.logoImg'])
    expect(images[0].occurrences.map((o) => o.label)).toEqual(['icon', 'logoImg'])
  })

  it('reports accurate offsets and line numbers', () => {
    const { images } = extractImages(sample)
    const occurrence = images[1].occurrences[0]
    expect(sample.slice(occurrence.from, occurrence.to)).toBe('https://a.com/title.png')
    expect(occurrence.line).toBe(sample.slice(0, occurrence.from).split('\n').length)
  })

  it('records each occurrence inside a single string', () => {
    const { images } = extractImages(quote({ html: '<img src="https://a.com/x.png"><img src="https://a.com/x.png">' }))
    expect(images).toHaveLength(1)
    expect(images[0].occurrences).toHaveLength(2)
  })

  it('ignores image URLs used as property keys', () => {
    expect(extractImages('{"https://a.com/x.png": 1}').images).toEqual([])
  })

  it('still extracts from invalid JSON, falling back to line labels', () => {
    const { images, pathsAvailable } = extractImages('{\n "a": "https://a.com/x.png",\n "b": }')
    expect(pathsAvailable).toBe(false)
    expect(images[0].occurrences[0]).toMatchObject({ path: null, pathText: null, label: '第 2 行', line: 2 })
  })

  it('returns an empty result when there are no images', () => {
    expect(extractImages('{"a": "https://a.com"}')).toMatchObject({ images: [], total: 0, pathsAvailable: true, parse: { ok: true } })
  })

  it('exposes the parse error for invalid JSON', () => {
    expect(extractImages('{"a":').parse).toMatchObject({ ok: false, error: { line: 1 } })
  })
})

describe('occurrence index', () => {
  it('finds the occurrence at a position', () => {
    const { images } = extractImages('["https://a.com/1.png", "https://a.com/2.png", "https://a.com/1.png"]')
    const index = buildOccurrenceIndex(images)
    expect(index.map((e) => [e.groupIndex, e.occurrenceIndex])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ])
    expect(occurrenceAt(index, index[2].from + 3)).toMatchObject({ groupIndex: 0, occurrenceIndex: 1 })
    expect(occurrenceAt(index, index[1].to)).toMatchObject({ groupIndex: 1 })
    expect(occurrenceAt(index, 0)).toBeNull()
  })
})
