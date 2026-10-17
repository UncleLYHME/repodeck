import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig, saveConfig, type Config } from '../src/core/config'
import { tempDir } from './helpers'

const DEFAULT_SETTINGS = {
  autoFetch: true, autoPull: true, notify: true, fetchMinutes: 5, updateChecks: true,
  autoUpdate: false, bannerMotion: true, diffLayout: 'side', clock: 'system',
}

function configFile(content: string): string {
  const path = join(tempDir(), 'repos.json')
  writeFileSync(path, content)
  return path
}

describe('config load', () => {
  it('gives the defaults on a first run (no file) and for a corrupt file', () => {
    const missing = loadConfig(join(tempDir(), 'nope.json'))
    expect(missing).toEqual({ settings: DEFAULT_SETTINGS, pinned: [], groups: [] })
    expect(loadConfig(configFile('{ not json'))).toEqual(missing)
  })

  it('reads settings from the snake_case keys RepoDeck 1.x wrote', () => {
    const path = configFile(JSON.stringify({
      auto_fetch: false, auto_pull: false, notify: false, fetch_minutes: 30, update_checks: false,
      auto_update: true, banner_motion: false, diff_layout: 'unified', clock: '24h', pinned: ['/a'],
    }))
    const c = loadConfig(path)
    expect(c.settings).toEqual({
      autoFetch: false, autoPull: false, notify: false, fetchMinutes: 30, updateChecks: false,
      autoUpdate: true, bannerMotion: false, diffLayout: 'unified', clock: '24h',
    })
    expect(c.pinned).toEqual(['/a'])
  })

  it('keeps an explicit false/0 instead of falling back to the default', () => {
    const c = loadConfig(configFile(JSON.stringify({ auto_fetch: false, fetch_minutes: 0 })))
    expect(c.settings.autoFetch).toBe(false)
    expect(c.settings.fetchMinutes).toBe(0)
  })

  it('fills group defaults, drops groups without a folder, and prunes repos that no longer exist', () => {
    const root = tempDir()
    const here = join(root, 'here')
    mkdirSync(here)
    writeFileSync(join(root, 'file.txt'), 'x') // a file is not a repo folder
    const c = loadConfig(configFile(JSON.stringify({
      groups: [
        { folder: root, repos: [here, join(root, 'gone'), join(root, 'file.txt')] },
        { repos: [here] },
        { folder: '/elsewhere', expanded: false, watch: false, auto_pull: false, hidden: ['/x'] },
      ],
    })))
    expect(c.groups).toEqual([
      { folder: root, expanded: true, watch: true, hidden: [], auto_pull: true, repos: [here] },
      { folder: '/elsewhere', expanded: false, watch: false, hidden: ['/x'], auto_pull: false, repos: [] },
    ])
  })

  it('migrates the old flat list of repos into groups by parent folder', () => {
    const root = tempDir()
    const [a, b, c] = ['a', 'b', 'c'].map((n) => join(root, 'one', n))
    const d = join(root, 'two', 'd')
    for (const p of [a, b, c, d]) mkdirSync(p, { recursive: true })
    const cfg = loadConfig(configFile(JSON.stringify([a, d, b, c])))
    expect(cfg.groups.map((g) => [g.folder, g.repos])).toEqual([
      [join(root, 'one'), [a, b, c]],
      [join(root, 'two'), [d]],
    ])
    expect(cfg.groups.every((g) => g.expanded && g.watch && g.auto_pull)).toBe(true)
  })
})

describe('config save', () => {
  const sample = (folder: string): Config => ({
    settings: { ...DEFAULT_SETTINGS, fetchMinutes: 15, diffLayout: 'unified', clock: '12h' } as Config['settings'],
    pinned: ['/z', '/a', '/m'],
    groups: [{ folder, expanded: false, watch: true, hidden: ['/y', '/b'], auto_pull: false, repos: [] }],
  })

  it('round-trips through loadConfig', () => {
    const dir = tempDir()
    const path = join(dir, 'repos.json')
    saveConfig(sample(dir), path)
    const back = loadConfig(path)
    expect(back.settings).toEqual(sample(dir).settings)
    expect(back.groups[0]).toMatchObject({ folder: dir, expanded: false, auto_pull: false })
  })

  it('writes the legacy snake_case keys, sorted pinned/hidden, indented with a trailing newline', () => {
    const dir = tempDir()
    const path = join(dir, 'repos.json')
    saveConfig(sample(dir), path)
    const text = readFileSync(path, 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "auto_fetch": true')
    const data = JSON.parse(text)
    expect(data.pinned).toEqual(['/a', '/m', '/z'])
    expect(data.groups[0].hidden).toEqual(['/b', '/y'])
    expect(data).toMatchObject({ fetch_minutes: 15, diff_layout: 'unified', clock: '12h', update_checks: true, banner_motion: true })
  })

  it('creates missing parent folders, and does not reorder the caller\'s arrays', () => {
    const dir = tempDir()
    const cfg = sample(dir)
    saveConfig(cfg, join(dir, 'deep', 'er', 'repos.json'))
    expect(JSON.parse(readFileSync(join(dir, 'deep', 'er', 'repos.json'), 'utf8')).pinned).toEqual(['/a', '/m', '/z'])
    expect(cfg.pinned).toEqual(['/z', '/a', '/m'])
    expect(cfg.groups[0].hidden).toEqual(['/y', '/b'])
  })
})
