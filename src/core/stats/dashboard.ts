// Numbers for the Home dashboard: commits across every repo, and dev servers running from them.

import type { DashboardActivity, Services } from '../../shared/types'
import { addDays, localDate } from '../../shared/time'
import { cache } from '../cache'
import { fingerprint } from '../git/status'
import { run } from '../git/run'
import { listeners } from '../platform/services'
import { DAYS } from './github'

export type CommitRecord = [string, number, string, string, number, number] // sha, ts, author, subject, added, deleted

/** Commits since `start` (YYYY-MM-DD); cached per repo until its refs move. */
export async function repoCommits(repo: string, start: string): Promise<CommitRecord[]> {
  const key = `activity:${repo}`
  const version = `${await fingerprint(repo)}:${start}`
  const [cached] = cache().get<CommitRecord[]>(key, { version })
  if (cached) return cached
  // Branches, remotes and tags only: tools keep private refs (e.g. refs/t3/*) that aren't real work.
  const out = await run(repo, ['log', '--branches', '--remotes', '--tags', '--no-merges', `--since=${start} 00:00`,
    '--format=\x1e%H\x1f%at\x1f%an\x1f%s', '--numstat'])
  const commits = parseNumstatLog(out).map(({ sha, ts, author, subject, files }): CommitRecord => {
    let added = 0
    let deleted = 0
    for (const [a, d] of files) {
      added += a
      deleted += d
    }
    return [sha, ts, author, subject, added, deleted]
  })
  cache().put(key, commits, version)
  return commits
}

export interface LogBlock {
  sha: string
  ts: number
  author: string
  subject: string
  files: [number, number, string, boolean][] // added, deleted, path, counted (binary files show "-")
}

/** `git log --format=\x1e%H\x1f%at\x1f%an\x1f%s --numstat` -> one block per commit. */
export function parseNumstatLog(out: string): LogBlock[] {
  return out.split('\x1e').slice(1).map((block) => {
    const nl = block.indexOf('\n')
    const head = nl < 0 ? block : block.slice(0, nl)
    const numstat = nl < 0 ? '' : block.slice(nl + 1)
    const [sha, ts, author, ...subject] = head.split('\x1f')
    const files: LogBlock['files'] = []
    for (const line of numstat.split('\n')) {
      const parts = line.split('\t')
      if (parts.length !== 3) continue
      const counted = /^\d+$/.test(parts[0])
      files.push([counted ? Number(parts[0]) : 0, counted ? Number(parts[1]) : 0, parts[2], counted])
    }
    return { sha, ts: Number(ts), author, subject: subject.join('\x1f'), files }
  })
}

export async function dashboardActivity(repos: string[], today = localDate(new Date())): Promise<DashboardActivity> {
  const start = addDays(today, -(DAYS - 1))
  const counts = new Map<string, number>()
  for (let i = 0; i < DAYS; i++) counts.set(addDays(start, i), 0)
  const act: DashboardActivity = { days: [], total: 0, added: 0, deleted: 0, perRepo: {}, recent: [] }
  const seen = new Set<string>() // forks and clones share commits; count each once
  const all = await Promise.all(repos.map((r) => repoCommits(r, start).catch(() => null)))
  repos.forEach((repo, i) => {
    for (const [sha, ts, author, subject, added, deleted] of all[i] ?? []) {
      if (seen.has(sha)) continue
      seen.add(sha)
      const day = localDate(new Date(ts * 1000))
      if (!counts.has(day)) continue
      counts.set(day, counts.get(day)! + 1)
      act.total += 1
      act.perRepo[repo] = (act.perRepo[repo] ?? 0) + 1
      act.recent.push([ts, repo, subject, author, sha.slice(0, 7)])
      act.added += added
      act.deleted += deleted
    }
  })
  act.days = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  act.recent.sort((a, b) => b[0] - a[0] || (b[1] < a[1] ? -1 : 1))
  act.recent.splice(8)
  return act
}

/** Listening TCP ports whose process runs inside one of the repos, and how many others there are. */
export async function services(repos: string[]): Promise<Services> {
  const roots = [...repos].sort((a, b) => b.length - a.length) // deepest match wins
  const found: Services['found'] = []
  let others = 0
  for (const { port, name, cwd } of await listeners()) {
    const repo = roots.find((r) => cwd === r || cwd.startsWith(r + '/'))
    if (repo) found.push([port, repo, name])
    else others += 1
  }
  return { found, others }
}
