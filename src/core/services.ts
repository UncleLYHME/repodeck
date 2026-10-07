// Background watchers that aren't tied to one repo: GitHub (PRs, CI) and RepoDeck's own updates.

import { watch, type FSWatcher } from 'node:fs'
import type { GithubDashboard, UpdateInfo } from '../shared/types'
import { basename } from '../shared/time'
import { log } from './activity'
import { github, githubCached } from './stats/github'
import { CHECK_SECONDS, VERSION_FILE, check } from './update'
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

export class UpdateWatch {
  found: UpdateInfo | null = null
  private announced = new Set<string>()
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setInterval>

  constructor(private deck: Deck, private host: DeckHost, private current: string) {
    // Event-driven for the checkout itself; a quiet fetch now and then for upstream.
    try {
      this.watcher = watch(deck.appDir, (_type, name) => {
        if (name?.toString() === VERSION_FILE) void this.check(false)
      })
    } catch {
      this.watcher = null
    }
    setTimeout(() => void this.check(), FIRST_UPDATE_MS).unref?.()
    this.timer = setInterval(() => void this.check(), CHECK_SECONDS * 1000)
  }

  close(): void {
    clearInterval(this.timer)
    this.watcher?.close()
  }

  async check(fetch = true): Promise<UpdateInfo | null> {
    const remote = this.deck.settings.updateChecks // with checks off, only an update already on disk shows
    let update: UpdateInfo | null = null
    try {
      update = await check(this.deck.appDir, this.current, { fetch: fetch && remote, remote })
    } catch {
      update = null // an update check must never disturb the app
    }
    if (!update) return null
    this.found = update
    this.host.emit('update', update)
    if (!this.announced.has(update.version)) {
      this.announced.add(update.version)
      const title = update.source === 'disk' ? `RepoDeck ${update.version} is ready` : `RepoDeck ${update.version} is available`
      log(title, null, 'auto')
      this.host.announce(title, 'Open RepoDeck to restart into the new version.', 'update')
    }
    return update
  }
}
