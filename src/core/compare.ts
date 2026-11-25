// The two versions of a file to compare (the renderer aligns and highlights them).

import { constants } from 'node:fs'
import { lstat, open, readlink } from 'node:fs/promises'
import type { Change, CommitFile, Status } from '../shared/types'
import { hasCommits } from '../shared/changes'
import { commitHash, run } from './git/run'
import { worktreePath } from './git/worktree'

export const MAX_BYTES = 1_500_000

/** Binary or too large to compare as text. */
export class Unreadable extends Error {}

function check(text: string): string {
  if (text.length > MAX_BYTES) throw new Unreadable('This file is too large to compare here.')
  if (text.slice(0, 8000).includes('\0')) throw new Unreadable('This is a binary file.')
  return text
}

async function showSpec(repo: string, spec: string): Promise<string> {
  return check(await run(repo, ['show', '--end-of-options', spec], { check: false }))
}

/**
 * The file's text as git sees it in the working tree, or '' when it isn't there. A symbolic link is
 * its target path (what git stores for it), never the file it points at; a file below a folder that
 * is a link counts as missing, as it does for git. So a link in a repository can never put another
 * file the user can read on screen.
 */
async function worktreeText(repo: string, rel: string): Promise<string> {
  try {
    const path = await worktreePath(repo, rel)
    if (!path) return ''
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      const target = await readlink(path)
      return (await worktreePath(repo, rel)) ? check(target) : ''
    }
    if (!info.isFile()) return ''
    // O_NOFOLLOW (where the platform has it): a link put there after the check is refused, not followed.
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      // The path can change while it is being opened: read only if what was opened is still the
      // file at this path, with no link on the way to it.
      const [opened, now] = await Promise.all([file.stat({ bigint: true }), lstat(path, { bigint: true })])
      if (!opened.isFile() || !now.isFile() || opened.dev !== now.dev || opened.ino !== now.ino) return ''
      if (!(await worktreePath(repo, rel))) return ''
      if (opened.size > MAX_BYTES) throw new Unreadable('This file is too large to compare here.')
      return check(await file.readFile('utf8'))
    } finally {
      await file.close()
    }
  } catch (e) {
    if (e instanceof Unreadable) throw e
    return '' // deleted, unreadable, or replaced while it was being read
  }
}

/** [old, new] for a working-tree change: last commit vs the file on disk. */
export async function workingVersions(repo: string, st: Status, change: Change): Promise<[string, string]> {
  let old = ''
  if (hasCommits(st) && change.kind === 'tracked' && change.x !== 'A') old = await showSpec(repo, `HEAD:${change.orig ?? change.path}`)
  return [old, await worktreeText(repo, change.path)]
}

/** [old, new] for one file of a commit, against its first parent. */
export async function commitVersions(repo: string, sha: string, f: CommitFile): Promise<[string, string]> {
  const rev = commitHash(sha)
  const old = f.letter === 'A' ? '' : await showSpec(repo, `${rev}^:${f.orig ?? f.path}`)
  const current = f.letter === 'D' ? '' : await showSpec(repo, `${rev}:${f.path}`)
  return [old, current]
}
