import { execFileSync } from 'node:child_process'
import { accessSync, chmodSync, closeSync, constants, existsSync, linkSync, lstatSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it.skipIf(process.platform === 'win32')('keeps the log to the user', () => {
    const mode = (path: string) => statSync(path).mode & 0o777
    const fresh = join(tempDir(), 'a.jsonl')
    new ActivityLog(fresh).add('pulled 2 commits', '/r/private-project', 'auto')
    expect(mode(fresh)).toBe(0o600)

    // A log from an earlier version, readable by every account, with someone already reading it:
    // it becomes a new private file, so what is logged from now on never reaches that reader.
    const old = join(tempDir(), 'a.jsonl')
    const before = '{"ts": 1, "message": "from an earlier version"}\n'
    writeFileSync(old, before)
    chmodSync(old, 0o644)
    const reader = openSync(old, constants.O_RDONLY)
    try {
      const log = new ActivityLog(old)
      expect(log.entries.map((e) => e.message)).toEqual(['from an earlier version'])
      expect(mode(old)).toBe(0o600)
      log.add('pushed', '/r/private-project')
      expect(readFileSync(reader, 'utf8')).toBe(before)
      expect(new ActivityLog(old).entries.map((e) => e.message)).toEqual(['from an earlier version', 'pushed'])
      log.clear()
      expect([mode(old), readFileSync(old, 'utf8')]).toEqual([0o600, ''])

      // put back from a backup while RepoDeck runs: replaced by a private file before anything more is logged
      const restored = join(tempDir(), 'restored.jsonl')
      writeFileSync(restored, before)
      chmodSync(restored, 0o644)
      renameSync(restored, old)
      log.add('pushed again', '/r/private-project')
      expect(mode(old)).toBe(0o600)
      expect(new ActivityLog(old).entries.map((e) => e.message)).toEqual(['pushed again'])
    } finally {
      closeSync(reader)
    }

    // a name as long as a folder takes still leaves room for the new file written beside it
    const long = join(tempDir(), 'a'.repeat(255))
    writeFileSync(long, before)
    chmodSync(long, 0o644)
    expect(new ActivityLog(long).entries.map((e) => e.message)).toEqual(['from an earlier version'])
    expect(mode(long)).toBe(0o600)

    // two RepoDecks starting on one log: neither writes over what the other logged first
    const shared = join(tempDir(), 'a.jsonl')
    const [one, two] = [new ActivityLog(shared), new ActivityLog(shared)]
    one.add('pulled', '/r/private-project', 'auto')
    two.add('pushed', '/r/private-project')
    expect(mode(shared)).toBe(0o600)
    expect(new ActivityLog(shared).entries.map((e) => e.message)).toEqual(['pulled', 'pushed'])
  })

  it.skipIf(process.platform === 'win32')('keeps the log to the user in a folder that takes no new file', (ctx) => {
    // A log can't be replaced by a new file there, so it is changed where it stands.
    const mode = (path: string) => statSync(path).mode & 0o777
    const onDisk = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).message)
    const closed = (folder: string): boolean => {
      chmodSync(folder, 0o555)
      try {
        accessSync(folder, constants.W_OK)
        return false // an administrator writes anywhere: no folder is closed to this run
      } catch {
        return true
      }
    }
    const [own, old] = [tempDir(), tempDir()]
    const keep = LIMITS.keep
    try {
      // RepoDeck's own log: added to, trimmed and cleared as anywhere else.
      const mine = join(own, 'a.jsonl')
      new ActivityLog(mine).add('pushed', '/r/private-project')
      if (!closed(own)) ctx.skip()
      LIMITS.keep = 2
      const log = new ActivityLog(mine)
      for (let i = 0; i < 5; i++) log.add(`e${i}`)
      expect(onDisk(mine)).toEqual(['e2', 'e3', 'e4']) // trimmed to the newest two once it doubled, then added to again
      log.clear()
      expect([mode(mine), readFileSync(mine, 'utf8'), readdirSync(own)]).toEqual([0o600, '', ['a.jsonl']])
      LIMITS.keep = keep

      // A log from an earlier version, readable by every account: closed to the others, and nothing
      // more is written to it (somebody who opened it before still has it open). Clearing empties it.
      const theirs = join(old, 'a.jsonl')
      writeFileSync(theirs, '{"ts": 1, "message": "from an earlier version"}\n')
      chmodSync(theirs, 0o644)
      closed(old)
      const legacy = new ActivityLog(theirs)
      expect([legacy.entries.map((e) => e.message), mode(theirs)]).toEqual([['from an earlier version'], 0o400])
      legacy.add('pushed', '/r/private-project')
      expect([onDisk(theirs), mode(theirs)]).toEqual([['from an earlier version'], 0o400])
      legacy.clear()
      legacy.add('pushed again', '/r/private-project')
      expect([readFileSync(theirs, 'utf8'), mode(theirs)]).toEqual(['', 0o400])

      // once the folder takes a new file again, the log is one, and kept as usual
      chmodSync(old, 0o755)
      const again = new ActivityLog(theirs)
      again.add('pushed once more', '/r/private-project')
      expect([onDisk(theirs), mode(theirs)]).toEqual([['pushed once more'], 0o600])
    } finally {
      LIMITS.keep = keep
      for (const folder of [own, old]) chmodSync(folder, 0o755) // so they can be cleared away
    }
  })

  it.skipIf(process.platform === 'win32')('never reads or writes what something else put in its place', () => {
    const mode = (path: string) => statSync(path).mode & 0o777
    // Another file's name where the log should be (a link of either kind): that file is left as it
    // was, and the log starts over as a file of its own.
    const theirs = '{"ts": 1, "message": "not this log"}\n'
    for (const link of [symlinkSync, linkSync]) {
      const target = join(tempDir(), 'someone-elses.jsonl')
      writeFileSync(target, theirs)
      chmodSync(target, 0o644)
      const path = join(tempDir(), 'a.jsonl')
      link(target, path)
      const log = new ActivityLog(path)
      expect(log.entries).toEqual([])
      log.add('pushed', '/r/private-project')
      expect([mode(target), readFileSync(target, 'utf8'), statSync(target).nlink]).toEqual([0o644, theirs, 1])
      expect([lstatSync(path).isFile(), mode(path)]).toEqual([true, 0o600])
      expect(new ActivityLog(path).entries.map((e) => e.message)).toEqual(['pushed'])
      log.clear()
      expect(readFileSync(target, 'utf8')).toBe(theirs)
    }

    // A link to nowhere: no file appears where it points.
    const nowhere = join(tempDir(), 'not-there.jsonl')
    const dangling = join(tempDir(), 'a.jsonl')
    symlinkSync(nowhere, dangling)
    new ActivityLog(dangling).add('pushed', '/r/private-project')
    expect([existsSync(nowhere), lstatSync(dangling).isFile(), mode(dangling)]).toEqual([false, true, 0o600])

    // A pipe with somebody listening: nothing is said into it.
    const pipe = join(tempDir(), 'a.jsonl')
    execFileSync('mkfifo', [pipe])
    const listener = openSync(pipe, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      const log = new ActivityLog(pipe)
      log.add('pushed', '/r/private-project')
      let heard = 0
      try {
        heard = readSync(listener, Buffer.alloc(256))
      } catch {
        // nothing to read
      }
      expect(heard).toBe(0)
      expect(lstatSync(pipe).isFile()).toBe(true)
      expect(new ActivityLog(pipe).entries.map((e) => e.message)).toEqual(['pushed'])
    } finally {
      closeSync(listener)
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
