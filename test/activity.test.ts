import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActivityLog, LIMITS } from '../src/core/activity'
import { tempDir } from './helpers'

describe('activity log', () => {
  it('persists, reloads and compacts', () => {
    const path = join(tempDir(), 'a.jsonl')
    const log = new ActivityLog(path)
    log.add('pulled 2 commits', '/r/app', 'auto')
    log.add('push failed: offline', '/r/app', 'you', 'error')
    const again = new ActivityLog(path)
    expect(again.entries.map((e) => e.message)).toEqual(['pulled 2 commits', 'push failed: offline'])
    expect([again.entries[1].who, again.entries[1].level]).toEqual(['you', 'error'])

    const keep = LIMITS.keep
    LIMITS.keep = 5
    try {
      const small = new ActivityLog(path)
      for (let i = 0; i < 12; i++) small.add(`e${i}`)
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
      expect(lines.length).toBeLessThanOrEqual(10) // rewritten to the newest entries once it doubled
      expect(JSON.parse(lines[lines.length - 1]).message).toBe('e11')
      expect(new ActivityLog(path).entries.at(-1)!.message).toBe('e11')
    } finally {
      LIMITS.keep = keep
    }
  })

  it('clears and skips bad lines', () => {
    const path = join(tempDir(), 'a.jsonl')
    writeFileSync(path, '{"ts": 1, "message": "ok"}\nnot json\n{"oops": 1}\n')
    const log = new ActivityLog(path)
    expect(log.entries.map((e) => e.message)).toEqual(['ok'])
    log.clear()
    expect([log.entries, readFileSync(path, 'utf8')]).toEqual([[], ''])
  })
})
