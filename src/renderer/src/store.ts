// App state: what the core pushes (deck, repos, histories, activity, GitHub, updates) plus UI state.

import { useMemo } from 'react'
import { create } from 'zustand'
import type {
  ActivityEntry, Capabilities, CommitFile, DeckState, GithubDashboard, LogRow, RepoState, UpdateAction, UpdateStatus,
} from '@shared/types'
import { basename } from '@shared/time'
import { api, host, on } from './bridge'

export type Page = 'home' | 'projects' | 'project' | 'activity'

export type Sheet =
  | { kind: 'compare'; title: string; subtitle: string; filename: string; repo: string; source: { file: string } | { sha: string; file: CommitFile } }
  | { kind: 'hunks'; repo: string; file: string }
  | { kind: 'commit'; repo: string; sha: string; title: string; subtitle: string }

export interface Confirm {
  heading: string
  body: string
  confirm: string
  cancel?: string
  destructive?: boolean
  resolve: (ok: boolean) => void
}

export interface Toast {
  id: number
  message: string
  leaving?: boolean
}

interface State {
  ready: boolean
  version: string
  capabilities: Capabilities
  configDir: string
  deck: DeckState | null
  repos: Record<string, RepoState>
  histories: Record<string, LogRow[]>
  activity: ActivityEntry[]
  unseenProblems: number
  github: GithubDashboard | null
  update: UpdateStatus | null
  packaged: boolean // installed copy (updates through main), not a checkout (updates through the core)
  systemHour12: boolean // the system's clock uses AM/PM
  dismissed: string[] // "phase:version" popups the user said Later to this session
  page: Page
  projectPath: string | null
  flash: string | null // repo panel to scroll to and highlight
  toasts: Toast[]
  drafts: Record<string, string> // commit messages per repo
  excluded: Record<string, string[]> // unchecked changes per repo; survive refreshes
  sheet: Sheet | null
  confirm: Confirm | null
  alert: { heading: string; body: string } | null
  identityFor: string | null
  prefsOpen: boolean
  sideOpen: boolean // the sidebar drawer in narrow windows
  refreshing: number // refreshes and fetch-alls in flight (the refresh button spins)
}

export const useStore = create<State>(() => ({
  ready: false,
  version: '',
  capabilities: { code: false, platform: 'linux' },
  configDir: '',
  deck: null,
  repos: {},
  histories: {},
  activity: [],
  unseenProblems: 0,
  github: null,
  update: null,
  packaged: false,
  systemHour12: false,
  dismissed: [],
  page: 'home',
  projectPath: null,
  flash: null,
  toasts: [],
  drafts: {},
  excluded: {},
  sheet: null,
  confirm: null,
  alert: null,
  identityFor: null,
  prefsOpen: false,
  sideOpen: false,
  refreshing: 0,
}))

/** Show times with AM/PM: the Clock preference, or the system's clock when it's "System". */
export const useHour12 = (): boolean => useStore((s) => {
  const clock = s.deck?.settings.clock
  return clock === '12h' || (clock !== '24h' && s.systemHour12)
})

const set = useStore.setState
const get = useStore.getState

// -- from the core --------------------------------------------------------------------------------

async function load(): Promise<void> {
  const snap = await api.snapshot()
  set({
    ready: true,
    version: snap.version,
    capabilities: snap.capabilities,
    configDir: snap.configDir,
    deck: snap.deck,
    repos: Object.fromEntries(snap.repos.map((r) => [r.path, r])),
    histories: Object.fromEntries(snap.histories.map((h) => [h.path, h.rows])),
    activity: snap.activity,
  })
  const app = await host.appInfo()
  set({ packaged: app.packaged, update: app.packaged ? app.update : snap.update, systemHour12: app.hour12 })
}

export async function init(): Promise<void> {
  on('deck', (deck) => set({ deck }))
  on('repo', (r) => set((s) => ({ repos: { ...s.repos, [r.path]: r } })))
  on('history', (h) => set((s) => ({ histories: { ...s.histories, [h.path]: h.rows } })))
  on('repoRemoved', (path) => set((s) => {
    const repos = { ...s.repos }
    const histories = { ...s.histories }
    delete repos[path]
    delete histories[path]
    const leaving = s.page === 'project' && s.projectPath === path
    return { repos, histories, ...(leaving ? { page: 'home' as Page, projectPath: null } : {}) }
  }))
  on('activity', (entry) => set((s) => {
    if (!entry) return { activity: [], unseenProblems: 0 }
    const problem = entry.level !== 'info' && s.page !== 'activity'
    return { activity: [...s.activity.slice(-499), entry], unseenProblems: s.unseenProblems + (problem ? 1 : 0) }
  }))
  on('github', (github) => set({ github }))
  on('update', (update) => set({ update }))
  on('toast', (message) => toast(message))
  on('openFolders', (paths) => void addFolders(paths))
  on('reconnected', () => void load())
  await load()
  const initial = await host.initialFolders()
  if (initial.length) await addFolders(initial)
}

// -- feedback --------------------------------------------------------------------------------------

let toastId = 0

export function toast(message: string): void {
  const id = ++toastId
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message }] }))
  setTimeout(() => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })), 3000)
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
}

export function showAlert(heading: string, body: string): void {
  set({ alert: { heading, body } })
}

export function confirm(c: Omit<Confirm, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => set({ confirm: { ...c, resolve } }))
}

/** Run a repo action: a toast when it worked, an alert with the reason when it didn't. */
export async function runOp(repo: string, action: () => Promise<string>): Promise<boolean> {
  try {
    toast(await action())
    return true
  } catch (e) {
    showAlert(`${basename(repo)}: action failed`, (e as Error).message)
    return false
  }
}

// -- navigation ---------------------------------------------------------------------------------------

export function showPage(page: Page): void {
  set(page === 'activity' ? { page, unseenProblems: 0, sideOpen: false } : { page, sideOpen: false })
}

/** The analytics page for one repository. */
export function showProject(path: string): void {
  set({ page: 'project', projectPath: path, sideOpen: false })
}

/** A repo's panel on the Projects page: open its folder, scroll to it and flash it. */
export function openProject(path: string): void {
  const group = get().deck?.groups.find((g) => g.repos.includes(path))
  if (!group) return
  if (!group.expanded) void api.setGroup(group.folder, { expanded: true })
  set({ page: 'projects', flash: path })
  setTimeout(() => set((s) => (s.flash === path ? { flash: null } : {})), 1600)
}

export async function addFolders(paths: string[]): Promise<void> {
  if (!paths.length) return
  try {
    toast(await api.addFolders(paths))
    set({ page: 'projects' })
  } catch (e) {
    showAlert("Couldn't add that folder", (e as Error).message)
  }
}

export async function chooseFolders(): Promise<void> {
  await addFolders(await host.chooseFolders())
}

/** RepoDeck's own update: installed copies ask main, checkouts ask the core. */
export async function updateAction(action: UpdateAction, announce = false): Promise<void> {
  try {
    const status = get().packaged ? await host.update(action) : await api.update(action)
    if (status) set({ update: status })
    if (announce && status?.phase === 'up-to-date') toast(`RepoDeck ${get().version} is up to date`)
    if (announce && status?.phase === 'error') toast(`Couldn't check for updates: ${status.error ?? 'unknown error'}`)
  } catch (e) {
    showAlert('Update failed', (e as Error).message)
  }
}

/** Show the update popup again after "Later". */
export function showUpdate(): void {
  set({ dismissed: [] })
}

/** Count `work` as a refresh in flight while it runs. */
async function whileRefreshing(work: Promise<unknown>): Promise<void> {
  set((s) => ({ refreshing: s.refreshing + 1 }))
  try {
    await work
  } catch {
    // failures show up per repo (⚠, activity log); the button just stops
  } finally {
    set((s) => ({ refreshing: s.refreshing - 1 }))
  }
}

/** F5: everything, including GitHub data that's normally reused for a while. */
export function refreshNow(): Promise<void> {
  window.dispatchEvent(new Event('repodeck:reload'))
  return whileRefreshing(Promise.all([
    api.refreshAll(),
    api.github(true).then((github) => set({ github }), () => {}),
  ]))
}

export function fetchAllNow(): Promise<void> {
  return whileRefreshing(api.fetchAll())
}

// -- per-repo UI state ------------------------------------------------------------------------------

export function setDraft(repo: string, text: string): void {
  set((s) => ({ drafts: { ...s.drafts, [repo]: text } }))
}

export function setExcluded(repo: string, paths: string[]): void {
  set((s) => ({ excluded: { ...s.excluded, [repo]: paths } }))
}

export function openSheet(sheet: Sheet | null): void {
  set({ sheet })
}

/** Pinned first, then by name. */
export function sortedRepos(paths: string[], pinned: string[]): string[] {
  const pins = new Set(pinned)
  return [...paths].sort((a, b) => Number(pins.has(b)) - Number(pins.has(a)) || basename(a).localeCompare(basename(b), undefined, { sensitivity: 'base' }))
}

const NONE: string[] = []

/** Every repo in the deck, in folder order (stable between renders while the deck is unchanged). */
export function useRepoPaths(): string[] {
  const groups = useStore((s) => s.deck?.groups)
  return useMemo(() => groups?.flatMap((g) => g.repos) ?? NONE, [groups])
}

export function usePinned(): string[] {
  return useStore((s) => s.deck?.pinned) ?? NONE
}
