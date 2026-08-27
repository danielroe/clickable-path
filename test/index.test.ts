import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLinker, link, supportsHyperlinks } from '../src'

const tty = { isTTY: true }
const notTty = { isTTY: false }

const OPEN = '\u001B]8;;'
const BEL = '\u0007'
const CLOSE = `${OPEN}${BEL}`

function parse(output: string) {
  const bel = output.indexOf(BEL)
  if (!output.startsWith(OPEN) || bel === -1 || !output.endsWith(CLOSE)) {
    throw new Error(`not an OSC 8 hyperlink: ${JSON.stringify(output)}`)
  }
  return {
    url: output.slice(OPEN.length, bel),
    label: output.slice(bel + 1, output.length - CLOSE.length),
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  for (const key of ['CI', 'FORCE_HYPERLINK', 'NO_COLOR', 'NO_HYPERLINK', 'NO_HYPERLINKS', 'NETLIFY', 'TEAMCITY_VERSION', 'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'VTE_VERSION', 'WT_SESSION', 'CURSOR_TRACE_ID', 'GITHUB_ACTIONS']) {
    vi.stubEnv(key, undefined)
  }
})

describe('link', () => {
  it('should emit exactly the OSC 8 wire format', () => {
    const output = link('src/index.ts', { enabled: true, cwd: '/home/me' })
    expect(JSON.stringify(output)).toMatchInlineSnapshot(`""\\u001b]8;;file:///home/me/src/index.ts\\u0007src/index.ts\\u001b]8;;\\u0007""`)
  })

  it('should label with the cwd-relative path and link the absolute one', () => {
    const output = link('/project/app/src/index.ts', { enabled: true, cwd: '/project/app' })
    expect(parse(output)).toEqual({ label: 'src/index.ts', url: 'file:///project/app/src/index.ts' })
  })

  it('should label paths outside the cwd with dot segments', () => {
    expect(parse(link('/project/other/x.ts', { enabled: true, cwd: '/project/app' })).label).toBe('../other/x.ts')
  })

  it('should label the cwd itself as .', () => {
    expect(parse(link('/project/app', { enabled: true, cwd: '/project/app' })).label).toBe('.')
  })

  it('should return the bare label when disabled', () => {
    expect(link('/project/app/a.ts', { enabled: false, cwd: '/project/app' })).toBe('a.ts')
  })

  it('should normalise dot segments while resolving', () => {
    expect(parse(link('../sibling/./x', { enabled: true, cwd: '/project/app' })).url).toBe('file:///project/sibling/x')
  })

  it('should read process.cwd() at call time', () => {
    const original = process.cwd()
    const directory = mkdtempSync(path.join(tmpdir(), 'clickable-path-'))
    try {
      process.chdir(directory)
      const { url, label } = parse(link('x', { enabled: true }))
      expect(label).toBe('x')
      expect(fileURLToPath(url)).toBe(path.join(process.cwd(), 'x'))
    }
    finally {
      process.chdir(original)
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('should produce a URL that resolves back to a real file on disk', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'clickable-path-'))
    try {
      const file = path.join(directory, 'a file with #hash and \u00E9.ts')
      writeFileSync(file, '')
      const { url, label } = parse(link(file, { enabled: true, cwd: directory }))
      expect(label).toBe('a file with #hash and \u00E9.ts')
      expect(fileURLToPath(url)).toBe(file)
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['/a/my project/file.ts', 'file:///a/my%20project/file.ts'],
    ['/a/c#/file.ts', 'file:///a/c%23/file.ts'],
    ['/a/what?/file.ts', 'file:///a/what%3F/file.ts'],
    ['/a/naïve/日本語.ts', 'file:///a/na%C3%AFve/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts'],
  ])('should percent-encode %s', (input, expected) => {
    expect(parse(link(input, { enabled: true })).url).toBe(expected)
  })

  it.each([
    ['C:\\Users\\me\\project\\nuxt.config.ts', 'file:///C:/Users/me/project/nuxt.config.ts'],
    ['c:/Users/me/a b.ts', 'file:///c:/Users/me/a%20b.ts'],
    ['C:\\', 'file:///C:/'],
    ['\\\\server\\share\\file.ts', 'file://server/share/file.ts'],
  ])('should convert windows path %s to a valid file URL', (input, expected) => {
    expect(parse(link(input, { enabled: true })).url).toBe(expected)
  })

  it('should resolve relative paths against a windows cwd', () => {
    const output = link('src\\x.ts', { enabled: true, cwd: 'D:\\work\\app' })
    expect(parse(output)).toEqual({ label: 'src\\x.ts', url: 'file:///D:/work/app/src/x.ts' })
  })

  it('should emit an id param when given one', () => {
    const output = link('/a/b.ts', { enabled: true, cwd: '/a', id: 'build-output' })
    expect(JSON.stringify(output)).toMatchInlineSnapshot(`""\\u001b]8;id=build-output;file:///a/b.ts\\u0007b.ts\\u001b]8;;\\u0007""`)
    expect(stripVTControlCharacters(output)).toBe('b.ts')
  })

  it.each([
    [{}, { label: 'b.ts', url: 'file:///a/b.ts' }],
    [{ line: 12 }, { label: 'b.ts:12', url: 'file:///a/b.ts#L12' }],
    [{ line: 12, column: 3 }, { label: 'b.ts:12:3', url: 'file:///a/b.ts#L12,3' }],
    [{ column: 3 }, { label: 'b.ts', url: 'file:///a/b.ts' }],
  ])('should show and link the position for %s', (options, expected) => {
    expect(parse(link('/a/b.ts', { enabled: true, cwd: '/a', ...options }))).toEqual(expected)
  })

  it('should show the position when hyperlinks are unsupported', () => {
    expect(link('/a/b.ts', { enabled: false, cwd: '/a', line: 12, column: 3 })).toBe('b.ts:12:3')
  })

  it('should add no visible characters to surrounding output', () => {
    const linked = link('nuxt.config.ts', { enabled: true, cwd: '/project/app' })
    expect(stripVTControlCharacters(`| ${linked} |`)).toBe('| nuxt.config.ts |')
  })
})

describe('createLinker', () => {
  const alias = (absolute: string) => absolute.replace('/project/app', '~')

  it('should label with the configured formatter', () => {
    const { link } = createLinker({ enabled: true, cwd: '/project/app', formatter: alias })
    expect(parse(link('nuxt.config.ts'))).toEqual({ label: '~/nuxt.config.ts', url: 'file:///project/app/nuxt.config.ts' })
  })

  it('should pass the absolute path to the formatter', () => {
    const { link } = createLinker({ enabled: true, cwd: '/project/app', formatter: absolute => absolute })
    expect(parse(link('src/index.ts')).label).toBe('/project/app/src/index.ts')
  })

  it('should fall back to the cwd-relative label without a formatter', () => {
    const { link } = createLinker({ enabled: true, cwd: '/project/app' })
    expect(parse(link('src/index.ts')).label).toBe('src/index.ts')
  })

  it('should apply the formatter to the label printed when unsupported', () => {
    const { link } = createLinker({ enabled: false, cwd: '/project/app', formatter: alias })
    expect(link('a.ts')).toBe('~/a.ts')
  })

  it('should leave a formatted label byte-identical', () => {
    const label = '~/App Data\\nuxt.config.ts'
    const { link } = createLinker({ enabled: true, formatter: () => label })
    expect(stripVTControlCharacters(link('/tmp/x'))).toBe(label)
  })

  it('should pass the line and column to the formatter', () => {
    const { link } = createLinker({
      enabled: true,
      cwd: '/a',
      formatter: (absolute, line, column) => `~${absolute}:${line}:${column}`,
    })
    expect(parse(link('b.ts', { line: 12, column: 3 }))).toEqual({ label: '~/a/b.ts:12:3', url: 'file:///a/b.ts#L12,3' })
  })

  it('should pass undefined line and column when none are given', () => {
    const { link } = createLinker({
      enabled: true,
      cwd: '/a',
      formatter: (absolute, line, column) => `~${absolute}|${line}|${column}`,
    })
    expect(parse(link('b.ts')).label).toBe('~/a/b.ts|undefined|undefined')
  })

  it('should let a formatter drop the position', () => {
    const { link } = createLinker({ enabled: true, cwd: '/a', formatter: absolute => absolute })
    expect(parse(link('b.ts', { line: 12 }))).toEqual({ label: '/a/b.ts', url: 'file:///a/b.ts#L12' })
  })

  it('should allow per-call overrides of the defaults', () => {
    const { link } = createLinker({ enabled: true, cwd: '/project/app', formatter: alias })
    expect(parse(link('a.ts', { formatter: () => 'custom' })).label).toBe('custom')
    expect(parse(link('a.ts', { cwd: '/other' })).url).toBe('file:///other/a.ts')
  })
})

describe('supportsHyperlinks', () => {
  it('should be false for a non-TTY stream', () => {
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app')
    vi.stubEnv('TERM_PROGRAM_VERSION', '3.4.0')
    expect(supportsHyperlinks(notTty)).toBe(false)
    expect(link('/a/a.ts', { stream: notTty, cwd: '/a' })).toBe('a.ts')
  })

  it('should be false in CI', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app')
    vi.stubEnv('TERM_PROGRAM_VERSION', '3.4.0')
    expect(supportsHyperlinks(tty)).toBe(false)
    expect(link('/a/a.ts', { stream: tty, cwd: '/a' })).toBe('a.ts')
  })

  it('should be true on Netlify despite the absent TTY', () => {
    vi.stubEnv('NETLIFY', 'true')
    vi.stubEnv('CI', 'true')
    expect(supportsHyperlinks(notTty)).toBe(true)
  })

  it.each([
    ['1', true],
    ['0', false],
    ['', false],
    ['always', true],
  ])('should honour FORCE_HYPERLINK=%s', (value, expected) => {
    vi.stubEnv('FORCE_HYPERLINK', value)
    expect(supportsHyperlinks(notTty)).toBe(expected)
  })

  it.each(['NO_HYPERLINK', 'NO_HYPERLINKS', 'NO_COLOR'])('should honour %s', (key) => {
    vi.stubEnv('TERM_PROGRAM', 'ghostty')
    vi.stubEnv(key, '1')
    expect(supportsHyperlinks(tty)).toBe(false)
  })

  it.each([
    ['iTerm.app', '3.0.0', false],
    ['iTerm.app', '3.1.0', true],
    ['iTerm.app', '4.0.0', true],
    ['vscode', '1.71.0', false],
    ['vscode', '1.72.0', true],
    ['vscode', '2.0.0', true],
    ['WezTerm', '20200619-000000-abc', false],
    ['WezTerm', '20200620-160318-e00b076c', true],
    ['WezTerm', '0-unstable-2020-06-19', false],
    ['WezTerm', '0-unstable-2024-01-01', true],
    ['ghostty', '1.0.0', true],
    ['zed', '0.1.0', true],
    ['rio', '0.1.0', true],
    ['Tabby', '1.0.0', true],
    ['WarpTerminal', 'v0.2024', true],
    ['Orca', '1.0.0', true],
    ['tmux', '3.3a', false],
    ['tmux', '3.4', true],
    ['tmux', '3.5a', true],
    ['Apple_Terminal', '453', false],
    ['Hyper', '3.0.0', false],
  ])('should detect TERM_PROGRAM=%s %s as %s', (program, version, expected) => {
    vi.stubEnv('TERM_PROGRAM', program)
    vi.stubEnv('TERM_PROGRAM_VERSION', version)
    expect(supportsHyperlinks(tty)).toBe(expected)
  })

  it.each(['iTerm.app', 'WezTerm', 'vscode'])('should be false for %s without a reported version', (program) => {
    vi.stubEnv('TERM_PROGRAM', program)
    expect(supportsHyperlinks(tty)).toBe(false)
  })

  it('should detect Cursor on its own version line', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode')
    vi.stubEnv('TERM_PROGRAM_VERSION', '0.40.0')
    expect(supportsHyperlinks(tty)).toBe(false)
    vi.stubEnv('CURSOR_TRACE_ID', 'abc')
    expect(supportsHyperlinks(tty)).toBe(true)
  })

  it.each([
    ['0.49.0', false],
    ['0.50.0', false],
    ['0.50.1', true],
    ['0.60.0', true],
    ['1.0.0', true],
    ['5002', true],
    ['4901', false],
  ])('should detect VTE_VERSION=%s as %s', (version, expected) => {
    vi.stubEnv('VTE_VERSION', version)
    expect(supportsHyperlinks(tty)).toBe(expected)
  })

  it.each([
    ['xterm-kitty', true],
    ['xterm-ghostty', true],
    ['alacritty', true],
    ['xterm-256color', false],
    ['dumb', false],
  ])('should detect TERM=%s as %s', (term, expected) => {
    vi.stubEnv('TERM', term)
    expect(supportsHyperlinks(tty)).toBe(expected)
  })

  it('should be false on TeamCity', () => {
    vi.stubEnv('TEAMCITY_VERSION', '2024.1')
    vi.stubEnv('TERM', 'xterm-kitty')
    expect(supportsHyperlinks(tty)).toBe(false)
  })

  describe('win32', () => {
    const platform = process.platform

    function setPlatform(value: string) {
      Object.defineProperty(process, 'platform', { value, configurable: true })
    }

    afterEach(() => setPlatform(platform))

    it('should be true inside Windows Terminal', () => {
      setPlatform('win32')
      vi.stubEnv('WT_SESSION', 'ffb0b1f4')
      expect(supportsHyperlinks(tty)).toBe(true)
    })

    it('should be false in the legacy console', () => {
      setPlatform('win32')
      vi.stubEnv('TERM', 'xterm-256color')
      expect(supportsHyperlinks(tty)).toBe(false)
    })
  })
})
