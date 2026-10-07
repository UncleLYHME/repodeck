import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../src/core/git/run'
import { BARS, OTHER, languages, mergeAuthors, project } from '../src/core/stats/project'
import { localDate } from '../src/shared/time'
import { tempDir } from './helpers'

async function commitAt(repo: string, message: string, when: number) {
  const stamp = `@${Math.floor(when)} +0000`
  await run(repo, ['add', '-A'])
  await run(repo, ['commit', '-qm', message], { env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } })
}

describe('project stats', () => {
  it('computes activity, streak, hot files, languages and branches', async () => {
    const repo = tempDir()
    await run(repo, ['init', '-q', '-b', 'main'])
    const now = Date.now() / 1000
    writeFileSync(join(repo, 'app.py'), 'print(1)\n'.repeat(50))
    writeFileSync(join(repo, 'style.css'), 'a{}\n')
    await commitAt(repo, 'first', now - 40 * 86400) // previous 30-day window
    for (const daysAgo of [2, 1, 0]) {
      // a three-day streak ending today
      writeFileSync(join(repo, 'app.py'), `print(${daysAgo})\n`.repeat(50))
      await commitAt(repo, `edit ${daysAgo}`, now - daysAgo * 86400)
    }
    await run(repo, ['branch', 'feature'])

    const s = await project(repo)
    expect([s.commits30, s.commitsPrev30, s.streak, s.totalCommits]).toEqual([3, 1, 3, 4])
    expect(s.days).toHaveLength(BARS)
    expect(s.days[BARS - 1]).toEqual([localDate(new Date()), 1])
    expect(s.hotFiles[0].slice(0, 2)).toEqual(['app.py', 4])
    expect(s.languages.map(([lang]) => lang)).toEqual(['Python', 'CSS'])
    expect(s.branches.map((b) => b[0]).sort()).toEqual(['feature', 'main'])
    expect(s.branches.find((b) => b[0] === 'main')![3]).toBe(true)
    expect(s.punchcard.reduce((a, [, , n]) => a + n, 0)).toBe(4)
    expect(s.recent[0][1]).toBe('edit 0')
    expect(s.authors).toEqual([['T', 4]])
    expect(Math.abs(s.firstCommit - Math.floor(now - 40 * 86400))).toBeLessThanOrEqual(1)
  })

  it("shows another branch's history and files without checking it out", async () => {
    const repo = tempDir()
    await run(repo, ['init', '-q', '-b', 'main'])
    const now = Date.now() / 1000
    writeFileSync(join(repo, 'app.py'), 'print(1)\n')
    await commitAt(repo, 'base', now - 2 * 86400)
    await run(repo, ['switch', '-qc', 'feature'])
    writeFileSync(join(repo, 'page.html'), '<p>hi</p>\n'.repeat(20))
    await commitAt(repo, 'feature work', now - 86400)
    writeFileSync(join(repo, 'page.html'), '<p>hello</p>\n'.repeat(20))
    await commitAt(repo, 'more feature work', now)
    await run(repo, ['switch', '-q', 'main'])
    await run(repo, ['update-ref', 'refs/remotes/origin/feature', 'feature'])

    const feature = await project(repo, undefined, 'feature')
    expect(feature.totalCommits).toBe(3)
    expect(feature.recent.map(([, subject]) => subject)).toEqual(['more feature work', 'feature work', 'base'])
    expect(feature.languages.map(([lang]) => lang)).toEqual(['HTML', 'Python'])
    expect((await project(repo, undefined, 'origin/feature')).totalCommits).toBe(3)

    const main = await project(repo, undefined, 'main') // the checked-out branch: the usual page
    expect([main.totalCommits, main.languages.map(([lang]) => lang)]).toEqual([1, ['Python']])
    expect((await run(repo, ['branch', '--show-current'])).trim()).toBe('main')
    await expect(project(repo, undefined, '--output=/tmp/x')).rejects.toThrow('No branch named')
  })

  it('handles an empty repo', async () => {
    const repo = tempDir()
    await run(repo, ['init', '-q'])
    const s = await project(repo)
    expect([s.totalCommits, s.days.length, s.languages]).toEqual([0, BARS, []])
  })

  it('folds small languages into Other', () => {
    const names = ['a.py', 'b.js', 'c.ts', 'd.css', 'e.html', 'f.md', 'g.go', 'h.rs', 'Dockerfile', 'x.png']
    const langs = languages(Object.fromEntries(names.map((n, i) => [n, 100 - i])))
    expect(langs).toHaveLength(8)
    expect(langs[7][0]).toBe(OTHER)
    expect(langs.map(([l]) => l)).not.toContain('x.png')
  })
})

describe('authors', () => {
  it('merges spellings, addresses and GitHub logins', () => {
    const shortlog =
      '   636\tOctoDev <OctoDev@users.noreply.github.com>\n' +
      '    74\tOcto Dev <octo@example.com>\n' +
      '    27\tOcto Dev <31078289+OctoDev@users.noreply.github.com>\n' +
      '    18\tSam Rivera <sam@example.org>\n' +
      '     7\tSam <31078289+OctoDev@users.noreply.github.com>\n' +
      '     3\tAlex (Laptop) <alex@example.net>\n' +
      '     1\tAlex <alex@example.dev>\n'
    expect(mergeAuthors(shortlog)).toEqual([['OctoDev', 744], ['Sam Rivera', 18], ['Alex (Laptop)', 4]])
  })
})
