// Settings and the folder list, in the same repos.json RepoDeck 1.x wrote.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '../shared/types'
import { configDir } from './paths'

export interface GroupConfig {
  folder: string
  expanded: boolean
  watch: boolean
  hidden: string[] // removed by hand: never auto-add these again
  auto_pull: boolean
  repos: string[]
}

export interface Config {
  settings: Omit<Settings, 'autostart'>
  pinned: string[]
  groups: GroupConfig[]
}

export const configPath = (): string => join(configDir(), 'repos.json')

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Settings plus groups; the old flat list of repos is grouped by parent folder. */
export function loadConfig(path = configPath()): Config {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // first run
  }
  if (Array.isArray(data)) {
    const groups = new Map<string, string[]>()
    for (const repo of data as string[]) {
      const folder = dirname(repo)
      groups.set(folder, [...(groups.get(folder) ?? []), repo])
    }
    data = { groups: [...groups.entries()].map(([folder, repos]) => ({ folder, expanded: true, repos })) }
  }
  const raw = (data.groups as Partial<GroupConfig>[] | undefined) ?? []
  const groups: GroupConfig[] = raw.filter((g) => g.folder).map((g) => ({
    folder: g.folder!,
    expanded: g.expanded ?? true,
    watch: g.watch ?? true,
    hidden: g.hidden ?? [],
    auto_pull: g.auto_pull ?? true,
    repos: (g.repos ?? []).filter(isDir),
  }))
  const get = <T>(key: string, fallback: T): T => (data[key] === undefined ? fallback : (data[key] as T))
  return {
    settings: {
      autoFetch: get('auto_fetch', true),
      autoPull: get('auto_pull', true),
      notify: get('notify', true),
      fetchMinutes: get('fetch_minutes', 5),
      updateChecks: get('update_checks', true),
      autoUpdate: get('auto_update', false),
      bannerMotion: get('banner_motion', true),
      diffLayout: get('diff_layout', 'side'),
    },
    pinned: get('pinned', [] as string[]),
    groups,
  }
}

export function saveConfig(config: Config, path = configPath()): void {
  const s = config.settings
  const data = {
    auto_fetch: s.autoFetch, auto_pull: s.autoPull, notify: s.notify, fetch_minutes: s.fetchMinutes,
    update_checks: s.updateChecks, auto_update: s.autoUpdate, banner_motion: s.bannerMotion, diff_layout: s.diffLayout,
    pinned: [...config.pinned].sort(),
    groups: config.groups.map((g) => ({ ...g, hidden: [...g.hidden].sort() })),
  }
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}
