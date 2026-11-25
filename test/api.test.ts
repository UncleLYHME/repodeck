// What the page can ask of the core, called the way the page calls it: with whatever it likes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handlers, type Host } from '../src/core/api'
import { Deck } from '../src/core/deck'
import { GitError, run } from '../src/core/git/run'
import { log, status } from '../src/core/git/status'
import type { CheckoutUpdates, GithubWatch } from '../src/core/services'
import { Invalid } from '../src/core/validate'
import { commitAll, tempDir, write } from './helpers'

const saved = { config: process.env.REPODECK_CONFIG_DIR, xdg: process.env.XDG_CONFIG_HOME }
let config: string
let repo: string
let deck: Deck
let host: Record<'trash' | 'relaunch' | 'chosen' | 'confirmWatch', ReturnType<typeof vi.fn>>

const github = { result: null, refresh: async () => ({ prs: { review: [], mine: [] }, ci: [], error: null }) } as unknown as GithubWatch
const api = (updates: CheckoutUpdates | null = null) => handlers(deck, github, updates, host as unknown as Host, '0.0.0')

beforeEach(async () => {
  const root = tempDir()
  config = join(root, 'config')
  mkdirSync(config)
  writeFileSync(join(config, 'repos.json'), JSON.stringify({ auto_fetch: false, auto_pull: false }))
  process.env.REPODECK_CONFIG_DIR = config
  process.env.XDG_CONFIG_HOME = join(root, 'xdg') // Start on Login would write here, not into the real home
  repo = join(root, 'work', 'r')
  mkdirSync(repo, { recursive: true })
  await run(repo, ['init', '-q', '-b', 'main'])
  write(repo, 'a.txt', 'one\n')
  await commitAll(repo, 'base')
  deck = new Deck({ emit: () => {}, announce: () => {}, toast: () => {} }, root)
  await deck.addFolders([repo])
  await deck.refreshAll()
  host = { trash: vi.fn(async () => {}), relaunch: vi.fn(async () => {}), chosen: vi.fn(async () => true), confirmWatch: vi.fn(async () => true) }
})

afterEach(() => {
  deck.close()
  for (const [key, value] of [['REPODECK_CONFIG_DIR', saved.config], ['XDG_CONFIG_HOME', saved.xdg]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('core api', () => {
  it('touches only repositories in the deck', async () => {
    const other = tempDir()
    await run(other, ['init', '-q', '-b', 'main'])
    const a = api()
    expect(() => a.branches({ repo: other })).toThrow('Not in the deck')
    expect(() => a.commit({ repo: other, message: 'm', paths: ['a.txt'] })).toThrow('Not in the deck')
    expect(() => a.showCommit({ repo: other, sha: 'abcd1234' })).toThrow('Not in the deck')
    expect((await a.branches({ repo })).current).toBe('main')
  })

  it('adds a folder only when the user chose it', async () => {
    const other = join(tempDir(), 'elsewhere')
    mkdirSync(other)
    await run(other, ['init', '-q', '-b', 'main'])
    const a = api()
    host.chosen.mockResolvedValue(false) // the page asking by itself: main never saw the user pick it
    await expect(a.addFolders({ paths: [other] })).rejects.toThrow('Only a folder you chose can be added.')
    expect(deck.allPaths()).toEqual([repo])
    expect(deck.state().groups.map((g) => g.folder)).not.toContain(dirname(other))

    host.chosen.mockResolvedValue(true)
    await a.addFolders({ paths: [other] })
    expect(host.chosen).toHaveBeenLastCalledWith([other])
    expect(deck.allPaths()).toEqual([repo, other])
  })

  it("shows a folder's other projects only once the user said so", async () => {
    const folder = dirname(repo) // in the deck because one repository in it was chosen
    const sibling = join(folder, 'never-chosen')
    mkdirSync(sibling)
    await run(sibling, ['init', '-q', '-b', 'main'])
    const a = api()
    const watching = () => deck.state().groups.find((g) => g.folder === folder)!.watching
    expect(watching()).toBe(false)

    host.confirmWatch.mockResolvedValue(false) // the page asking by itself; the user said no, or was never asked
    await a.setGroup({ folder, watching: true })
    expect([watching(), deck.allPaths()]).toEqual([false, [repo]])
    expect(host.confirmWatch).toHaveBeenLastCalledWith(folder)

    host.confirmWatch.mockResolvedValue(true)
    await a.setGroup({ folder, watching: true })
    expect([watching(), deck.allPaths()]).toEqual([true, [repo, sibling]])

    // nothing else about a group needs asking, and neither does a folder that is shown already
    host.confirmWatch.mockClear()
    await a.setGroup({ folder, watching: true })
    await a.setGroup({ folder, autoPull: false })
    await a.setGroup({ folder, watching: false })
    await a.setGroup({ folder: '/no/such/group', watching: true })
    expect(host.confirmWatch).not.toHaveBeenCalled()
    expect(watching()).toBe(false)
  })

  it('refuses arguments of the wrong type before anything runs', () => {
    const a = api()
    expect(() => a.commit({ repo, message: 5, paths: ['a.txt'] })).toThrow(Invalid)
    expect(() => a.commit({ repo, message: 'm', paths: 'a.txt' })).toThrow(Invalid)
    expect(() => a.discard({ repo, paths: [{}] })).toThrow(Invalid)
    expect(() => a.addFolders({ paths: '/tmp' })).toThrow(Invalid)
    expect(() => a.addFolders(['/tmp'])).toThrow(Invalid)
    expect(() => a.setGroup({ folder: '/x', watching: 'yes' })).toThrow(Invalid)
    expect(() => a.applyHunk({ repo, patch: '', mode: 'constructor' })).toThrow(Invalid)
    expect(() => a.branches(undefined)).toThrow(Invalid)
    expect(() => a.projectStats({ repo, branch: ['main'] })).toThrow(Invalid)
  })

  it('reads commits by hash only, so git cannot be told to write a file', async () => {
    const a = api()
    const [row] = await log(repo, await status(repo))
    expect((await a.commitFiles({ repo, sha: row.fullSha })).map((f) => f.path)).toEqual(['a.txt'])
    expect(await a.showCommit({ repo, sha: row.fullSha })).toContain('base')
    const file = { path: 'a.txt', letter: 'A', orig: null }
    expect(await a.compareCommit({ repo, sha: row.fullSha, file })).toEqual({ old: '', new: 'one\n' })

    const target = join(tempDir(), 'written-by-git')
    for (const sha of [`--output=${target}`, 'HEAD', '', null]) {
      expect(() => a.showCommit({ repo, sha })).toThrow()
      expect(() => a.commitFiles({ repo, sha })).toThrow()
      expect(() => a.compareCommit({ repo, sha, file })).toThrow()
    }
    expect(existsSync(target)).toBe(false)
  })

  it('switches only to a branch name, never an option', async () => {
    const a = api()
    await expect(a.switchBranch({ repo, name: '--orphan=wiped' })).rejects.toBeInstanceOf(GitError)
    await expect(a.switchRemote({ repo, ref: '--orphan=wiped/x' })).rejects.toBeInstanceOf(GitError)
    expect((await status(repo)).branch).toBe('main')
    expect(existsSync(join(repo, 'a.txt'))).toBe(true)
  })

  it('changes only known settings, to values of their type', async () => {
    const a = api()
    const proto = Object.getPrototypeOf(deck.settings)
    for (const key of ['__proto__', 'constructor', 'nope']) expect(() => a.setSetting({ key, value: { polluted: true } })).toThrow('Unknown setting')
    expect(Object.getPrototypeOf(deck.settings)).toBe(proto)
    expect(Object.keys(deck.settings)).not.toContain('nope')
    for (const value of [0, 0.001, -3, '5', null]) expect(() => a.setSetting({ key: 'fetchMinutes', value })).toThrow(Invalid)
    expect(() => a.setSetting({ key: 'clock', value: 'bogus' })).toThrow(Invalid)
    expect(deck.settings.fetchMinutes).toBe(5)

    await a.setSetting({ key: 'fetchMinutes', value: 15 })
    await a.setSetting({ key: 'diffLayout', value: 'unified' })
    expect([deck.settings.fetchMinutes, deck.settings.diffLayout]).toEqual([15, 'unified'])
    expect(JSON.parse(readFileSync(join(config, 'repos.json'), 'utf8'))).toMatchObject({ fetch_minutes: 15, diff_layout: 'unified' })
  })

  it('changes only the parts of a group it is given', async () => {
    const a = api()
    const [before] = deck.state().groups
    await a.setGroup({ folder: before.folder, autoPull: true })
    await a.setGroup({ folder: before.folder, expanded: !before.expanded }) // collapsing must not touch the rest
    const [after] = deck.state().groups
    expect(after).toMatchObject({ expanded: !before.expanded, autoPull: true, watching: before.watching })
  })

  it('pins only repositories in the deck', () => {
    const a = api()
    expect(() => a.togglePin({ path: '/not/in/the/deck' })).toThrow('Not in the deck')
    expect(deck.state().pinned).toEqual([])
    a.togglePin({ path: repo })
    expect(deck.state().pinned).toEqual([repo])
    a.togglePin({ path: repo })
    expect(deck.state().pinned).toEqual([])
  })

  it('restarts only when asked to restart', async () => {
    const updates = { status: { phase: 'ready', version: '9.9.9' }, check: vi.fn(), download: vi.fn() } as unknown as CheckoutUpdates
    const a = api(updates)
    for (const action of ['reboot', '', undefined, 3]) expect(() => a.update({ action })).toThrow(Invalid)
    expect(host.relaunch).not.toHaveBeenCalled()
    await a.update({ action: 'restart' })
    expect(host.relaunch).toHaveBeenCalledOnce()
    await expect(api(null).update({ action: 'restart' })).rejects.toThrow('updates through its installer')
  })
})
