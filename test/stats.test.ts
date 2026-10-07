import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../src/core/git/run'
import { dashboardActivity, services } from '../src/core/stats/dashboard'
import { ciFailuresFromRuns, DAYS, GITHUB_URL } from '../src/core/stats/github'
import { parseSs } from '../src/core/platform/services'
import { ago, isoTs, localDate } from '../src/shared/time'
import { tempDir } from './helpers'

describe('dashboard activity', () => {
  it('counts days and lines and dedupes clones', async () => {
    const tmp = tempDir()
    const a = join(tmp, 'a')
    const b = join(tmp, 'b')
    await run(tmp, ['init', '-q', '-b', 'main', a])
    writeFileSync(join(a, 'f.txt'), '1\n2\n3\n')
    await run(a, ['add', '-A'])
    await run(a, ['commit', '-qm', 'three lines'])
    writeFileSync(join(a, 'f.txt'), '1\n')
    await run(a, ['commit', '-qam', 'drop two'])
    await run(tmp, ['clone', '-q', a, b]) // same commits again: counted once
    writeFileSync(join(b, 'g.txt'), 'x\n')
    await run(b, ['add', '-A'])
    await run(b, ['commit', '-qm', 'only in b'])

    const act = await dashboardActivity([a, b])
    expect(act.total).toBe(3)
    expect([act.added, act.deleted]).toEqual([4, 2])
    expect(act.days).toHaveLength(DAYS)
    expect(act.days[DAYS - 1]).toEqual([localDate(new Date()), 3])
    expect(act.perRepo).toEqual({ [a]: 2, [b]: 1 })
    expect(act.recent[0][2]).toBe('only in b')
  })
})

describe('parsing', () => {
  it('parses ss output', () => {
    const text =
      'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=4242,fd=21))\n' +
      'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=4242,fd=22))\n' +
      'LISTEN 0 4096 127.0.0.1:8000 0.0.0.0:* users:(("docker-proxy",pid=5660,fd=7))\n' +
      'garbage line\n'
    expect(parseSs(text)).toEqual([[3000, 'node', 4242], [8000, 'docker-proxy', 5660]])
  })

  it('maps a listening process to the repo it runs in', async () => {
    const repo = tempDir()
    const server = spawn(process.execPath, ['-e', "require('net').createServer().listen(0, '127.0.0.1', () => console.log('up'))"], { cwd: repo })
    try {
      await new Promise<void>((resolve) => server.stdout.once('data', () => resolve()))
      const { found } = await services([repo])
      expect(found.some(([, r, proc]) => r === repo && proc === 'node')).toBe(true)
    } finally {
      server.kill()
    }
  })

  it('keeps only the latest failing CI run per workflow and branch', () => {
    const runs = [
      { workflowName: 'ci', headBranch: 'main', conclusion: 'failure', createdAt: '2026-10-01T00:00:00Z', url: '1' },
      { workflowName: 'ci', headBranch: 'main', conclusion: 'success', createdAt: '2026-10-02T00:00:00Z', url: '2' },
      { workflowName: 'ci', headBranch: 'fix', conclusion: 'failure', createdAt: '2026-10-03T00:00:00Z', url: '3' },
      { workflowName: 'e2e', headBranch: 'main', conclusion: 'timed_out', createdAt: '2026-10-04T00:00:00Z', url: '4' },
      { workflowName: 'old', headBranch: 'main', conclusion: 'failure', createdAt: '2026-01-01T00:00:00Z', url: '5' },
    ]
    const failed = ciFailuresFromRuns(runs, '2026-09-20T00:00:00Z')
    expect(failed.map((r) => [r.workflowName, r.headBranch]).sort()).toEqual([['ci', 'fix'], ['e2e', 'main']])
  })

  it('reads GitHub slugs and formats times', () => {
    expect(GITHUB_URL.exec('git@github.com:me/app.git')?.groups?.slug).toBe('me/app')
    expect(GITHUB_URL.exec('https://github.com/me/app')?.groups?.slug).toBe('me/app')
    expect(isoTs('1970-01-01T00:01:00Z')).toBe(60)
    const now = Date.now() / 1000
    expect([5, 120, 7200, 3 * 86400].map((s) => ago(now - s, now))).toEqual(['now', '2m', '2h', '3d'])
  })
})
