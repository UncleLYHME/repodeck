import { accessSync, chmodSync, constants, existsSync, linkSync, lstatSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Cache, cacheIn, FORMAT, PRUNE_DAYS } from '../src/core/cache'
import { run } from '../src/core/git/run'
import { fingerprint } from '../src/core/git/status'
import { repoCommits } from '../src/core/stats/dashboard'
import { project } from '../src/core/stats/project'
import { freshness, github } from '../src/core/stats/github'
import { addDays, localDate } from '../src/shared/time'
import { initRepo, tempDir, write } from './helpers'

describe('cache', () => {
  it('handles versioned and timed entries', () => {
    const c = new Cache(join(tempDir(), 'cache.json'))
    c.put('a', { x: 1 }, 'v1')
    expect(c.get('a', { version: 'v1' })).toEqual([{ x: 1 }, true])
    expect(c.get('a', { version: 'v2' })).toEqual([null, false])
    c.put('b', [1, 2])
    expect(c.get('b', { ttl: 60 })).toEqual([[1, 2], true])
    c.entries.b.t -= 120
    expect(c.get('b', { ttl: 60 })).toEqual([[1, 2], false]) // stale but still returned
    expect(c.get('missing')).toEqual([null, false])
  })

  it('persists and prunes', () => {
    const path = join(tempDir(), 'cache.json')
    const c = new Cache(path)
    c.put('keep', 'yes', 'v')
    c.put('old', 'no')
    c.entries.old.used = Date.now() / 1000 - (PRUNE_DAYS + 1) * 86400
    c.save()
    expect(existsSync(path.replace(/\.json$/, '.tmp'))).toBe(false)
    const again = new Cache(path)
    expect(again.get('keep', { version: 'v' })).toEqual(['yes', true])
    expect(again.get('old')).toEqual([null, false])
  })

  it.skipIf(process.platform === 'win32')('keeps the cache to the user, and never writes through a link', () => {
    const mode = (path: string) => statSync(path).mode & 0o777
    const dir = tempDir() // RepoDeck's cache folder
    const path = join(dir, 'cache-v2.json')
    const t = Date.now() / 1000
    writeFileSync(path, JSON.stringify({ format: FORMAT, entries: { old: { v: null, t, used: t, data: 'kept' } } }))
    chmodSync(path, 0o644) // as an earlier version left it: readable by every account
    const other = join(tempDir(), 'someone-elses.txt')
    writeFileSync(other, 'untouched')
    // where earlier versions wrote the cache before swapping it in: a copy a crash left behind, or a link
    symlinkSync(other, join(dir, 'cache-v2.tmp'))

    const c = cacheIn(dir)
    expect(mode(path)).toBe(0o600) // as soon as it is read, not only once it is saved again
    expect(readdirSync(dir)).toEqual(['cache-v2.json']) // the leftover is gone, and nothing new is left lying
    expect(c.get('old')).toEqual(['kept', true])
    c.put('pr', { title: 'private work' })
    c.save()
    expect(mode(path)).toBe(0o600)
    expect(readFileSync(other, 'utf8')).toBe('untouched')
    expect(readdirSync(dir)).toEqual(['cache-v2.json'])
    expect(new Cache(path).get('pr')).toEqual([{ title: 'private work' }, true])

    // a cache anywhere else leaves the files around it alone, whatever they are called
    const elsewhere = tempDir()
    writeFileSync(join(elsewhere, 'report.tmp'), 'untouched')
    writeFileSync(join(elsewhere, 'cache-v2.tmp'), 'untouched')
    const report = new Cache(join(elsewhere, 'report.json'))
    report.put('pr', 1)
    report.save()
    expect(readdirSync(elsewhere).sort()).toEqual(['cache-v2.tmp', 'report.json', 'report.tmp'])

    const damaged = join(tempDir(), 'cache.json')
    writeFileSync(damaged, '{"format": 2, "entries": {"pr": {"data": "private work"') // cut off, still readable
    chmodSync(damaged, 0o644)
    expect(new Cache(damaged).entries).toEqual({})
    expect(mode(damaged)).toBe(0o600)

    // another file's name where the cache should be: not read, and left as it was when the cache is saved
    for (const link of [symlinkSync, linkSync]) {
      const linked = join(tempDir(), 'cache.json')
      link(other, linked)
      const fresh = new Cache(linked)
      fresh.put('pr', 1)
      fresh.save()
      expect([readFileSync(other, 'utf8'), lstatSync(linked).isFile(), mode(linked)]).toEqual(['untouched', true, 0o600])
    }
  })

  it.skipIf(process.platform === 'win32')('closes to others what it cannot replace or remove', (ctx) => {
    // In a folder that takes no new file and lets go of none, the cache an earlier version left
    // (and the copy a crash left beside it) can't be swapped for private files: they are closed to
    // the other accounts where they stand.
    const mode = (path: string) => statSync(path).mode & 0o777
    const dir = tempDir()
    const t = Date.now() / 1000
    const text = JSON.stringify({ format: FORMAT, entries: { old: { v: null, t, used: t, data: 'kept' } } })
    for (const name of ['cache-v2.json', 'cache-v2.tmp']) {
      writeFileSync(join(dir, name), text)
      chmodSync(join(dir, name), 0o644)
    }
    chmodSync(dir, 0o555)
    try {
      let open = true
      try {
        accessSync(dir, constants.W_OK)
      } catch {
        open = false
      }
      if (open) ctx.skip() // an administrator writes anywhere: no folder is closed to this run
      const c = cacheIn(dir)
      expect(c.get('old')).toEqual(['kept', true])
      expect(readdirSync(dir).map((name) => [name, mode(join(dir, name))])).toEqual([['cache-v2.json', 0o400], ['cache-v2.tmp', 0o400]])
    } finally {
      chmodSync(dir, 0o755) // so the folder can be cleared away
    }
  })

  it('ignores other formats and corrupt files', () => {
    const path = join(tempDir(), 'cache.json')
    writeFileSync(path, JSON.stringify({ format: FORMAT + 1, entries: { a: {} } }))
    expect(new Cache(path).entries).toEqual({})
    writeFileSync(path, '{not json')
    expect(new Cache(path).entries).toEqual({})
  })
})

async function repoWithCommit() {
  const repo = await initRepo()
  write(repo, 'a.txt', 'one\n')
  await run(repo, ['add', '-A'])
  await run(repo, ['commit', '-qm', 'first'])
  return repo
}

describe('git caching', () => {
  it('fingerprint follows history, not edits', async () => {
    const repo = await repoWithCommit()
    let fp = await fingerprint(repo)
    write(repo, 'a.txt', 'edited, not committed\n')
    expect(await fingerprint(repo)).toBe(fp)
    await run(repo, ['branch', 'side'])
    expect(await fingerprint(repo)).not.toBe(fp)
    fp = await fingerprint(repo)
    await run(repo, ['stash', '-q'])
    expect(await fingerprint(repo)).not.toBe(fp)
    fp = await fingerprint(repo)
    await run(repo, ['update-ref', 'refs/t3/checkpoint', 'HEAD']) // tool-private refs don't count
    expect(await fingerprint(repo)).toBe(fp)
  })

  it('activity reuses its scan until a commit', async () => {
    const repo = await repoWithCommit()
    const start = addDays(localDate(new Date()), -13)
    const first = await repoCommits(repo, start)
    expect(first).toHaveLength(1)
    expect(await repoCommits(repo, start)).toBe(first) // same cached value: no new scan
    write(repo, 'b.txt', 'two\n')
    await run(repo, ['add', '-A'])
    await run(repo, ['commit', '-qm', 'second'])
    const third = await repoCommits(repo, start)
    expect(third).not.toBe(first)
    expect(third).toHaveLength(2)
  })

  it('caches project stats', async () => {
    const repo = await repoWithCommit()
    const first = await project(repo)
    expect(await project(repo)).toBe(first)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first) // JSON round trip is lossless
    expect(first.languages).toEqual([]) // .txt isn't a language
  })
})

describe('github caching', () => {
  it('reuses, refetches on force and falls back when offline', async () => {
    const repos = ['/nowhere/github-cache-test']
    let calls = 0
    const sources = {
      pullRequests: async () => {
        calls += 1
        return { review: [], mine: [{ repo: 'o/r', number: 1, title: `call ${calls}`, url: 'u', draft: false }] }
      },
      ciFailures: async () => [],
    }
    const a = await github(repos, false, sources)
    const b = await github(repos, false, sources)
    expect([calls, a, freshness(b)]).toEqual([1, b, 'Updated just now'])
    await github(repos, true, sources)
    expect(calls).toBe(2)

    const offline = { ...sources, pullRequests: async () => { throw new Error('could not connect') } }
    const c = await github(repos, true, offline)
    expect(c.prs.mine[0].title).toBe('call 2')
    expect(c.stale).toBe('could not connect')
    expect(freshness(c)).toContain('unreachable')
  })
})
