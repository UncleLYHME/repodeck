// Everything the renderer can ask the core to do. Every argument is checked first (src/core/validate.ts)
// and repo paths are checked against the deck, so only repositories the user added can be touched.

import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import type { CompareTexts, DataInfo, HunkSet, Snapshot } from '../shared/types'
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
import { anything, checked, flag, hash, list, oneOf, optional, record, setting, text } from './validate'

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
    addFolders: checked({ paths: list(text) }, ({ paths }) => deck.addFolders(paths)),
    removeGroup: checked({ folder: text }, ({ folder }) => deck.removeGroup(folder)),
    setGroup: checked({ folder: text, expanded: optional(flag), watching: optional(flag), autoPull: optional(flag) },
      ({ folder, ...change }) => deck.setGroup(folder, change)),
    toggleAll: () => deck.toggleAll(),
    removeRepo: checked({ path: text }, ({ path }) => deck.removeRepo(path)),
    togglePin: checked({ path: text }, ({ path }) => deck.togglePin(path)),
    setSetting: checked({ key: anything, value: anything }, (given) => {
      const { key, value } = setting(given.key, given.value)
      return deck.setSetting(key, value)
    }),
    refreshAll: () => deck.refreshAll(),
    fetchAll: () => deck.fetchAll(),

    // -- repo actions ------------------------------------------------------------------------
    commit: checked({ repo: text, message: text, paths: list(text) }, ({ repo: path, message, paths }) =>
      op(path, `Committed ${plural(paths.length, 'file')}`, async () => {
        const { st, changes } = await repo(path).pick(paths)
        await commit(path, st, message, changes)
      })),
    discard: checked({ repo: text, paths: list(text) }, ({ repo: path, paths }) =>
      op(path, `Discarded ${plural(paths.length, 'file')}`, async () => {
        const { st, changes } = await repo(path).pick(paths)
        await ops.discard(path, st, changes.filter((c) => c.kind !== 'conflict'), host.trash)
      })),
    ignore: checked({ repo: text, pattern: text, untrack: list(text) }, ({ repo: path, pattern, untrack }) =>
      op(path, `${untrack.length ? 'Stopped tracking and ignored' : 'Ignored'} ${pattern}`, () => ops.ignore(path, pattern, untrack))),
    fetch: checked({ repo: text }, async ({ repo: path }) => {
      const msg = await op(path, 'Fetched', () => fetch(path))
      repo(path).fetchFinished(null, 0, null)
      return msg
    }),
    pull: checked({ repo: text }, ({ repo: path }) => op(path, 'Pulled', () => pull(path))),
    push: checked({ repo: text }, ({ repo: path }) => op(path, 'Pushed', async () => push(path, (await gitStatus(path)).upstream))),
    stash: checked({ repo: text }, ({ repo: path }) => op(path, 'Stashed all changes', () => ops.stash(path))),
    stashPop: checked({ repo: text }, ({ repo: path }) => op(path, 'Applied the latest stash', () => ops.stashPop(path))),
    abort: checked({ repo: text }, ({ repo: path }) => {
      const operation = repo(path).status?.operation
      if (!operation) throw new Error('Nothing to abort.')
      return op(path, `Aborted the ${operation}`, () => ops.abort(path, operation))
    }),
    setIdentity: checked({ repo: text, name: text, email: text }, ({ repo: path, name, email }) =>
      op(path, 'Identity saved', () => ops.setIdentity(path, name, email))),
    profiles: () => ops.profiles(),
    branches: checked({ repo: text }, ({ repo: path }) => (repo(path), ops.branches(path))),
    switchBranch: checked({ repo: text, name: text }, ({ repo: path, name }) =>
      op(path, `Switched to ${name}`, () => ops.switchBranch(path, name))),
    switchRemote: checked({ repo: text, ref: text }, ({ repo: path, ref }) =>
      op(path, `Switched to ${ref.split('/').slice(1).join('/')}`, () => ops.switchRemote(path, ref))),
    createBranch: checked({ repo: text, name: text }, ({ repo: path, name }) =>
      op(path, `Created ${name.trim()}`, () => ops.createBranch(path, name))),

    // -- reading -------------------------------------------------------------------------------
    hunks: checked({ repo: text, file: text }, async ({ repo: path, file }): Promise<HunkSet> => {
      repo(path)
      const [unstaged, staged] = await Promise.all([ops.hunks(path, file, false), ops.hunks(path, file, true)])
      return { unstaged, staged }
    }),
    applyHunk: checked({ repo: text, patch: text, mode: oneOf('stage', 'unstage', 'discard') }, async ({ repo: path, patch, mode }) => {
      repo(path)
      try {
        await ops.applyHunk(path, patch, mode)
      } finally {
        void repo(path).refresh()
      }
    }),
    commitFiles: checked({ repo: text, sha: hash }, ({ repo: path, sha }) => (repo(path), commitFiles(path, sha))),
    showCommit: checked({ repo: text, sha: hash }, ({ repo: path, sha }) => (repo(path), show(path, sha))),
    compareWorking: checked({ repo: text, file: text }, async ({ repo: path, file }): Promise<CompareTexts> => {
      repo(path)
      const st = await gitStatus(path)
      const change = st.changes.find((c) => c.path === file)
      if (!change) return { old: '', new: '', error: 'This file has no changes any more.' }
      return texts(() => workingVersions(path, st, change))
    }),
    compareCommit: checked({ repo: text, sha: hash, file: record({ path: text, letter: text, orig: optional(text) }) },
      ({ repo: path, sha, file }): Promise<CompareTexts> =>
        (repo(path), texts(() => commitVersions(path, sha, { ...file, orig: file.orig ?? null })))),
    historySearch: checked({ repo: text, query: text }, async ({ repo: path, query }): Promise<string[]> => {
      repo(path)
      const out = await run(path, ['log', '--format=%H', '--branches', '--remotes', '--tags', 'HEAD', `-n${LOG_LIMIT}`,
        '--', `:(icase,glob)**/*${globLiteral(query)}*`], { env: { GIT_LITERAL_PATHSPECS: '0' }, check: false })
      return out.split('\n').filter(Boolean)
    }),

    // -- dashboard and analytics ------------------------------------------------------------------
    dashboardActivity: () => dashboardActivity(deck.allPaths()),
    services: () => services(deck.allPaths()),
    github: checked({ force: optional(flag) }, ({ force }) => (force || !github.result ? github.refresh(force) : github.result)),
    projectStats: checked({ repo: text, branch: optional(text) }, ({ repo: path, branch }) =>
      (repo(path), project(path, undefined, branch || undefined))),
    projectGithub: checked({ repo: text, force: optional(flag) }, ({ repo: path, force }) => (repo(path), projectGithub(path, force))),
    projectGithubCached: checked({ repo: text }, ({ repo: path }) => (repo(path), projectGithubCached(path))),

    // -- data, activity, updates -------------------------------------------------------------------
    clearActivity: () => activity().clear(),
    clearCache: () => cache().clear(),
    dataInfo: (): DataInfo => ({
      cacheBytes: size(cache().path), activityEntries: activity().entries.length,
      activityBytes: size(activity().path), configDir: configDir(),
    }),
    /** RepoDeck's own update, for a checkout (installed copies ask main instead). */
    update: checked({ action: oneOf('check', 'download', 'restart') }, async ({ action }) => {
      if (!updates) throw new Error('This copy updates through its installer.')
      if (action === 'check') return updates.check(true)
      if (action === 'download') return updates.download()
      activity().add(`Restarting into RepoDeck ${updates.status.version ?? ''}`.trim())
      cache().save()
      await host.relaunch()
      return updates.status
    }),
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
