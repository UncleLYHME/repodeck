import { status } from './status'
import { GitError, NETWORK_TIMEOUT, QUIET_ENV, run } from './run'

export function fetch(repo: string): Promise<string> {
  return run(repo, ['fetch', '--all', '--prune'], { timeout: NETWORK_TIMEOUT })
}

/** Fetch without any prompts. Returns false when the repo has no remotes. */
export async function backgroundFetch(repo: string): Promise<boolean> {
  if (!(await run(repo, ['remote'])).trim()) return false
  await run(repo, ['fetch', '--all', '--prune', '--quiet'], { timeout: 60_000, env: QUIET_ENV })
  return true
}

export function pull(repo: string): Promise<string> {
  return run(repo, ['pull', '--ff-only'], { timeout: NETWORK_TIMEOUT })
}

/**
 * Move the branch up to its already-fetched upstream. Local only; refuses anything but a fast-forward.
 *
 * Uncommitted changes are kept; git refuses (changing nothing) if incoming commits touch those files.
 */
export function fastForward(repo: string): Promise<string> {
  return run(repo, ['merge', '--ff-only', '--quiet', '@{upstream}'])
}

async function rebaseOntoUpstream(repo: string): Promise<void> {
  try {
    await run(repo, ['rebase', '--autostash', '@{upstream}'])
  } catch (e) {
    if ((await status(repo)).operation === 'rebase') await run(repo, ['rebase', '--abort'], { check: false })
    throw new GitError(
      'Your local commits conflict with new commits on the remote, so nothing was pushed ' +
        `and your branch was left as it was. Pull and resolve the conflict manually.\n\n${(e as Error).message}`,
    )
  }
}

/** Push, first bringing in any new remote commits so the push is never rejected for being behind. */
export async function push(repo: string, upstream: string | null): Promise<string> {
  if (!upstream) return run(repo, ['push', '-u', 'origin', 'HEAD'], { timeout: NETWORK_TIMEOUT })
  await run(repo, ['fetch', '--quiet'], { timeout: NETWORK_TIMEOUT })
  const fresh = await status(repo)
  if (fresh.operation) throw new GitError(`A ${fresh.operation} is in progress; finish or abort it before pushing.`)
  if (fresh.behind) {
    if (fresh.ahead) await rebaseOntoUpstream(repo) // replay unpushed commits on top of the remote's
    else await fastForward(repo)
  }
  return run(repo, ['push'], { timeout: NETWORK_TIMEOUT })
}
