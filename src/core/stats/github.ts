// GitHub through the gh CLI, which already holds the login.

import type { CiRun, GithubDashboard, PullRequest } from '../../shared/types'
import { cache } from '../cache'
import { exec, run } from '../git/run'

export const DAYS = 14
export const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])
export const GITHUB_TTL = 120 // seconds a GitHub answer is reused before asking again
export const GITHUB_URL = /github\.com[:/](?<slug>[^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/

export async function githubSlug(repo: string): Promise<string | null> {
  try {
    const url = (await run(repo, ['remote', 'get-url', 'origin'])).trim()
    return GITHUB_URL.exec(url)?.groups?.slug ?? null
  } catch {
    return null
  }
}

export async function gh<T>(...args: string[]): Promise<T> {
  let r
  try {
    r = await exec('gh', args, undefined, { timeout: 30_000, env: { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } })
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    throw new Error(err.code === 'ENOENT' ? 'gh is not installed' : err.message)
  }
  if (r.code) {
    const text = (r.stderr || r.stdout).trim()
    throw new Error(text ? text.split('\n').pop()! : 'gh failed')
  }
  return JSON.parse(r.stdout || '[]') as T
}

const PR_FIELDS = 'repository,number,title,url,isDraft,updatedAt'

interface SearchPr {
  repository: { nameWithOwner: string }
  number: number
  title: string
  url: string
  isDraft?: boolean
}

/** Open PRs waiting on your review, and your own. */
export async function pullRequests(): Promise<GithubDashboard['prs']> {
  const norm = (items: SearchPr[]): PullRequest[] =>
    items.map((i) => ({ repo: i.repository.nameWithOwner, number: i.number, title: i.title, url: i.url, draft: i.isDraft ?? false }))
  const [review, mine] = await Promise.all([
    gh<SearchPr[]>('search', 'prs', '--review-requested=@me', '--state=open', '--json', PR_FIELDS, '--limit', '20'),
    gh<SearchPr[]>('search', 'prs', '--author=@me', '--state=open', '--json', PR_FIELDS, '--limit', '20'),
  ])
  return { review: norm(review), mine: norm(mine) }
}

/** Latest run per (workflow, branch); keep the ones that failed after `since` (ISO time). */
export function ciFailuresFromRuns(runs: CiRun[], since: string): CiRun[] {
  const latest = new Map<string, CiRun>()
  for (const r of [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) {
    const key = `${r.workflowName}\0${r.headBranch}`
    if (!latest.has(key)) latest.set(key, r)
  }
  return [...latest.values()].filter((r) => FAILED.has(r.conclusion ?? '') && r.createdAt >= since)
}

export async function ciFailures(repos: string[]): Promise<CiRun[]> {
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString().replace(/\.\d+Z$/, 'Z')
  const one = async (repo: string): Promise<CiRun[]> => {
    const slug = await githubSlug(repo)
    if (!slug) return []
    const runs = await gh<CiRun[]>('run', 'list', '-R', slug, '-L', '30', '--json',
      'workflowName,headBranch,conclusion,url,createdAt,displayTitle')
    return ciFailuresFromRuns(runs, since).map((r) => ({ ...r, repo }))
  }
  const out: CiRun[] = []
  for (let i = 0; i < repos.length; i += 6) out.push(...(await Promise.all(repos.slice(i, i + 6).map(one))).flat())
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export interface GithubSources {
  pullRequests: () => Promise<GithubDashboard['prs']>
  ciFailures: (repos: string[]) => Promise<CiRun[]>
}

const SOURCES: GithubSources = { pullRequests, ciFailures }

/**
 * PRs and CI failures, or an error when gh is missing, logged out or offline.
 *
 * Reused for GITHUB_TTL seconds; failures aren't cached, so the next call retries.
 */
export async function github(repos: string[], force = false, sources: GithubSources = SOURCES): Promise<GithubDashboard> {
  const key = 'github:dashboard:' + [...repos].sort().join(',')
  const [cached, fresh] = cache().get<GithubDashboard>(key, { ttl: GITHUB_TTL })
  if (cached && fresh && !force) return cached
  try {
    const [prs, ci] = await Promise.all([sources.pullRequests(), sources.ciFailures(repos)])
    const result: GithubDashboard = { prs, ci, error: null, fetchedAt: Date.now() / 1000 }
    cache().put(key, result)
    return result
  } catch (e) {
    const error = (e as Error).message || 'GitHub error'
    if (cached) return { ...cached, stale: error } // offline or rate-limited: keep the last good answer
    return { prs: { review: [], mine: [] }, ci: [], error }
  }
}

/** The last stored dashboard answer, without touching the network. */
export function githubCached(repos: string[]): GithubDashboard | null {
  return cache().get<GithubDashboard>('github:dashboard:' + [...repos].sort().join(','), { ttl: GITHUB_TTL })[0]
}

export { freshness } from '../../shared/time'
