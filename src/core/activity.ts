/* The activity log: what RepoDeck did, on its own and for you.

Entries live in memory (newest last) and are appended to a JSON-lines file so the log
survives restarts; the file is rewritten to the newest KEEP entries when it grows past twice that.
The format is RepoDeck 1.x's, so older history carries over.
*/

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ActivityEntry, Level, Who } from '../shared/types'
import { stateDir } from './paths'
import { appendPrivate, readPrivateFile, replacePrivate } from './private'

export const LIMITS = { keep: 500 }

export class ActivityLog {
  entries: ActivityEntry[] = []
  private lines = 0
  // Another account's log that could not be carried over: left as it is, and this run's log is kept in
  // memory only, so that nothing written in its place loses it.
  private theirs = false
  private listeners: ((e: ActivityEntry | null) => void)[] = []

  constructor(readonly path: string) {
    const { text, theirs } = readPrivateFile(path)
    this.theirs = theirs
    const lines = (text ?? '').split('\n').filter(Boolean) // nothing on a first run
    this.lines = lines.length
    for (const line of lines.slice(-LIMITS.keep)) {
      try {
        const e = JSON.parse(line)
        if (typeof e.ts !== 'number' || typeof e.message !== 'string') continue
        this.entries.push({ ts: e.ts, message: e.message, repo: e.repo ?? null, who: e.who ?? 'you', level: e.level ?? 'info' })
      } catch {
        continue
      }
    }
  }

  add(message: string, repo: string | null = null, who: Who = 'you', level: Level = 'info'): ActivityEntry {
    const entry: ActivityEntry = { ts: Date.now() / 1000, message, repo, who, level }
    this.entries.push(entry)
    if (this.entries.length > LIMITS.keep) this.entries.splice(0, this.entries.length - LIMITS.keep)
    if (!this.theirs) try {
      mkdirSync(dirname(this.path), { recursive: true })
      // Appended to the log when it is RepoDeck's own (or not there yet); otherwise (grown too long,
      // or something else in its place) written out anew from what is in memory.
      if (this.lines < 2 * LIMITS.keep && appendPrivate(this.path, JSON.stringify(entry) + '\n')) {
        this.lines += 1
      } else {
        replacePrivate(this.path, this.entries.map((e) => JSON.stringify(e) + '\n').join(''))
        this.lines = this.entries.length
      }
    } catch {
      // the log is a convenience; never let it break an action
    }
    for (const fn of this.listeners) fn(entry)
    return entry
  }

  clear(): void {
    this.entries = []
    this.lines = 0
    if (!this.theirs) try {
      replacePrivate(this.path, '')
    } catch {
      // nothing to clear
    }
    for (const fn of this.listeners) fn(null)
  }

  /** fn(entry) for each new entry; fn(null) after clear(). */
  subscribe(fn: (e: ActivityEntry | null) => void): void {
    this.listeners.push(fn)
  }
}

let shared: ActivityLog | null = null

export function activity(): ActivityLog {
  return (shared ??= new ActivityLog(join(stateDir(), 'activity.jsonl')))
}

export function setSharedActivity(log: ActivityLog): void {
  shared = log
}

export function log(message: string, repo: string | null = null, who: Who = 'you', level: Level = 'info'): ActivityEntry {
  return activity().add(message, repo, who, level)
}
