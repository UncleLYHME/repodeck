// Background watchers that aren't tied to one repo: GitHub (PRs, CI) and RepoDeck's own updates.

import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { GithubDashboard, UpdateStatus } from '../shared/types'
import { basename } from '../shared/time'
import { log } from './activity'
import { github, githubCached } from './stats/github'
import { CHECK_SECONDS, download, inspect } from './update'
import { Throttle } from './watch'
import type { Deck, DeckHost } from './deck'

const GITHUB_MS = 5 * 60_000
const FIRST_GITHUB_MS = 2_000
const FIRST_UPDATE_MS = 10_000

export class GithubWatch {
  result: GithubDashboard | null = null
  private busy: Promise<GithubDashboard> | null = null
  private timer: ReturnType<typeof setInterval>

  constructor(private deck: Deck, private host: DeckHost) {
    this.result = githubCached(deck.allPaths()) // the last known answer at once; revalidated below
    setTimeout(() => void this.refresh(), FIRST_GITHUB_MS).unref?.()
    this.timer = setInterval(() => void this.refresh(), GITHUB_MS)
  }

  close(): void {
    clearInterval(this.timer)
  }

  refresh(force = false): Promise<GithubDashboard> {
    if (this.busy) return this.busy
    this.busy = github(this.deck.allPaths(), force).then((result) => {
      const previous = this.result
      this.result = result
      this.host.emit('github', result)
      if (previous && !previous.error && !result.error) this.announceNew(previous, result)
      return result
    }).finally(() => {
      this.busy = null
    })
    return this.busy
  }

  /** Notifications for CI failures and review requests that weren't there last time. */
  private announceNew(before: GithubDashboard, after: GithubDashboard): void {
    const seenRuns = new Set(before.ci.map((r) => r.url))
    for (const run of after.ci) {
      if (seenRuns.has(run.url)) continue
      log(`CI failed: ${run.workflowName} on ${run.headBranch}`, run.repo ?? null, 'auto', 'error')
      this.host.announce(`CI failed: ${run.workflowName}`, `${basename(run.repo ?? '')} / ${run.headBranch}`, run.url, run.url)
    }
    const seenPrs = new Set(before.prs.review.map((p) => p.url))
    for (const pr of after.prs.review) {
      if (seenPrs.has(pr.url)) continue
      log(`Review requested: ${pr.title} (${pr.repo}#${pr.number})`, null, 'auto')
      this.host.announce(`Review requested: ${pr.title}`, `${pr.repo}#${pr.number}`, pr.url, pr.url)
    }
  }
}

/**
 * RepoDeck's own updates when it runs from a git checkout (installed copies: src/main/updater.ts).
 * Same flow as installers: available -> Update (fast-forward) -> ready -> the next start rebuilds.
 */
export class CheckoutUpdates {
  status: UpdateStatus = { phase: 'idle', version: null, notes: [], progress: 0, manual: false, checkedAt: null, source: 'checkout' }
  private announced = new Set<string>()
  private watchers: FSWatcher[] = []
  private timer: ReturnType<typeof setInterval>
  private recheck = new Throttle(1000, () => void this.check(false))

  constructor(private deck: Deck, private host: DeckHost, private built: string) {
    // New commits arrive as ref changes: pulled in a terminal, fetched, or auto-pulled by RepoDeck itself.
    for (const dir of ['.git', '.git/refs/heads', '.git/refs/remotes/origin']) {
      try {
        this.watchers.push(watch(join(deck.appDir, dir), () => this.recheck.call()))
      } catch {
        // not a checkout, or no remote
      }
    }
    setTimeout(() => void this.check(), FIRST_UPDATE_MS).unref?.()
    this.timer = setInterval(() => void this.check(), CHECK_SECONDS * 1000)
  }

  close(): void {
    clearInterval(this.timer)
    this.recheck.cancel()
    for (const w of this.watchers) w.close()
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.host.emit('update', this.status)
  }

  /** fetch: ask the remote too (the update-checks preference; always when you press Check Now). */
  async check(fetch = this.deck.settings.updateChecks): Promise<UpdateStatus> {
    if (this.status.phase === 'downloading') return this.status
    const before = this.status
    if (fetch) this.set({ phase: 'checking' })
    try {
      const found = await inspect(this.deck.appDir, this.built, { fetch })
      // A checkout already holding the update stays "ready" until RepoDeck restarts.
      const phase = found.phase === 'up-to-date' && before.phase === 'ready' ? 'ready' : found.phase
      this.set(phase === found.phase ? { ...found, error: undefined, checkedAt: Date.now() } : { phase, checkedAt: Date.now() })
    } catch (e) {
      this.set({ phase: before.phase === 'checking' ? 'error' : before.phase, error: (e as Error).message, checkedAt: Date.now() })
    }
    this.announce()
    if (this.status.phase === 'available' && this.deck.settings.autoUpdate) await this.download()
    return this.status
  }

  async download(): Promise<UpdateStatus> {
    if (this.status.phase !== 'available') return this.status
    this.set({ phase: 'downloading', progress: 0 })
    try {
      await download(this.deck.appDir)
      log(`Downloaded RepoDeck ${this.status.version}; it's used from the next start`, null, 'auto')
    } catch (e) {
      this.set({ phase: 'available', error: (e as Error).message })
      throw e
    }
    return this.check(false)
  }

  private announce(): void {
    const { phase, version } = this.status
    if (!version || (phase !== 'available' && phase !== 'ready')) return
    const key = `${phase}:${version}`
    if (this.announced.has(key)) return
    this.announced.add(key)
    const title = phase === 'available' ? `RepoDeck ${version} is available` : `RepoDeck ${version} is ready`
    log(title, null, 'auto')
    this.host.announce(title, phase === 'available' ? 'Open RepoDeck to update.' : 'It starts the next time you open RepoDeck.', 'update')
  }
}
