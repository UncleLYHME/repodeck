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
    for (const url of [
      'https://github.com/me/app.git', 'https://github.com/me/app/', 'https://me:token@github.com/me/app.git',
      'ssh://git@github.com/me/app.git', 'git://github.com/me/app', 'https://www.github.com/me/app', 'git@GitHub.com:me/app.git',
      'ssh://git@github.com:22/me/app.git', 'https://github.com:443/me/app', 'github.com:me/app.git', 'git@github.com:/me/app.git',
      'https://x-access-token:ghp_Abc123@github.com/me/app.git', 'https://me:@github.com/me/app',
      'https://me%40work.example:t0k%2Fen@github.com/me/app', // curl splits the address first and unescapes the login after
      'ssh://git@ssh.github.com:443/me/app.git', 'ssh://git@ssh.github.com/me/app.git', 'git@ssh.github.com:me/app.git',
    ]) expect(GITHUB_URL.exec(url)?.groups?.slug, url).toBe('me/app')
    expect(GITHUB_URL.exec('https://github.com/Me/my.app-2.git')?.groups?.slug).toBe('Me/my.app-2')
  })

  it('takes only a remote on github.com itself for a GitHub repository', () => {
    // each of these used to read as "trusted/project": another server, or no server at all
    for (const url of [
      'https://evil.example/github.com/trusted/project.git',
      'https://github.com.evil.example/trusted/project',
      'https://github.com@evil.example/trusted/project',
      'https://notgithub.com/trusted/project',
      'git@evil.example:github.com/trusted/project.git',
      'evil.example:mirror/github.com/trusted/project',
      'evil.example:cache@github.com/trusted/project.git', // git's host here is evil.example
      'evil.example:cache@github.com:trusted/project.git',
      'github.com/trusted/project.git', // a folder next to the repository
      './github.com:trusted/project',
      'https://github.com:evil.example/trusted/project',
      'https://evil.example?x@github.com/trusted/project', // to git, the host ends at "?", "#" or a backslash
      'https://evil.example#x@github.com/trusted/project',
      'https://evil.example\\@github.com/trusted/project',
      'https://evil.example\\x@github.com/trusted/project',
      'https://git@evil.example@github.com/trusted/project',
      'ssh://evil.example?x@github.com:22/trusted/project',
      'evil.example?x@github.com:trusted/project',
      'ssh://evil.example%2Fx@github.com/trusted/project', // git's own transports read "%2F" as "/" before they look for the host
      'ssh://evil.example%2f@github.com:22/trusted/project',
      'git://evil.example%2Fx@github.com/trusted/project',
      'https://evil.example%@github.com/trusted/project', // a "%" that escapes nothing
      'https://evil.example%2@github.com/trusted/project',
      'ssh://git:pw@github.com/trusted/project',
      'https://github.com/trusted/pro%6Aect',
      'https://github.com/trusted/project?x=1',
      'https://github.com/trusted/project#main',
      'ssh://git@ssh.github.com.evil.example/trusted/project',
      'ssh://git@sshxgithub.com/trusted/project',
      'git@evil.github.com:trusted/project',
      'https://gist.github.com/trusted/project',
      'ssh://git@evil.example/srv/github.com/trusted/project.git',
      '/home/me/mirrors/github.com/trusted/project',
      'file:///srv/git/github.com/trusted/project.git',
      'https://github.com/trusted/project/extra',
      'https://github.com/trusted',
    ]) expect(GITHUB_URL.exec(url), url).toBeNull()
  })

  it('formats times', () => {
    expect(isoTs('1970-01-01T00:01:00Z')).toBe(60)
    const now = Date.now() / 1000
    expect([5, 120, 7200, 3 * 86400].map((s) => ago(now - s, now))).toEqual(['now', '2m', '2h', '3d'])
  })
})
