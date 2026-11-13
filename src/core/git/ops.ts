// Working-tree operations beyond commit/sync: discard, hunks, branches, ignore, stash, abort, identity.

import { constants, lstatSync, readdirSync } from 'node:fs'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Branches, Change, Hunk, Operation, Profile, Status } from '../../shared/types'
import { hasCommits } from '../../shared/changes'
import { basename } from '../../shared/time'
import { GitError, run } from './run'

const DIFF = ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

export type Trash = (path: string) => Promise<void>

// -- discard ----------------------------------------------------------------------

/** Throw away changes: tracked files go back to HEAD, new files go to the Trash. */
export async function discard(repo: string, st: Status, changes: Change[], trash: Trash): Promise<void> {
  if (changes.some((c) => c.kind === 'conflict')) {
    throw new GitError("Conflicted files can't be discarded here; abort the merge or resolve them first.")
  }
  const bin = async (path: string) => {
    const full = join(repo, path)
    if (lexists(full)) await trash(full)
  }
  for (const c of changes) {
    if (c.kind === 'untracked') {
      await bin(c.path)
    } else if (!hasCommits(st) || 'AC'.includes(c.x)) {
      // new in the index: unstage, then bin the file
      await run(repo, ['rm', '--cached', '-q', '--ignore-unmatch', '--', c.path])
      await bin(c.path)
    } else if (c.orig && c.x === 'R') {
      await run(repo, ['restore', '--source=HEAD', '--staged', '--worktree', '--', c.orig])
      await run(repo, ['rm', '--cached', '-q', '--ignore-unmatch', '--', c.path])
      await bin(c.path)
    } else {
      await run(repo, ['restore', '--source=HEAD', '--staged', '--worktree', '--', c.path])
    }
  }
}

function lexists(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

// -- hunks ------------------------------------------------------------------------

export function splitHunks(diff: string): Hunk[] {
  const lines = diff.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let start = lines.findIndex((l) => l.startsWith('@@'))
  if (start < 0) start = lines.length
  const header = lines.slice(0, start).join('')
  const hunks: Hunk[] = []
  let current: string[] = []
  for (const line of lines.slice(start)) {
    if (line.startsWith('@@') && current.length) {
      hunks.push({ header, body: current.join('') })
      current = []
    }
    current.push(line)
  }
  if (current.length) hunks.push({ header, body: current.join('') })
  return hunks
}

export async function hunks(repo: string, path: string, staged: boolean): Promise<Hunk[]> {
  return splitHunks(await run(repo, [...DIFF, ...(staged ? ['--cached'] : []), '--', path]))
}

export type HunkMode = 'stage' | 'unstage' | 'discard'

export async function applyHunk(repo: string, patch: string, mode: HunkMode): Promise<void> {
  const flags = { stage: ['--cached'], unstage: ['--cached', '-R'], discard: ['-R'] }[mode]
  await run(repo, ['apply', ...flags, '--whitespace=nowarn', '-'], { input: patch })
}

// -- branches -----------------------------------------------------------------------

export async function branches(repo: string): Promise<Branches> {
  const out = await run(repo, ['for-each-ref', '--sort=-committerdate',
    '--format=%(refname)\x1f%(refname:short)\x1f%(upstream:short)', 'refs/heads', 'refs/remotes'])
  const local: [string, string][] = []
  let remote: string[] = []
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, short, upstream] = line.split('\x1f')
    if (ref.startsWith('refs/heads/')) local.push([short, upstream])
    else if (!ref.endsWith('/HEAD') && short.includes('/')) remote.push(short)
  }
  const tracked = new Set([...local.filter(([, u]) => u).map(([, u]) => u), ...local.map(([n]) => n)])
  remote = remote.filter((r) => !tracked.has(r) && !tracked.has(r.split('/').slice(1).join('/')))
  const current = (await run(repo, ['branch', '--show-current'])).trim()
  return { current, local, remote }
}

export async function switchBranch(repo: string, name: string): Promise<void> {
  await run(repo, ['switch', '--no-guess', name])
}

export async function switchRemote(repo: string, remoteRef: string): Promise<void> {
  await run(repo, ['switch', '-c', remoteRef.split('/').slice(1).join('/'), '--track', remoteRef])
}

export async function createBranch(repo: string, name: string): Promise<void> {
  name = name.trim()
  if ((await run(repo, ['check-ref-format', '--branch', name], { check: false })).trim() !== name) {
    throw new GitError(`'${name}' isn't a valid branch name.`)
  }
  await run(repo, ['switch', '-c', name])
}

// -- ignore ---------------------------------------------------------------------------

export { gitignoreEscape, ignoreChoices, suffix } from '../../shared/ignore'

/**
 * Add `pattern` to the repo's .gitignore (once). Paths in `untrack` stop being tracked but stay on disk.
 * Refuses a .gitignore that is a symlink (it could point outside the repo) and patterns with a line break
 * (they would smuggle extra rules into the file).
 */
export async function ignore(repo: string, pattern: string, untrack: string[] = []): Promise<void> {
  if (/[\r\n]/.test(pattern)) throw new GitError("That file name contains a line break, which can't be written to .gitignore.")
  const path = join(repo, '.gitignore')
  const info = lstatOrNull(path)
  if (info?.isSymbolicLink()) throw new GitError('.gitignore is a symbolic link; refusing to write through it.')
  if (info && !info.isFile()) throw new GitError('.gitignore is not a regular file.')
  let text = ''
  const file = info ? await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)) : null
  try {
    if (file) {
      const [opened, current] = await Promise.all([file.stat({ bigint: true }), lstat(path, { bigint: true })])
      if (!current.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) {
        throw new GitError('.gitignore changed while it was being opened; refusing to write it.')
      }
      text = await file.readFile('utf8')
    }
  } finally {
    await file?.close()
  }
  if (!text.split(/\r?\n/).includes(pattern)) {
    if (text && !text.endsWith('\n')) text += '\n'
    const temp = join(repo, `.gitignore.repodeck-${randomUUID()}.tmp`)
    const replacement = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, info ? Number(info.mode) & 0o777 : 0o644)
    try {
      await replacement.writeFile(text + pattern + '\n', 'utf8')
      await replacement.sync()
      await replacement.close()
      await rename(temp, path)
    } catch (error) {
      await replacement.close().catch(() => {})
      await unlink(temp).catch(() => {})
      throw error
    }
  }
  if (untrack.length) await run(repo, ['rm', '--cached', '-q', '-r', '--ignore-unmatch', '--', ...untrack])
}

function lstatOrNull(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}

// -- stash, abort ---------------------------------------------------------------------

export async function stashes(repo: string): Promise<string[]> {
  return (await run(repo, ['stash', 'list', '--format=%gd\x1f%s'])).split('\n').filter(Boolean)
}

// `stash -u` silently skips untracked files under GIT_LITERAL_PATHSPECS (git 2.43).
const STASH_ENV = { GIT_LITERAL_PATHSPECS: '0' }

export async function stash(repo: string): Promise<void> {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  await run(repo, ['stash', 'push', '--include-untracked', '-m', `RepoDeck ${stamp}`], { env: STASH_ENV })
}

export async function stashPop(repo: string): Promise<void> {
  await run(repo, ['stash', 'pop'], { env: STASH_ENV })
}

const ABORT: Record<Operation, string[]> = {
  merge: ['merge', '--abort'], rebase: ['rebase', '--abort'], 'cherry-pick': ['cherry-pick', '--abort'],
  revert: ['revert', '--abort'], bisect: ['bisect', 'reset'],
}

export async function abort(repo: string, operation: Operation): Promise<void> {
  await run(repo, ABORT[operation])
}

// -- identity ---------------------------------------------------------------------------

/** [name, email] git would commit with here; either may be empty. */
export async function identity(repo: string): Promise<{ name: string; email: string }> {
  const get = async (key: string) => (await run(repo, ['config', '--get', key], { check: false })).trim()
  const [name, email] = await Promise.all([get('user.name'), get('user.email')])
  return { name, email }
}

/** Identities defined in the global config and ~/.gitconfig-* include files. */
export async function profiles(home = homedir()): Promise<Profile[]> {
  let extra: string[] = []
  try {
    extra = readdirSync(home).filter((n) => n.startsWith('.gitconfig-')).sort().map((n) => join(home, n))
  } catch {
    // no readable home
  }
  const found: Profile[] = []
  for (const path of [join(home, '.gitconfig'), ...extra]) {
    const get = async (key: string) => (await run('/', ['config', '-f', path, '--get', key], { check: false })).trim()
    const [name, email] = await Promise.all([get('user.name'), get('user.email')])
    if (name && email && !found.some((p) => p.name === name && p.email === email)) {
      const raw = basename(path).replace(/^\.gitconfig-/, '').replace(/^\.gitconfig$/, 'global')
      found.push({ label: raw[0].toUpperCase() + raw.slice(1).toLowerCase(), name, email })
    }
  }
  return found
}

export async function setIdentity(repo: string, name: string, email: string): Promise<void> {
  if (!name.trim() || !email.includes('@')) throw new GitError('Enter a name and an email address.')
  await run(repo, ['config', '--local', 'user.name', name.trim()])
  await run(repo, ['config', '--local', 'user.email', email.trim()])
}
