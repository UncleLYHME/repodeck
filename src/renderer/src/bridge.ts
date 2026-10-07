// Typed calls into the core (git, stats, settings) and main (dialogs, links, editors).

import type {
  ActivityEntry, Branches, CommitFile, CompareTexts, DashboardActivity, DataInfo, DeckState, GithubDashboard,
  HistoryState, HunkSet, Profile, ProjectGithub, ProjectStats, RepoState, Services, Settings, Snapshot, UpdateInfo,
} from '@shared/types'
import type { RepoDeckBridge } from '../../preload/api'

const bridge = (): RepoDeckBridge => window.repodeck
const call = <T,>(method: string, args?: unknown) => bridge().call<T>(method, args)

export const api = {
  snapshot: () => call<Snapshot>('snapshot'),
  addFolders: (paths: string[]) => call<string>('addFolders', { paths }),
  removeGroup: (folder: string) => call('removeGroup', { folder }),
  setGroup: (folder: string, change: { expanded?: boolean; watching?: boolean; autoPull?: boolean }) =>
    call('setGroup', { folder, ...change }),
  toggleAll: () => call('toggleAll'),
  removeRepo: (path: string) => call('removeRepo', { path }),
  togglePin: (path: string) => call('togglePin', { path }),
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => call('setSetting', { key, value }),
  refreshAll: () => call('refreshAll'),
  fetchAll: () => call('fetchAll'),

  commit: (repo: string, message: string, paths: string[]) => call<string>('commit', { repo, message, paths }),
  discard: (repo: string, paths: string[]) => call<string>('discard', { repo, paths }),
  ignore: (repo: string, pattern: string, untrack: string[]) => call<string>('ignore', { repo, pattern, untrack }),
  fetch: (repo: string) => call<string>('fetch', { repo }),
  pull: (repo: string) => call<string>('pull', { repo }),
  push: (repo: string) => call<string>('push', { repo }),
  stash: (repo: string) => call<string>('stash', { repo }),
  stashPop: (repo: string) => call<string>('stashPop', { repo }),
  abort: (repo: string) => call<string>('abort', { repo }),
  setIdentity: (repo: string, name: string, email: string) => call<string>('setIdentity', { repo, name, email }),
  profiles: () => call<Profile[]>('profiles'),
  branches: (repo: string) => call<Branches>('branches', { repo }),
  switchBranch: (repo: string, name: string) => call<string>('switchBranch', { repo, name }),
  switchRemote: (repo: string, ref: string) => call<string>('switchRemote', { repo, ref }),
  createBranch: (repo: string, name: string) => call<string>('createBranch', { repo, name }),

  hunks: (repo: string, file: string) => call<HunkSet>('hunks', { repo, file }),
  applyHunk: (repo: string, patch: string, mode: 'stage' | 'unstage' | 'discard') => call('applyHunk', { repo, patch, mode }),
  commitFiles: (repo: string, sha: string) => call<CommitFile[]>('commitFiles', { repo, sha }),
  showCommit: (repo: string, sha: string) => call<string>('showCommit', { repo, sha }),
  compareWorking: (repo: string, file: string) => call<CompareTexts>('compareWorking', { repo, file }),
  compareCommit: (repo: string, sha: string, file: CommitFile) => call<CompareTexts>('compareCommit', { repo, sha, file }),
  historySearch: (repo: string, query: string) => call<string[]>('historySearch', { repo, query }),

  dashboardActivity: () => call<DashboardActivity>('dashboardActivity'),
  services: () => call<Services>('services'),
  github: (force = false) => call<GithubDashboard>('github', { force }),
  projectStats: (repo: string) => call<ProjectStats>('projectStats', { repo }),
  projectGithub: (repo: string, force = false) => call<ProjectGithub>('projectGithub', { repo, force }),
  projectGithubCached: (repo: string) => call<ProjectGithub | null>('projectGithubCached', { repo }),

  clearActivity: () => call('clearActivity'),
  clearCache: () => call('clearCache'),
  dataInfo: () => call<DataInfo>('dataInfo'),
  applyUpdate: () => call('applyUpdate'),
}

export const host = {
  openExternal: (url: string) => bridge().host.openExternal(url),
  openPath: (path: string) => bridge().host.openPath(path),
  openInEditor: (path: string, file?: string) => bridge().host.openInEditor(path, file),
  chooseFolders: () => bridge().host.chooseFolders(),
  initialFolders: () => bridge().host.initialFolders(),
  pathForFile: (file: File) => bridge().host.pathForFile(file),
}

export interface CoreEvents {
  deck: DeckState
  repo: RepoState
  history: HistoryState
  repoRemoved: string
  activity: ActivityEntry | null
  github: GithubDashboard
  update: UpdateInfo
  toast: string
  openFolders: string[]
  reconnected: null
}

export function on<K extends keyof CoreEvents>(name: K, fn: (data: CoreEvents[K]) => void): () => void {
  return bridge().on(name, fn as (data: unknown) => void)
}
