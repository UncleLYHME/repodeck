// Analytics for one repository (the project page).

import type { ProjectGithub, ProjectStats } from '../../shared/types'
import { addDays, basename, localDate } from '../../shared/time'
import { hasCommits } from '../../shared/changes'
import { cache } from '../cache'
import { run } from '../git/run'
import { fingerprint, status } from '../git/status'
import { suffix } from '../git/ops'
import { parseNumstatLog } from './dashboard'
import { GITHUB_TTL, gh, githubSlug } from './github'

export const WINDOW = 90 // days of history read for activity, hot files, punchcard
export const BARS = 30 // days shown as bars
export const OTHER = 'Other'
const LANGUAGES: Record<string, string> = {
  '.py': 'Python', '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.css': 'CSS', '.scss': 'CSS', '.html': 'HTML',
  '.htm': 'HTML', '.md': 'Markdown', '.mdx': 'Markdown', '.json': 'JSON', '.yml': 'YAML', '.yaml': 'YAML',
  '.sh': 'Shell', '.bash': 'Shell', '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP',
  '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.hpp': 'C++',
  '.cs': 'C#', '.sql': 'SQL', '.vue': 'Vue', '.svelte': 'Svelte', '.toml': 'TOML', '.svg': 'SVG',
  '.lua': 'Lua', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.tf': 'Terraform',
}
const SPECIAL_NAMES: Record<string, string> = { Dockerfile: 'Docker', Makefile: 'Make' }
const SKIP_LANG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.lock', '.woff', '.woff2', '.ttf', '.pdf', '.mp4'])

const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400_000)

function emptyStats(today: string): ProjectStats {
  return {
    days: Array.from({ length: BARS }, (_, i) => [addDays(today, -(BARS - 1 - i)), 0] as [string, number]),
    commits30: 0, commitsPrev30: 0, added30: 0, deleted30: 0, streak: 0, punchcard: [], hotFiles: [],
    authors: [], totalCommits: 0, firstCommit: 0, languages: [], branches: [], recent: [],
  }
}

/** Most common first; ties keep first-seen order (like Python's Counter.most_common). */
function mostCommon<K>(counts: Map<K, number>, n?: number): [K, number][] {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return n === undefined ? sorted : sorted.slice(0, n)
}

async function windowed(repo: string, today: string, ref?: string): Promise<ProjectStats> {
  const s = emptyStats(today)
  const start = addDays(today, -(WINDOW - 1))
  const out = await run(repo, ['log', ...(ref ? [ref] : ['--branches', '--remotes', '--tags']), '--no-merges', `--since=${start} 00:00`,
    '--format=\x1e%H\x1f%at\x1f%an\x1f%s', '--numstat', '--'])
  const perDay = new Map<string, number>()
  const files = new Map<string, number>()
  const churn = new Map<string, number>()
  const punch = new Map<string, number>()
  const seen = new Set<string>()
  for (const { sha, ts, author, subject, files: changed } of parseNumstatLog(out)) {
    if (seen.has(sha)) continue
    seen.add(sha)
    const when = new Date(ts * 1000)
    const day = localDate(when)
    const age = daysBetween(today, day)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    const slot = `${(when.getDay() + 6) % 7},${when.getHours()}`
    punch.set(slot, (punch.get(slot) ?? 0) + 1)
    if (s.recent.length < 8) s.recent.push([ts, subject, author, sha.slice(0, 7)])
    for (const [added, deleted, rawPath, counted] of changed) {
      // renames: count the new name ("dir/{old => new}.py" or "old => new")
      const path = rawPath.includes(' => ') ? rawPath.split(' => ').pop()!.replace(/}$/, '') : rawPath
      files.set(path, (files.get(path) ?? 0) + 1)
      if (counted) {
        churn.set(path, (churn.get(path) ?? 0) + added + deleted)
        if (age < 30) {
          s.added30 += added
          s.deleted30 += deleted
        }
      }
    }
    if (age < 30) s.commits30 += 1
    else if (age < 60) s.commitsPrev30 += 1
  }
  s.days = s.days.map(([day]) => [day, perDay.get(day) ?? 0])
  let day = perDay.get(today) ? today : addDays(today, -1) // a streak survives until today ends
  while (perDay.get(day)) {
    s.streak += 1
    day = addDays(day, -1)
  }
  s.punchcard = [...punch.entries()].map(([k, n]) => {
    const [wd, hour] = k.split(',').map(Number)
    return [wd, hour, n]
  })
  s.hotFiles = mostCommon(files, 8).map(([p, n]) => [p, n, churn.get(p) ?? 0])
  s.recent.sort((a, b) => b[0] - a[0])
  return s
}

/** [language, bytes] top 7 + Other, from {path: size}. */
export function languages(sizesByPath: Record<string, number>): [string, number][] {
  const sizes = new Map<string, number>()
  for (const [rel, size] of Object.entries(sizesByPath)) {
    const ext = suffix(rel).toLowerCase()
    if (SKIP_LANG.has(ext)) continue
    const lang = SPECIAL_NAMES[basename(rel)] ?? LANGUAGES[ext]
    if (lang) sizes.set(lang, (sizes.get(lang) ?? 0) + size)
  }
  const top = mostCommon(sizes, 7)
  const rest = [...sizes.values()].reduce((a, b) => a + b, 0) - top.reduce((a, [, n]) => a + n, 0)
  return rest > 0 ? [...top, [OTHER, rest]] : top
}

/** {path: size} of every file in a commit's tree, HEAD by default (committed sizes; no disk access). */
export async function treeSizes(repo: string, tip = 'HEAD'): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {}
  for (const line of (await run(repo, ['ls-tree', '-r', '-l', '-z', tip])).split('\0')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const parts = line.slice(0, tab).split(/\s+/)
    if (parts.length === 4 && parts[1] === 'blob' && /^\d+$/.test(parts[3])) sizes[line.slice(tab + 1)] = Number(parts[3])
  }
  return sizes
}

const NOREPLY = /^(?:\d+\+)?(?<login>[^@]+)@users\.noreply\.github\.com$/
const normName = (name: string) => name.toLowerCase().replace(/\(.*?\)|[^a-z0-9]/g, '')

/**
 * `git shortlog -sne` -> [name, commits], merging one person's spellings and addresses.
 *
 * Entries are linked when they share an email, a normalized name (case, spacing and "(notes)"
 * ignored), or a GitHub login (from noreply addresses, matched against names too).
 */
export function mergeAuthors(shortlog: string): [string, number][] {
  const entries: [string, string, number][] = []
  for (const line of shortlog.split('\n')) {
    const [count, who = ''] = line.trim().split(/\t(.*)/s)
    const i = who.lastIndexOf(' <')
    const name = i < 0 ? '' : who.slice(0, i)
    const email = i < 0 ? who : who.slice(i + 2)
    if (/^\d+$/.test(count)) entries.push([name, email.replace(/>$/, '').toLowerCase(), Number(count)])
  }
  const parent = entries.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const owner = new Map<string, number>()
  entries.forEach(([name, email], i) => {
    const keys = new Set([`e:${email}`, `n:${normName(name)}`])
    const login = NOREPLY.exec(email)?.groups?.login
    if (login) keys.add(`n:${normName(login)}`)
    for (const key of keys) {
      if (key === 'e:' || key === 'n:') continue
      if (owner.has(key)) parent[find(i)] = find(owner.get(key)!)
      else owner.set(key, i)
    }
  })
  const totals = new Map<number, number>()
  const spellings = new Map<number, Map<string, number>>()
  entries.forEach(([name, , n], i) => {
    const root = find(i)
    totals.set(root, (totals.get(root) ?? 0) + n)
    const names = spellings.get(root) ?? new Map<string, number>()
    names.set(name, (names.get(name) ?? 0) + n)
    spellings.set(root, names)
  })
  return mostCommon(totals).map(([root, n]) => [mostCommon(spellings.get(root)!, 1)[0][0], n])
}

/** The full ref of a local or remote-tracking branch ("main", "origin/feature"), so git reads it as nothing else. */
export async function branchRef(repo: string, branch: string): Promise<string> {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${branch}`]) {
    const found = await run(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { check: false })
    if (found.trim()) return ref
  }
  throw new Error(`No branch named ${branch}`)
}

/**
 * Without `branch`: the 30/90-day activity of every branch, totals and languages of what's checked out.
 * With one: everything from that branch's history and files, without checking it out.
 */
export async function computeProject(repo: string, today: string, branch?: string): Promise<ProjectStats> {
  const st = await status(repo)
  if (!hasCommits(st)) return emptyStats(today)
  const ref = branch && branch !== st.branch ? await branchRef(repo, branch) : undefined
  const tip = ref ?? 'HEAD'
  const [s, total, roots, shortlog, sizes, refs] = await Promise.all([
    windowed(repo, today, ref),
    run(repo, ['rev-list', '--count', tip, '--']),
    run(repo, ['log', '--max-parents=0', '--format=%at', tip, '--']),
    run(repo, ['shortlog', '-sne', '--no-merges', tip, '--']),
    treeSizes(repo, tip),
    run(repo, ['for-each-ref', '--sort=-committerdate', 'refs/heads', '--format=%(refname:short)\x1f%(committerdate:unix)\x1f%(upstream:track)']),
  ])
  s.totalCommits = Number(total.trim() || 0)
  const firsts = roots.split(/\s+/).filter(Boolean).map(Number)
  s.firstCommit = firsts.length ? Math.min(...firsts) : 0
  s.authors = mergeAuthors(shortlog)
  s.languages = languages(sizes)
  for (const line of refs.split('\n').filter(Boolean)) {
    const [name, ts, track] = line.split('\x1f')
    s.branches.push([name, Number(ts || 0), track.replace(/^\[|\]$/g, ''), name === st.branch])
  }
  return s
}

/** Analytics for one repo, cached until its commits/branches/HEAD change (or the day rolls over). */
export async function project(repo: string, today = localDate(new Date()), branch?: string): Promise<ProjectStats> {
  const key = branch ? `project:${repo}:${branch}` : `project:${repo}`
  const version = `${await fingerprint(repo)}:${today}`
  const [cached] = cache().get<ProjectStats>(key, { version })
  if (cached) return cached
  const s = await computeProject(repo, today, branch)
  cache().put(key, s, version)
  return s
}

/** Open PRs and the latest workflow runs for one repo; error=null and slug=null if not on GitHub. */
export async function projectGithub(repo: string, force = false): Promise<ProjectGithub> {
  const slug = await githubSlug(repo)
  if (!slug) return { prs: [], runs: [], error: null, slug: null }
  const key = `github:${repo}`
  const [cached, fresh] = cache().get<ProjectGithub>(key, { ttl: GITHUB_TTL })
  if (cached && fresh && !force) return cached
  try {
    const [prs, runs] = await Promise.all([
      gh<ProjectGithub['prs']>('pr', 'list', '-R', slug, '--state', 'open', '--limit', '10', '--json', 'number,title,url,isDraft,author,headRefName'),
      gh<ProjectGithub['runs']>('run', 'list', '-R', slug, '-L', '6', '--json', 'workflowName,headBranch,status,conclusion,url,createdAt,displayTitle'),
    ])
    const result: ProjectGithub = { prs, runs, error: null, slug, fetchedAt: Date.now() / 1000 }
    cache().put(key, result)
    return result
  } catch (e) {
    const error = (e as Error).message || 'GitHub error'
    if (cached) return { ...cached, stale: error }
    return { prs: [], runs: [], error, slug }
  }
}

export function projectGithubCached(repo: string): ProjectGithub | null {
  return cache().get<ProjectGithub>(`github:${repo}`, { ttl: GITHUB_TTL })[0]
}
