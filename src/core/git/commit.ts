import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Change, Status } from '../../shared/types'
import { hasCommits, isPartial } from '../../shared/changes'
import { GitError, run } from './run'

/** Commit exactly the selected files, leaving everything else as it was. */
export async function commit(repo: string, st: Status, message: string, changes: Change[]): Promise<string> {
  if (!message.trim()) throw new GitError('Write a commit message first.')
  if (!changes.length) throw new GitError('Select at least one file to commit.')
  const paths: string[] = []
  for (const c of changes) {
    if (c.orig) paths.push(c.orig)
    paths.push(c.path)
  }
  if (st.operation === 'merge') {
    // Git refuses partial commits during a merge: stage the selection, commit the index.
    await run(repo, ['add', '-A', '--', ...paths])
    return run(repo, ['commit', '-m', message])
  }
  return commitSelection(repo, st, message, changes, paths)
}

/**
 * Like `git commit --only`, but partially staged files contribute their staged version.
 *
 * A temporary index starts from HEAD and receives just the selection; after committing, the
 * real index is reset for those paths only, so other staged work and unstaged remainders stay.
 */
async function commitSelection(repo: string, st: Status, message: string, changes: Change[], paths: string[]): Promise<string> {
  const realIndex = (await run(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim()
  const tmp = await mkdtemp(join(tmpdir(), 'repodeck-'))
  let out: string
  try {
    const env = { GIT_INDEX_FILE: join(tmp, 'index') }
    await run(repo, ['read-tree', hasCommits(st) ? 'HEAD' : '--empty'], { env })
    const whole: string[] = []
    for (const c of changes) {
      if (!isPartial(c)) {
        whole.push(...(c.orig ? [c.orig, c.path] : [c.path]))
        continue
      }
      if (c.orig) await run(repo, ['rm', '--cached', '-q', '--ignore-unmatch', '--', c.orig], { env })
      const entry = (await run(repo, ['ls-files', '-s', '--', c.path], { env: { GIT_INDEX_FILE: realIndex } })).split(/\s+/)
      await run(repo, ['update-index', '--add', '--cacheinfo', `${entry[0]},${entry[1]},${c.path}`], { env })
    }
    if (whole.length) await run(repo, ['add', '-A', '--', ...whole], { env })
    out = await run(repo, ['commit', '-m', message], { env })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  await run(repo, ['reset', '-q', '--', ...paths])
  return out
}
