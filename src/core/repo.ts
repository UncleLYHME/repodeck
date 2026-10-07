// One repository: keeps its status and history fresh (file events), runs actions on it one at a
// time, and keeps it up to date with its remote (background fetch results, auto-pull).

import { statSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Change, HistoryState, LogRow, Pending, RepoState, Status } from '../shared/types'
import { canFastForward } from '../shared/changes'
import { basename, plural } from '../shared/time'
import { firstLine } from './git/run'
import { fingerprint, log as gitLog, status as gitStatus } from './git/status'
import { fastForward } from './git/sync'
import { identity, stashes as gitStashes } from './git/ops'
import { githubSlug } from './stats/github'
import { log } from './activity'
import { reads } from './scheduler'
import { RepoWatcher } from './watch'

export interface RepoHost {
  autoPullFor(path: string): boolean
  announce(message: string, body?: string, key?: string, uri?: string): void
  emitState(state: RepoState): void
  emitHistory(history: HistoryState): void
}

/** Changes when this repo's or the user's git config files change (identity, remotes). */
function configStamp(repo: string): string {
  const home = homedir()
  let extra: string[] = []
  try {
    extra = readdirSync(home).filter((n) => n.startsWith('.gitconfig-')).map((n) => join(home, n))
  } catch {
    // unreadable home
  }
  return [join(repo, '.git', 'config'), join(home, '.gitconfig'), ...extra].map((p) => {
    try {
      return `${p}:${statSync(p).mtimeMs}`
    } catch {
      return `${p}:-`
    }
  }).join('|')
}

const FAILED_VERBS: Record<string, string> = {
  Pushed: 'Push', Pulled: 'Pull', Fetched: 'Fetch', Committed: 'Commit', Discarded: 'Discard', Stashed: 'Stash',
  Applied: 'Apply stash', Switched: 'Switch branch', Created: 'Create branch', Aborted: 'Abort', Identity: 'Set identity',
  Ignored: 'Ignore', Stopped: 'Ignore',
}

/** "Pushed …" -> "Push": the action named in a failure entry of the activity log. */
export const failedLabel = (doneMsg: string): string => FAILED_VERBS[doneMsg.split(' ')[0]] ?? doneMsg

interface Known {
  logKey?: string
  rows?: LogRow[]
  fp?: string
  stashes?: string[]
  stamp?: string
  config?: { identity: { name: string; email: string }; slug: string | null }
}

export class RepoController {
  status: Status | null = null
  rows: LogRow[] | null = null
  error: string | null = null
  identity: { name: string; email: string } | null = null
  stashes: string[] = []
  slug: string | null = null
  busy: string | null = null
  fetching = false
  lastFetch = 0 // Date.now() of the last finished fetch
  fetchedAt: string | null = null
  fetchError: string | null = null
  pullBlocked: string | null = null // why the last automatic pull could not run; retried on the next change
  private pulling = false
  private loading = false
  private pending = false
  private known: Known = {}
  private lastState = ''
  private watcher: RepoWatcher
  private closed = false

  constructor(readonly path: string, private host: RepoHost) {
    this.watcher = new RepoWatcher(path, () => this.refresh()) // also does the first refresh
  }

  get name(): string {
    return basename(this.path)
  }

  close(): void {
    this.closed = true
    this.watcher.close()
  }

  // -- data -----------------------------------------------------------------------------

  /** Re-read status (and, when refs moved, history, stashes, identity). Coalesces bursts. */
  refresh(): void {
    if (this.closed) return
    if (this.loading) {
      this.pending = true
      return
    }
    this.loading = true
    void reads.run(() => this.load()).finally(() => {
      this.loading = false
      if (this.pending) {
        this.pending = false
        this.refresh()
      }
    })
  }

  private async load(): Promise<void> {
    // File events fire constantly while you work, but history, stashes, identity and the remote
    // rarely change: reuse them until the repo's refs (or its git config) actually move.
    const known = this.known
    try {
      const st = await gitStatus(this.path)
      const fp = await fingerprint(this.path)
      const logKey = `${fp}:${st.oid}:${st.branch}:${Math.floor(Date.now() / 60000)}` // "3 minutes ago" ages by the minute
      const rows = known.logKey === logKey && known.rows ? known.rows : await gitLog(this.path, st)
      const stashes = known.fp === fp && known.stashes ? known.stashes : await gitStashes(this.path)
      const stamp = configStamp(this.path)
      const config = known.stamp === stamp && known.config ? known.config
        : { identity: await identity(this.path), slug: await githubSlug(this.path) }
      this.known = { logKey, rows, fp, stashes, stamp, config }
      if (this.closed) return
      this.error = null
      this.identity = config.identity
      this.slug = config.slug
      this.stashes = stashes
      const statusChanged = JSON.stringify(st) !== JSON.stringify(this.status)
      this.status = st
      if (rows !== this.rows && JSON.stringify(rows) !== JSON.stringify(this.rows)) {
        this.rows = rows
        this.host.emitHistory({ path: this.path, rows })
      } else {
        this.rows = rows
      }
      this.emit()
      if (statusChanged) this.maybeAutoPull()
    } catch (e) {
      // missing folder, corrupt repo, ...
      this.known = {}
      this.error = (e as Error).message
      this.emit()
    }
  }

  pendingState(): Pending | null {
    const st = this.status
    if (!st) return null
    if (st.upstream && st.behind && st.ahead) {
      return {
        label: 'syncs on push',
        why: `You have ${st.ahead} unpushed and the remote has ${st.behind} new. Push replays your ` +
          'commits on top of the remote\'s, then pushes; on a conflict nothing changes.',
      }
    }
    if (st.behind && st.operation) return { label: 'pull pending', why: `Waiting for the ${st.operation} in progress to finish.` }
    if (st.behind && this.pullBlocked) {
      return { label: 'pull pending', why: `${this.pullBlocked}\nRetries automatically when these files are committed, reverted or stashed.` }
    }
    return null
  }

  state(): RepoState {
    return {
      path: this.path, status: this.status, error: this.error, identity: this.identity, stashes: this.stashes,
      slug: this.slug, busy: this.busy, fetchError: this.fetchError, fetchedAt: this.fetchedAt, pending: this.pendingState(),
    }
  }

  history(): HistoryState | null {
    return this.rows ? { path: this.path, rows: this.rows } : null
  }

  /** Push the state to the renderer when anything in it changed. */
  emit(): void {
    const state = this.state()
    const text = JSON.stringify(state)
    if (text === this.lastState) return
    this.lastState = text
    this.host.emitState(state)
  }

  // -- actions ----------------------------------------------------------------------------

  /**
   * Run one action at a time on this repo. Resolves with the message to show, or throws with
   * the reason; either way the activity log records it and the panel refreshes.
   */
  async op(doneMsg: string, fn: (st: Status) => Promise<unknown>): Promise<string> {
    if (this.busy) throw new Error(`${this.name} is busy: ${this.busy}`)
    this.busy = doneMsg
    this.emit()
    try {
      const st = this.status ?? (await gitStatus(this.path))
      await fn(st)
      log(doneMsg, this.path, 'you')
      return `${this.name}: ${doneMsg}`
    } catch (e) {
      log(`${failedLabel(doneMsg)} failed: ${firstLine(e)}`, this.path, 'you', 'error')
      throw e
    } finally {
      this.busy = null
      this.emit()
      this.refresh()
    }
  }

  /** The current changes at these paths (selection made in the renderer, re-read now). */
  async pick(paths: string[]): Promise<{ st: Status; changes: Change[] }> {
    const st = await gitStatus(this.path)
    const wanted = new Set(paths)
    return { st, changes: st.changes.filter((c) => wanted.has(c.path)) }
  }

  // -- keeping up to date -------------------------------------------------------------------

  /**
   * Fast-forward onto fetched remote commits. Re-runs on every status change, so a blocked pull
   * is retried as soon as the files in the way are committed or reverted.
   */
  maybeAutoPull(): void {
    const st = this.status
    if (!st || !canFastForward(st) || !this.host.autoPullFor(this.path) || this.pulling || this.busy) return
    this.pulling = true
    const incoming = st.behind
    void fastForward(this.path).then(
      () => {
        this.pullBlocked = null
        log(`Pulled ${plural(incoming, 'new commit')}`, this.path, 'auto')
        this.host.announce(`${this.name}: pulled ${plural(incoming, 'new commit')}`, undefined, `pulled:${this.path}`)
      },
      (e) => {
        const reason = firstLine(e) || 'pull failed'
        if (reason !== this.pullBlocked) log(`Auto-pull waiting: ${reason}`, this.path, 'auto', 'warn')
        this.pullBlocked = reason
      },
    ).finally(() => {
      this.pulling = false
      this.emit()
      this.refresh()
    })
  }

  fetchFinished(error: unknown, behindBefore: number, fresh: Status | null): void {
    this.fetching = false
    this.lastFetch = Date.now()
    const d = new Date()
    this.fetchedAt = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const previous = this.fetchError
    this.fetchError = error ? firstLine(error) : null
    if (this.fetchError && this.fetchError !== previous) {
      log(`Background fetch failed: ${this.fetchError}`, this.path, 'auto', 'warn') // changes, not every failing retry
    } else if (previous && !this.fetchError) {
      log('Background fetch is working again', this.path, 'auto')
    }
    this.emit()
    // New commits that will be pulled automatically get a "pulled" message instead.
    if (fresh && fresh.behind > behindBefore && !(this.host.autoPullFor(this.path) && canFastForward(fresh))) {
      const n = fresh.behind - behindBefore
      this.host.announce(`${this.name}: ${plural(n, 'new commit')} to pull`, undefined, `behind:${this.path}`)
    }
  }
}
