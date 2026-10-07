// Everything the renderer can ask the core to do. Repo paths are checked against the deck,
// so only repositories the user added can be touched.

import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import type { CommitFile, CompareTexts, DataInfo, HunkSet, Settings, Snapshot, UpdateAction } from '../shared/types'
import { plural } from '../shared/time'
import { run } from './git/run'
import { LOG_LIMIT, commitFiles, show, status as gitStatus } from './git/status'
import { commit } from './git/commit'
import { fetch, pull, push } from './git/sync'
import * as ops from './git/ops'
import { Unreadable, commitVersions, workingVersions } from './compare'
import { dashboardActivity, services } from './stats/dashboard'
import { project, projectGithub, projectGithubCached } from './stats/project'
import { activity } from './activity'
import { cache } from './cache'
import { configDir } from './paths'
import type { Deck } from './deck'
import type { CheckoutUpdates, GithubWatch } from './services'

export interface Host {
  trash(path: string): Promise<void>
  relaunch(): Promise<void>
}

function onPath(cmd: string): boolean {
  try {
    if (process.platform === 'win32') execFileSync('where', [cmd], { stdio: 'ignore' })
    else execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const size = (p: string) => {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

/** A file-name fragment as a case-insensitive glob that matches it literally. */
export const globLiteral = (q: string): string => q.replace(/[*?[\]\\]/g, (c) => `\\${c}`)

export function handlers(deck: Deck, github: GithubWatch, updates: CheckoutUpdates | null, host: Host, version: string) {
  const capabilities = { code: onPath('code'), platform: process.platform }
  const repo = (path: string) => deck.repo(path)
  const op = (path: string, msg: string, fn: (st: Awaited<ReturnType<typeof gitStatus>>) => Promise<unknown>) => repo(path).op(msg, fn)

  return {
    snapshot: (): Snapshot => ({
      deck: deck.state(), repos: deck.repoStates(), histories: deck.histories(), activity: activity().entries,
      version, update: updates?.status ?? null, capabilities, configDir: configDir(),
    }),

    // -- deck ------------------------------------------------------------------------------
    addFolders: ({ paths }: { paths: string[] }) => deck.addFolders(paths),
    removeGroup: ({ folder }: { folder: string }) => deck.removeGroup(folder),
    setGroup: ({ folder, ...change }: { folder: string; expanded?: boolean; watching?: boolean; autoPull?: boolean }) =>
      deck.setGroup(folder, change),
    toggleAll: () => deck.toggleAll(),
    removeRepo: ({ path }: { path: string }) => deck.removeRepo(path),
    togglePin: ({ path }: { path: string }) => deck.togglePin(path),
    setSetting: ({ key, value }: { key: keyof Settings; value: never }) => deck.setSetting(key, value),
    refreshAll: () => deck.refreshAll(),
    fetchAll: () => deck.fetchAll(),

    // -- repo actions ------------------------------------------------------------------------
    commit: ({ repo: path, message, paths }: { repo: string; message: string; paths: string[] }) =>
      op(path, `Committed ${plural(paths.length, 'file')}`, async () => {
        const { st, changes } = await repo(path).pick(paths)
        await commit(path, st, message, changes)
      }),
    discard: ({ repo: path, paths }: { repo: string; paths: string[] }) =>
      op(path, `Discarded ${plural(paths.length, 'file')}`, async () => {
        const { st, changes } = await repo(path).pick(paths)
        await ops.discard(path, st, changes.filter((c) => c.kind !== 'conflict'), host.trash)
      }),
    ignore: ({ repo: path, pattern, untrack }: { repo: string; pattern: string; untrack: string[] }) =>
      op(path, `${untrack.length ? 'Stopped tracking and ignored' : 'Ignored'} ${pattern}`, () => ops.ignore(path, pattern, untrack)),
    fetch: async ({ repo: path }: { repo: string }) => {
      const msg = await op(path, 'Fetched', () => fetch(path))
      repo(path).fetchFinished(null, 0, null)
      return msg
    },
    pull: ({ repo: path }: { repo: string }) => op(path, 'Pulled', () => pull(path)),
    push: ({ repo: path }: { repo: string }) => op(path, 'Pushed', async () => push(path, (await gitStatus(path)).upstream)),
    stash: ({ repo: path }: { repo: string }) => op(path, 'Stashed all changes', () => ops.stash(path)),
    stashPop: ({ repo: path }: { repo: string }) => op(path, 'Applied the latest stash', () => ops.stashPop(path)),
    abort: ({ repo: path }: { repo: string }) => {
      const operation = repo(path).status?.operation
      if (!operation) throw new Error('Nothing to abort.')
      return op(path, `Aborted the ${operation}`, () => ops.abort(path, operation))
    },
    setIdentity: ({ repo: path, name, email }: { repo: string; name: string; email: string }) =>
      op(path, 'Identity saved', () => ops.setIdentity(path, name, email)),
    profiles: () => ops.profiles(),
    branches: ({ repo: path }: { repo: string }) => (repo(path), ops.branches(path)),
    switchBranch: ({ repo: path, name }: { repo: string; name: string }) => op(path, `Switched to ${name}`, () => ops.switchBranch(path, name)),
    switchRemote: ({ repo: path, ref }: { repo: string; ref: string }) =>
      op(path, `Switched to ${ref.split('/').slice(1).join('/')}`, () => ops.switchRemote(path, ref)),
    createBranch: ({ repo: path, name }: { repo: string; name: string }) => op(path, `Created ${name.trim()}`, () => ops.createBranch(path, name)),

    // -- reading -------------------------------------------------------------------------------
    hunks: async ({ repo: path, file }: { repo: string; file: string }): Promise<HunkSet> => {
      repo(path)
      const [unstaged, staged] = await Promise.all([ops.hunks(path, file, false), ops.hunks(path, file, true)])
      return { unstaged, staged }
    },
    applyHunk: async ({ repo: path, patch, mode }: { repo: string; patch: string; mode: ops.HunkMode }) => {
      repo(path)
      try {
        await ops.applyHunk(path, patch, mode)
      } finally {
        void repo(path).refresh()
      }
    },
    commitFiles: ({ repo: path, sha }: { repo: string; sha: string }) => (repo(path), commitFiles(path, sha)),
    showCommit: ({ repo: path, sha }: { repo: string; sha: string }) => (repo(path), show(path, sha)),
    compareWorking: async ({ repo: path, file }: { repo: string; file: string }): Promise<CompareTexts> => {
      repo(path)
      const st = await gitStatus(path)
      const change = st.changes.find((c) => c.path === file)
      if (!change) return { old: '', new: '', error: 'This file has no changes any more.' }
      return texts(() => workingVersions(path, st, change))
    },
    compareCommit: ({ repo: path, sha, file }: { repo: string; sha: string; file: CommitFile }): Promise<CompareTexts> =>
      (repo(path), texts(() => commitVersions(path, sha, file))),
    historySearch: async ({ repo: path, query }: { repo: string; query: string }): Promise<string[]> => {
      repo(path)
      const out = await run(path, ['log', '--format=%H', '--branches', '--remotes', '--tags', 'HEAD', `-n${LOG_LIMIT}`,
        '--', `:(icase,glob)**/*${globLiteral(query)}*`], { env: { GIT_LITERAL_PATHSPECS: '0' }, check: false })
      return out.split('\n').filter(Boolean)
    },

    // -- dashboard and analytics ------------------------------------------------------------------
    dashboardActivity: () => dashboardActivity(deck.allPaths()),
    services: () => services(deck.allPaths()),
    github: ({ force }: { force?: boolean } = {}) => (force || !github.result ? github.refresh(force) : github.result),
    projectStats: ({ repo: path, branch }: { repo: string; branch?: string }) => (repo(path), project(path, undefined, branch || undefined)),
    projectGithub: ({ repo: path, force }: { repo: string; force?: boolean }) => (repo(path), projectGithub(path, force)),
    projectGithubCached: ({ repo: path }: { repo: string }) => (repo(path), projectGithubCached(path)),

    // -- data, activity, updates -------------------------------------------------------------------
    clearActivity: () => activity().clear(),
    clearCache: () => cache().clear(),
    dataInfo: (): DataInfo => ({
      cacheBytes: size(cache().path), activityEntries: activity().entries.length,
      activityBytes: size(activity().path), configDir: configDir(),
    }),
    /** RepoDeck's own update, for a checkout (installed copies ask main instead). */
    update: async ({ action }: { action: UpdateAction }) => {
      if (!updates) throw new Error('This copy updates through its installer.')
      if (action === 'check') return updates.check(true)
      if (action === 'download') return updates.download()
      activity().add(`Restarting into RepoDeck ${updates.status.version ?? ''}`.trim())
      cache().save()
      await host.relaunch()
      return updates.status
    },
  }
}

async function texts(load: () => Promise<[string, string]>): Promise<CompareTexts> {
  try {
    const [old, neu] = await load()
    return { old, new: neu }
  } catch (e) {
    const message = (e as Error).message
    return { old: '', new: '', error: e instanceof Unreadable ? message : `Could not read this file: ${message}` }
  }
}

export type Api = ReturnType<typeof handlers>
