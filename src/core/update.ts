/* Self-update from RepoDeck's own git checkout.

A release is a commit that raises "version" in package.json (with notes in CHANGELOG.md). A newer
version can arrive two ways:
  disk    the checkout already has it (pulled in a terminal, or RepoDeck auto-pulled itself):
          only a restart is needed. Watched with a file watcher, so it shows up at once.
  remote  the upstream branch has it (checked by a quiet fetch every CHECK_SECONDS):
          applying fast-forwards the checkout first; anything else is refused, nothing changes.
bin/repodeck rebuilds on the next launch when the checkout moved.
*/

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateInfo } from '../shared/types'
import { GitError, run } from './git/run'
import { backgroundFetch, fastForward } from './git/sync'
import { toplevel } from './git/status'

export const VERSION_FILE = 'package.json'
export const CHANGELOG = 'CHANGELOG.md'
export const CHECK_SECONDS = Number(process.env.REPODECK_UPDATE_INTERVAL || 30 * 60)

export function parseVersion(text: string | null | undefined): string | null {
  if (!text) return null
  try {
    const v = JSON.parse(text).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** "1.10.2" -> [1, 10, 2]; anything unparsable sorts lowest. */
export function versionKey(version: string | null | undefined): number[] {
  if (!version) return []
  const parts = version.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
  return parts.some(Number.isNaN) ? [] : parts
}

export function newer(candidate: string | null | undefined, current: string): boolean {
  if (!candidate) return false
  const a = versionKey(candidate)
  const b = versionKey(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return false
    if (i >= b.length) return true
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** Bullets from CHANGELOG sections ("## 1.2.0 — date") newer than `current`. */
export function notesSince(changelog: string | null, current: string, limit = 6): string[] {
  const bullets: string[] = []
  let take = false
  for (const line of (changelog ?? '').split('\n')) {
    const heading = /^##\s+v?(\d+(?:\.\d+)*)/.exec(line)
    if (heading) take = newer(heading[1], current)
    else if (take && /^\s*[-*] /.test(line)) bullets.push(line.trimStart().slice(2).trim())
  }
  return bullets.slice(0, limit)
}

function readDisk(appDir: string, name: string): string {
  try {
    return readFileSync(join(appDir, name), 'utf8')
  } catch {
    return ''
  }
}

/**
 * The newest available update, or null. remote=false looks only at the checkout on disk
 * (update checks switched off in Preferences).
 */
export async function check(appDir: string, current: string, opts: { fetch?: boolean; remote?: boolean } = {}): Promise<UpdateInfo | null> {
  const { fetch = true, remote = true } = opts
  const onDisk = parseVersion(readDisk(appDir, VERSION_FILE))
  if (newer(onDisk, current)) return { version: onDisk!, source: 'disk', notes: notesSince(readDisk(appDir, CHANGELOG), current) }
  if (!remote || !(await toplevel(appDir))) return null
  let upstream: string
  try {
    if (fetch) await backgroundFetch(appDir)
    upstream = await run(appDir, ['show', `@{upstream}:${VERSION_FILE}`], { check: false })
  } catch {
    return null
  }
  const version = parseVersion(upstream)
  if (newer(version, current)) {
    const notes = await run(appDir, ['show', `@{upstream}:${CHANGELOG}`], { check: false })
    return { version: version!, source: 'remote', notes: notesSince(notes, current) }
  }
  return null
}

/** Bring the checkout to `update.version`. Throws GitError with a readable reason if it can't. */
export async function apply(appDir: string, update: UpdateInfo, current: string): Promise<void> {
  if (update.source === 'remote') {
    try {
      await fastForward(appDir)
    } catch (e) {
      throw new GitError(
        "RepoDeck's own checkout couldn't be fast-forwarded (local commits, or uncommitted edits " +
          `to files the update changes). Nothing was changed.\n\n${(e as Error).message}`,
      )
    }
  }
  const onDisk = parseVersion(readDisk(appDir, VERSION_FILE))
  if (!newer(onDisk, current)) throw new GitError(`Expected version ${update.version} in the checkout but found ${onDisk}.`)
}
