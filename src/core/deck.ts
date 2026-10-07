// The deck: folders of repositories, settings, background fetch, and the repo controllers.

import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { DeckState, GroupState, HistoryState, RepoState, Settings } from '../shared/types'
import { basename, plural } from '../shared/time'
import { childRepos, findRepos, status as gitStatus, toplevel } from './git/status'
import { backgroundFetch } from './git/sync'
import { type Config, loadConfig, saveConfig } from './config'
import { log } from './activity'
import { network } from './scheduler'
import { RepoController } from './repo'
import { FolderWatcher } from './watch'
import { autostartEnabled, setAutostart } from './platform/autostart'

const FETCH_CHECK_MS = 30_000
const FIRST_FETCH_MS = 5_000
const SAFETY_REFRESH_MS = 60_000 // file events drive updates; this only refreshes relative dates and catches misses

export interface DeckHost {
  emit(name: string, data: unknown): void
  settingsChanged?(settings: Config['settings']): void
  announce(message: string, body?: string, key?: string, uri?: string): void
  toast(message: string): void
}

interface Group {
  folder: string
  expanded: boolean
  watching: boolean
  hidden: Set<string>
  autoPull: boolean
  repos: string[]
  watcher: FolderWatcher
}

export class Deck {
  settings: Config['settings']
  pinned: Set<string>
  groups: Group[] = []
  repos = new Map<string, RepoController>()
  private timers: ReturnType<typeof setInterval>[] = []

  constructor(private host: DeckHost, readonly appDir: string) {
    const config = loadConfig()
    this.settings = config.settings
    this.pinned = new Set(config.pinned)
    for (const g of config.groups) {
      if (!g.repos.length && !g.watch) continue
      const group = this.addGroup(g.folder, g.expanded, g.watch, g.hidden, g.auto_pull)
      for (const repo of g.repos) this.addRepo(group, repo)
      this.syncFolder(group) // pick up projects created or deleted while the app was closed
    }
    this.timers.push(setInterval(() => this.fetchDue(), FETCH_CHECK_MS))
    this.timers.push(setInterval(() => void this.refreshAll(), SAFETY_REFRESH_MS))
    setTimeout(() => this.fetchDue(), FIRST_FETCH_MS).unref?.()
  }

  close(): void {
    for (const t of this.timers) clearInterval(t)
    for (const g of this.groups) g.watcher.close()
    for (const r of this.repos.values()) r.close()
  }

  // -- state ------------------------------------------------------------------------------

  state(): DeckState {
    const settings: Settings = { ...this.settings, autostart: autostartEnabled() }
    const groups: GroupState[] = this.groups.map((g) => ({
      folder: g.folder, expanded: g.expanded, watching: g.watching, autoPull: g.autoPull, repos: [...g.repos],
    }))
    return { settings, groups, pinned: [...this.pinned] }
  }

  repoStates(): RepoState[] {
    return [...this.repos.values()].map((r) => r.state())
  }

  histories(): HistoryState[] {
    return [...this.repos.values()].map((r) => r.history()).filter((h): h is HistoryState => h !== null)
  }

  /** Persist and tell the renderer. */
  save(): void {
    saveConfig({
      settings: this.settings,
      pinned: [...this.pinned],
      groups: this.groups.map((g) => ({
        folder: g.folder, expanded: g.expanded, watch: g.watching, auto_pull: g.autoPull,
        hidden: [...g.hidden], repos: [...g.repos],
      })),
    })
    this.host.emit('deck', this.state())
  }

  repo(path: string): RepoController {
    const r = this.repos.get(path)
    if (!r) throw new Error(`Not in the deck: ${path}`)
    return r
  }

  allPaths(): string[] {
    return this.groups.flatMap((g) => g.repos)
  }

  // -- folders & repos ----------------------------------------------------------------------

  private addGroup(folder: string, expanded: boolean, watching: boolean, hidden: string[] = [], autoPull = true): Group {
    const group: Group = {
      folder, expanded, watching, hidden: new Set(hidden), autoPull, repos: [],
      watcher: new FolderWatcher(folder, () => {
        if (this.groups.includes(group)) this.syncFolder(group, true)
      }),
    }
    this.groups.push(group)
    return group
  }

  private addRepo(group: Group, path: string): void {
    group.hidden.delete(path)
    if (this.repos.has(path)) return
    group.repos.push(path)
    this.repos.set(path, new RepoController(path, {
      autoPullFor: (p) => this.autoPullFor(p),
      announce: (...args) => this.host.announce(...args),
      emitState: (s) => this.host.emit('repo', s),
      emitHistory: (h) => this.host.emit('history', h),
    }))
  }

  private dropRepo(group: Group, path: string, hide: boolean): void {
    this.repos.get(path)?.close()
    this.repos.delete(path)
    group.repos = group.repos.filter((p) => p !== path)
    if (hide) group.hidden.add(path)
    this.host.emit('repoRemoved', path)
  }

  /** Folder event: drop projects that are gone, add new ones when watching. */
  syncFolder(group: Group, announce = false): void {
    const gone = group.repos.filter((p) => !existsSync(`${p}/.git`))
    for (const p of gone) this.dropRepo(group, p, false)
    const known = new Set([...this.allPaths(), ...group.hidden])
    const added = group.watching ? childRepos(group.folder).filter((r) => !known.has(r)) : []
    for (const p of added) this.addRepo(group, p)
    if (!added.length && !gone.length) return
    this.save()
    if (announce) {
      const names = (added.length ? added : gone).map(basename).join(', ')
      this.host.toast(`${added.length ? 'Added' : 'Removed'} ${names}`)
    }
    for (const p of added) log('New project found in the folder and added', p, 'auto')
    for (const p of gone) log('Project removed from the folder; dropped from the deck', p, 'auto')
  }

  async addFolders(folders: string[]): Promise<string> {
    let added = 0
    const notes: string[] = []
    for (const raw of folders) {
      if (!isDir(raw)) {
        notes.push(`Not a folder: ${raw}`)
        continue
      }
      // A single repo joins its parent folder's section; a folder of projects gets its own
      // section, which keeps watching for new projects.
      const root = await toplevel(raw)
      const section = root ? dirname(root) : resolve(raw)
      let group = this.groups.find((g) => g.folder === section)
      if (!group) group = this.addGroup(section, true, !root)
      else if (!root) group.watching = true
      group.expanded = true
      const known = new Set(this.allPaths())
      const repos = (await findRepos(raw)).filter((r) => !known.has(r))
      for (const r of repos) this.addRepo(group, r)
      if (!root) this.syncFolder(group)
      added += repos.length
      if (!repos.length && !group.repos.length) notes.push(`Watching ${basename(section)} for new projects`)
    }
    this.save()
    if (added) {
      log(`Added ${plural(added, 'repository')} from ${folders.map(basename).join(', ')}`)
      notes.unshift(`Added ${plural(added, 'repository')}`)
    }
    return notes.join(' · ') || 'Those repositories are already in the deck'
  }

  removeGroup(folder: string): void {
    const group = this.groups.find((g) => g.folder === folder)
    if (!group) return
    log(`Removed folder ${basename(folder)} from the deck`)
    group.watcher.close()
    for (const p of [...group.repos]) this.dropRepo(group, p, false)
    this.groups = this.groups.filter((g) => g !== group)
    this.save()
  }

  removeRepo(path: string): void {
    const group = this.groups.find((g) => g.repos.includes(path))
    if (!group) return
    this.dropRepo(group, path, true)
    if (!group.repos.length && !group.watching) {
      group.watcher.close()
      this.groups = this.groups.filter((g) => g !== group)
    }
    this.save()
  }

  setGroup(folder: string, change: { expanded?: boolean; watching?: boolean; autoPull?: boolean }): void {
    const group = this.groups.find((g) => g.folder === folder)
    if (!group) return
    if (change.expanded !== undefined) group.expanded = change.expanded
    if (change.autoPull !== undefined) {
      group.autoPull = change.autoPull
      for (const p of group.repos) this.repos.get(p)?.maybeAutoPull()
    }
    if (change.watching !== undefined) {
      group.watching = change.watching
      this.syncFolder(group, true)
    }
    this.save()
  }

  toggleAll(): void {
    const expand = !this.groups.some((g) => g.expanded)
    for (const g of this.groups) g.expanded = expand
    this.save()
  }

  togglePin(path: string): void {
    if (this.pinned.has(path)) this.pinned.delete(path)
    else this.pinned.add(path)
    this.save()
  }

  // -- settings -------------------------------------------------------------------------------

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    if (key === 'autostart') {
      await setAutostart(Boolean(value), this.appDir)
    } else {
      ;(this.settings as Record<string, unknown>)[key] = value
      if (key === 'autoPull' && value) for (const r of this.repos.values()) r.maybeAutoPull() // catch up on fetched commits
    }
    this.save()
    this.host.settingsChanged?.(this.settings)
  }

  /** Auto-pull is on globally and for the folder this repo is in. */
  autoPullFor(path: string): boolean {
    const group = this.groups.find((g) => g.repos.includes(path))
    return this.settings.autoPull && (!group || group.autoPull)
  }

  /** Resolves once every repo has been re-read. */
  async refreshAll(): Promise<void> {
    await Promise.all([...this.repos.values()].map((r) => r.refresh()))
  }

  // -- background fetch ------------------------------------------------------------------------

  private fetchDue(): void {
    if (this.settings.autoFetch) void this.fetchAll(true)
  }

  /** Fetch every repo (or only those due); resolves when all of those fetches finished. */
  async fetchAll(dueOnly = false): Promise<void> {
    const interval = this.settings.fetchMinutes * 60_000
    const now = Date.now()
    const runs: Promise<void>[] = []
    for (const r of this.repos.values()) {
      if (r.fetching || (dueOnly && now - r.lastFetch < interval)) continue
      r.fetching = true
      const behind = r.status?.behind ?? 0
      runs.push(network.run(async () => {
        try {
          const fresh = (await backgroundFetch(r.path)) ? await gitStatus(r.path) : null
          r.fetchFinished(null, behind, fresh)
        } catch (e) {
          r.fetchFinished(e, behind, null) // offline, auth needed, timeout
        }
      }))
    }
    await Promise.all(runs)
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
