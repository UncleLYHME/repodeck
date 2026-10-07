// The two versions of a file to compare (the renderer aligns and highlights them).

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Change, CommitFile, Status } from '../shared/types'
import { hasCommits } from '../shared/changes'
import { run } from './git/run'

export const MAX_BYTES = 1_500_000

/** Binary or too large to compare as text. */
export class Unreadable extends Error {}

function check(text: string): string {
  if (text.length > MAX_BYTES) throw new Unreadable('This file is too large to compare here.')
  if (text.slice(0, 8000).includes('\0')) throw new Unreadable('This is a binary file.')
  return text
}

async function showSpec(repo: string, spec: string): Promise<string> {
  return check(await run(repo, ['show', spec], { check: false }))
}

/** [old, new] for a working-tree change: last commit vs the file on disk. */
export async function workingVersions(repo: string, st: Status, change: Change): Promise<[string, string]> {
  let old = ''
  if (hasCommits(st) && change.kind === 'tracked' && change.x !== 'A') old = await showSpec(repo, `HEAD:${change.orig ?? change.path}`)
  const path = join(repo, change.path)
  let current = ''
  try {
    const info = await stat(path)
    if (info.isFile()) {
      if (info.size > MAX_BYTES) throw new Unreadable('This file is too large to compare here.')
      current = check(await readFile(path, 'utf8'))
    }
  } catch (e) {
    if (e instanceof Unreadable) throw e
  }
  return [old, current]
}

/** [old, new] for one file of a commit, against its first parent. */
export async function commitVersions(repo: string, sha: string, f: CommitFile): Promise<[string, string]> {
  const old = f.letter === 'A' ? '' : await showSpec(repo, `${sha}^:${f.orig ?? f.path}`)
  const current = f.letter === 'D' ? '' : await showSpec(repo, `${sha}:${f.path}`)
  return [old, current]
}
