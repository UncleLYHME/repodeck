/* The activity log: what RepoDeck did, on its own and for you.

Entries live in memory (newest last) and are appended to a JSON-lines file so the log
survives restarts; the file is rewritten to the newest KEEP entries when it grows past twice that.
The format is RepoDeck 1.x's, so older history carries over.
*/

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ActivityEntry, Level, Who } from '../shared/types'
import { stateDir } from './paths'

export const LIMITS = { keep: 500 }

export class ActivityLog {
  entries: ActivityEntry[] = []
  private lines = 0
  private listeners: ((e: ActivityEntry | null) => void)[] = []

  constructor(readonly path: string) {
    let lines: string[] = []
    try {
      lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    } catch {
      // first run
    }
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
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      if (this.lines >= 2 * LIMITS.keep) {
        writeFileSync(this.path, this.entries.map((e) => JSON.stringify(e) + '\n').join(''))
        this.lines = this.entries.length
      } else {
        appendFileSync(this.path, JSON.stringify(entry) + '\n')
        this.lines += 1
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
    try {
      writeFileSync(this.path, '')
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
