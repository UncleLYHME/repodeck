// The scripts the release workflow runs, executed the way it runs them (node, TypeScript imported directly),
// in temporary git repositories. No network.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changelogSection, nextVersion } from '../src/shared/release'
import { commitAll, initRepo, write } from './helpers'

const root = resolve(__dirname, '..')
const script = (name: string) => join(root, 'scripts', name)
const pkgVersion: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')

function node(args: string[], cwd = root) {
  const r = spawnSync(process.execPath, ['--no-warnings', ...args], { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout.trim(), err: r.stderr }
}

/** A repo with the given commit subjects, oldest first; returns it, tagging `tagAfter` (1-based) as `tag`. */
async function repoWith(subjects: string[], tag?: { name: string; after: number }): Promise<string> {
  const repo = await initRepo()
  for (const [i, s] of subjects.entries()) {
    write(repo, `f${i}.txt`, `${i}\n`)
    await commitAll(repo, s)
    if (tag && tag.after === i + 1) execFileSync('git', ['-C', repo, 'tag', tag.name])
  }
  return repo
}

describe('scripts/next-version.mjs', () => {
  it.each([
    [`v${pkgVersion}`, nextVersion(pkgVersion, `v${pkgVersion}`)],
    ['v99.0.0', '99.0.1'],
    ['v0.0.1', pkgVersion],
    ['', pkgVersion],
  ])('latest tag %j -> release %s', (latest, expected) => {
    const r = node([script('next-version.mjs'), latest])
    expect(r.err).toBe('')
    expect(r.out).toBe(expected)
  })

  it('treats a missing argument as no release yet', () => {
    expect(node([script('next-version.mjs')]).out).toBe(pkgVersion)
  })

  it('bumps the patch of the same version package.json already has', () => {
    const [maj, min, patch] = pkgVersion.split('.').map(Number)
    expect(node([script('next-version.mjs'), `v${pkgVersion}`]).out).toBe(`${maj}.${min}.${patch + 1}`)
  })
})

describe('scripts/release-notes.mjs', () => {
  it('prints the CHANGELOG section when the version has one (leading v accepted)', () => {
    const newest = /^## v?(\d+\.\d+\.\d+)/m.exec(changelog)![1]
    const expected = changelogSection(changelog, newest)!
    expect(expected.length).toBeGreaterThan(0)
    expect(node([script('release-notes.mjs'), newest]).out).toBe(expected)
    expect(node([script('release-notes.mjs'), `v${newest}`]).out).toBe(expected)
  })

  it('builds notes from commits since the previous tag when there is no CHANGELOG section', async () => {
    const repo = await repoWith(['feat: first thing', 'feat: old news', 'fix(core): keep the branch', 'docs: not for users', 'ci: no', 'feat: search in history'],
      { name: 'v0.9.0', after: 2 })
    const r = node([script('release-notes.mjs'), '0.9.1', 'v0.9.0'], repo)
    expect(r.err).toBe('')
    expect(r.out).toBe('- Search in history\n- Keep the branch')
  })

  it('falls back to the last 30 commits with no previous tag, newest first', async () => {
    const repo = await repoWith(Array.from({ length: 32 }, (_, i) => `feat: change ${i}`))
    const lines = node([script('release-notes.mjs'), '0.9.2'], repo).out.split('\n')
    expect(lines).toHaveLength(30)
    expect(lines[0]).toBe('- Change 31')
    expect(lines[29]).toBe('- Change 2')
  })

  it('says "Small fixes and improvements." when nothing since the tag is user-facing', async () => {
    const repo = await repoWith(['feat: shipped', 'chore: bump deps', 'docs: typo'], { name: 'v0.9.0', after: 1 })
    expect(node([script('release-notes.mjs'), '0.9.1', 'v0.9.0'], repo).out).toBe('- Small fixes and improvements.')
  })

  it('leaves merge commits out of the notes', async () => {
    const repo = await repoWith(['feat: base'])
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } })
    git('tag', 'v0.9.0')
    git('checkout', '-q', '-b', 'side')
    write(repo, 'side.txt')
    await commitAll(repo, 'fix: from the side')
    git('checkout', '-q', 'main')
    write(repo, 'main.txt')
    await commitAll(repo, 'feat: on main')
    git('merge', '--no-ff', '-q', '-m', 'Merge branch side', 'side')
    const notes = node([script('release-notes.mjs'), '0.9.1', 'v0.9.0'], repo).out.split('\n').sort()
    expect(notes).toEqual(['- From the side', '- On main'])
  })

  it('fails loudly when the previous tag does not exist', async () => {
    const repo = await repoWith(['feat: x'])
    const r = node([script('release-notes.mjs'), '0.9.1', 'v7.7.7'], repo)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain('v7.7.7')
  })
})
