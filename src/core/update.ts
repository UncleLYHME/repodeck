/* Updates for a copy run from its git checkout (installed copies use GitHub Releases, see src/main/updater.ts).

Commits are the unit, not version numbers (every push to main is a release):
  available  the upstream branch has new commits that change the app: Update fast-forwards the checkout
  ready      the checkout has commits the running build doesn't: bin/repodeck rebuilds on the next start
*/

import { noteLines, releaseOf } from '../shared/release'
import { exec, run } from './git/run'
import { backgroundFetch, fastForward } from './git/sync'
import { toplevel } from './git/status'

export const CHECK_SECONDS = Number(process.env.REPODECK_UPDATE_INTERVAL || 15 * 60)
const APP_PATHS = ['src', 'data', 'package.json', 'pnpm-lock.yaml', 'electron.vite.config.ts']

export interface CheckoutFinding {
  phase: 'available' | 'ready' | 'up-to-date'
  version: string | null
  notes: string[]
}

export function packageVersion(text: string | null | undefined): string | null {
  try {
    const v = JSON.parse(text ?? '').version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** Whether the app itself differs between two commits (docs-only commits don't need a rebuild). */
async function appChanged(appDir: string, a: string, b: string): Promise<boolean> {
  const r = await exec('git', ['-C', appDir, 'diff', '--quiet', a, b, '--', ...APP_PATHS], undefined)
  return r.code === 1
}

/** "2.2.4 · 1a2b3c4": the release that commit is (or becomes), and the commit. */
async function label(appDir: string, rev: string): Promise<string> {
  const [pkg, tags, latest] = await Promise.all([
    run(appDir, ['show', `${rev}:package.json`], { check: false }),
    run(appDir, ['tag', '--points-at', rev, '--list', 'v[0-9]*'], { check: false }),
    run(appDir, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', rev], { check: false }),
  ])
  return `${releaseOf(packageVersion(pkg) ?? '0.0.0', tags.split('\n'), latest.trim())} · ${rev.slice(0, 7)}`
}

async function notes(appDir: string, from: string, to: string): Promise<string[]> {
  const subjects = (await run(appDir, ['log', '--no-merges', '--format=%s', `${from}..${to}`], { check: false })).split('\n')
  return noteLines(subjects).slice(0, 6)
}

/** What's new for this checkout, compared with the commit the running build was made from. */
export async function inspect(appDir: string, built: string, opts: { fetch: boolean }): Promise<CheckoutFinding> {
  const none: CheckoutFinding = { phase: 'up-to-date', version: null, notes: [] }
  if (!(await toplevel(appDir))) return none
  if (opts.fetch) await backgroundFetch(appDir)
  const head = (await run(appDir, ['rev-parse', 'HEAD'])).trim()
  const upstream = (await run(appDir, ['rev-parse', '-q', '--verify', '@{upstream}'], { check: false })).trim()
  if (upstream && upstream !== head) {
    const behind = (await exec('git', ['-C', appDir, 'merge-base', '--is-ancestor', head, upstream], undefined)).code === 0
    if (behind && (await appChanged(appDir, head, upstream))) {
      return { phase: 'available', version: await label(appDir, upstream), notes: await notes(appDir, head, upstream) }
    }
  }
  if (built && built !== head && (await appChanged(appDir, built, head).catch(() => true))) {
    return { phase: 'ready', version: await label(appDir, head), notes: await notes(appDir, built, head) }
  }
  return none
}

/** Bring the checkout up to its upstream (fast-forward only). The next start rebuilds. */
export async function download(appDir: string): Promise<void> {
  try {
    await fastForward(appDir)
  } catch (e) {
    throw new Error(
      "RepoDeck's own checkout couldn't be fast-forwarded (local commits, or uncommitted edits " +
        `to files the update changes). Nothing was changed.\n\n${(e as Error).message}`,
    )
  }
}
