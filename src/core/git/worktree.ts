// Paths git reports are relative to the repository and use "/" on every platform. Before one is
// read or moved to the Trash it is resolved here, so nothing a repository holds (a folder that is a
// link, "..", a name with a "\") leads out of it.
//
// This is a look before the use, like git's own look for a link on the way to a path (`git diff` and
// `git restore` look, then open). It guards against what a repository holds, not against another
// program rewriting its folders between the look and the use: Node cannot open or move a file
// relative to a folder it has checked, and git's commands in the same working tree have that limit too.

import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

/** The folders and name of a path git reported, or null when it isn't a plain path inside a repository. */
export function worktreeParts(rel: string, platform: NodeJS.Platform = process.platform): string[] | null {
  // Windows also separates folders with "\": a name holding one (legal elsewhere, never checked out there)
  // would be taken apart again when it is joined to the repository.
  if (platform === 'win32' && rel.includes('\\')) return null
  const parts = (rel.endsWith('/') ? rel.slice(0, -1) : rel).split('/') // git marks a folder with a trailing "/"
  return parts.some((part) => part === '' || part === '.' || part === '..') ? null : parts
}

/**
 * Where a path git reported is on disk, or null when it isn't in the working tree as git sees it:
 * not a plain relative path, or below a folder that is missing or is a symbolic link (git calls the
 * files below such a link deleted, wherever it points). The last part itself may be a link.
 */
export async function worktreePath(repo: string, rel: string): Promise<string | null> {
  const parts = worktreeParts(rel)
  if (!parts) return null
  try {
    for (let i = 1; i < parts.length; i++) {
      if ((await lstat(join(repo, ...parts.slice(0, i)))).isSymbolicLink()) return null
    }
  } catch {
    return null
  }
  return join(repo, ...parts)
}
