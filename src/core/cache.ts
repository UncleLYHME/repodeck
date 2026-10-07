/* A small shared cache: in memory, persisted as JSON so the app starts with data on screen.

Two kinds of entry:
- versioned: valid while a version string matches (e.g. a repo's ref fingerprint), so derived
  git data is reused until a commit, fetch, checkout or branch change makes it stale;
- timed: valid for a TTL (network data such as GitHub), still returned past its TTL as
  "stale" so the UI can show the last known value while it revalidates.

Values must be JSON-serialisable. Entries unused for PRUNE_DAYS are dropped on load.
*/

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cacheDir } from './paths'

export const FORMAT = 2 // bump when a cached value's shape changes
export const PRUNE_DAYS = 30
const SAVE_DELAY = 2000

interface Entry {
  v: string | null // version
  t: number // stored at (seconds)
  used: number // last read (seconds)
  data: unknown
}

const now = () => Date.now() / 1000

export class Cache {
  entries: Record<string, Entry> = {}
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly path: string) {
    this.load()
  }

  private load(): void {
    let raw: { format?: number; entries?: Record<string, Entry> }
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      return
    }
    if (!raw || raw.format !== FORMAT) return
    const cutoff = now() - PRUNE_DAYS * 86400
    for (const [k, e] of Object.entries(raw.entries ?? {})) if ((e?.used ?? 0) >= cutoff) this.entries[k] = e
  }

  /**
   * [value, fresh] for a matching entry, else [null, false].
   *
   * With `version`, only an entry stored under that version matches. With `ttl` (seconds), an
   * older entry still comes back, with fresh=false.
   */
  get<T>(key: string, opts: { version?: string; ttl?: number } = {}): [T | null, boolean] {
    const e = this.entries[key]
    if (!e || (opts.version !== undefined && e.v !== opts.version)) return [null, false]
    e.used = now()
    return [e.data as T, opts.ttl === undefined || now() - e.t < opts.ttl]
  }

  age(key: string): number | null {
    const e = this.entries[key]
    return e ? now() - e.t : null
  }

  put(key: string, value: unknown, version: string | null = null): void {
    const t = now()
    this.entries[key] = { v: version, t, used: t, data: value }
    this.scheduleSave()
  }

  drop(key: string): void {
    delete this.entries[key]
  }

  clear(): void {
    this.entries = {}
    this.save()
  }

  private scheduleSave(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.save(), SAVE_DELAY)
    this.timer.unref?.()
  }

  save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = this.path.replace(/\.json$/, '') + '.tmp'
      writeFileSync(tmp, JSON.stringify({ format: FORMAT, entries: this.entries }))
      renameSync(tmp, this.path) // atomic: a crash never leaves a half-written cache
    } catch {
      // a cache that can't be written just isn't persisted
    }
  }
}

let shared: Cache | null = null

export function cache(): Cache {
  return (shared ??= new Cache(join(cacheDir(), 'cache-v2.json')))
}

/** Tests swap in a throwaway cache. */
export function setSharedCache(c: Cache): void {
  shared = c
}
