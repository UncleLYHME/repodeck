import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Cache, FORMAT, PRUNE_DAYS } from '../src/core/cache'
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
