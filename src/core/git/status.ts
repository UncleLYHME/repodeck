import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { Change, CommitFile, LogRow, Operation, RefKind, Status } from '../../shared/types'
import { hasCommits } from '../../shared/changes'
import { GitError, SEP, run, splitN } from './run'

export const LOG_LIMIT = 300

const OPERATION_MARKERS: [Operation, string][] = [
  ['merge', 'MERGE_HEAD'], ['rebase', 'rebase-merge'], ['rebase', 'rebase-apply'],
  ['cherry-pick', 'CHERRY_PICK_HEAD'], ['revert', 'REVERT_HEAD'], ['bisect', 'BISECT_LOG'],
]

export async function status(repo: string): Promise<Status> {
  const out = await run(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  const st: Status = { branch: '', oid: '', upstream: null, ahead: 0, behind: 0, operation: null, changes: [] }
  const recs = out.split('\0')
  const change = (path: string, xy: string, extra: Partial<Change> = {}): Change =>
    ({ path, x: xy[0], y: xy[1], kind: 'tracked', orig: null, ...extra })
  for (let i = 0; i < recs.length; ) {
    const r = recs[i++]
    if (!r) continue
    const kind = r[0]
    if (kind === '#') {
      const [key, val = ''] = splitN(r.slice(2), ' ', 1)
      if (key === 'branch.head') st.branch = val
      else if (key === 'branch.oid') st.oid = val
      else if (key === 'branch.upstream') st.upstream = val
      else if (key === 'branch.ab') {
        const [a, b] = val.split(' ')
        st.ahead = parseInt(a, 10)
        st.behind = -parseInt(b, 10)
      }
    } else if (kind === '1') {
      const p = splitN(r, ' ', 8)
      st.changes.push(change(p[8], p[1]))
    } else if (kind === '2') {
      const p = splitN(r, ' ', 9)
      st.changes.push(change(p[9], p[1], { orig: recs[i++] }))
    } else if (kind === 'u') {
      const p = splitN(r, ' ', 10)
      st.changes.push(change(p[10], p[1], { kind: 'conflict' }))
    } else if (kind === '?') {
      st.changes.push({ path: r.slice(2), x: '?', y: '?', kind: 'untracked', orig: null })
    }
  }
  const gitDir = (await run(repo, ['rev-parse', '--absolute-git-dir'])).trim()
  st.operation = OPERATION_MARKERS.find(([, marker]) => existsSync(join(gitDir, marker)))?.[0] ?? null
  return st
}

/**
 * Changes whenever commits, branches, tags, remote-tracking refs, the stash or HEAD change.
 *
 * Data derived from history (logs, stats) stays valid while this is unchanged; working-tree
 * edits don't affect it. Tool-private refs (e.g. refs/t3/*) are left out: they churn constantly.
 */
export async function fingerprint(repo: string): Promise<string> {
  const [refs, head] = await Promise.all([
    run(repo, ['for-each-ref', '--format=%(objectname) %(HEAD) %(refname)', 'refs/heads', 'refs/remotes', 'refs/tags', 'refs/stash']),
    run(repo, ['rev-parse', '-q', '--verify', 'HEAD'], { check: false }),
  ])
  return createHash('sha1').update(refs + head).digest('hex')
}

/** The repository root containing `path`, or null. */
export async function toplevel(path: string): Promise<string | null> {
  try {
    const top = (await run(path, ['rev-parse', '--show-toplevel'])).trim()
    if (!top) return null
    return process.platform === 'win32' ? normalize(top) : top // git answers C:/x on Windows; paths elsewhere are C:\x
  } catch {
    return null
  }
}

/** Repositories directly inside a folder of projects. */
export function childRepos(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((d) => {
        if (!d.isDirectory() && !(d.isSymbolicLink() && isDir(join(folder, d.name)))) return false
        return existsSync(join(folder, d.name, '.git'))
      })
      .map((d) => join(folder, d.name))
      .sort()
  } catch {
    return []
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** A repo itself, or the repos directly inside a folder of projects. */
export async function findRepos(folder: string): Promise<string[]> {
  const root = await toplevel(folder)
  return root ? [root] : childRepos(folder)
}

export function parseRefs(decoration: string, remotes: Set<string>): [RefKind, string][] {
  const refs: [RefKind, string][] = []
  for (const part of decoration.split(',').map((s) => s.trim())) {
    if (!part || part.endsWith('/HEAD')) continue
    if (part.startsWith('HEAD -> ')) refs.push(['head', part.slice(8)])
    else if (part === 'HEAD') refs.push(['head', 'HEAD'])
    else if (part.startsWith('tag: ')) refs.push(['tag', part.slice(5)])
    else if (remotes.has(part.split('/')[0])) refs.push(['remote', part])
    else refs.push(['branch', part])
  }
  return refs
}

export async function log(repo: string, st: Status): Promise<LogRow[]> {
  if (!hasCommits(st)) return []
  const remotes = new Set((await run(repo, ['remote'])).split(/\s+/).filter(Boolean))
  const fmt = ['%h', '%H', '%P', '%D', '%an', '%ar', '%s'].join(SEP)
  // --date-order keeps every child above its parents, which the lane layout relies on.
  const out = await run(repo, ['log', '--date-order', `-n${LOG_LIMIT}`, '--branches', '--remotes', '--tags', 'HEAD', `--format=${fmt}`])
  return out.split('\n').filter(Boolean).map((line) => {
    const [sha, fullSha, parents, deco, author, when, subject] = splitN(line, SEP, 6)
    return { sha, fullSha, parents: parents.split(' ').filter(Boolean), refs: parseRefs(deco, remotes), subject, author, when }
  })
}

export function show(repo: string, sha: string): Promise<string> {
  return run(repo, ['show', '--stat', '--patch', '--format=fuller', sha])
}

// Merges list what they brought in relative to the branch they were merged into.
const COMMIT_DIFF = ['--format=', '-M', '--diff-merges=first-parent']

export async function commitFiles(repo: string, sha: string): Promise<CommitFile[]> {
  const recs = (await run(repo, ['show', ...COMMIT_DIFF, '--name-status', '-z', sha])).split('\0')
  const files: CommitFile[] = []
  for (let i = 0; i < recs.length; ) {
    const code = recs[i++]
    if (!code) continue
    if ('RC'.includes(code[0])) {
      files.push({ path: recs[i + 1], letter: code[0], orig: recs[i] })
      i += 2
    } else {
      files.push({ path: recs[i], letter: code[0], orig: null })
      i += 1
    }
  }
  return files
}

export function commitFileDiff(repo: string, sha: string, f: CommitFile): Promise<string> {
  const paths = f.orig ? [f.orig, f.path] : [f.path]
  return run(repo, ['show', ...COMMIT_DIFF, sha, '--', ...paths])
}

export { GitError }
