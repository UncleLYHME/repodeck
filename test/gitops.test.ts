import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPartial, isStaged, hunkPatch } from '../src/shared/changes'
import { GitError, run } from '../src/core/git/run'
import { status } from '../src/core/git/status'
import { commit } from '../src/core/git/commit'
import * as ops from '../src/core/git/ops'
import { byPath, commitAll, tempDir, write } from './helpers'

async function setup() {
  const tmp = tempDir()
  const repo = join(tmp, 'r')
  const binned = join(tmp, 'trash')
  mkdirSync(binned)
  await run(tmp, ['init', '-q', '-b', 'main', repo])
  write(repo, 'a.txt', Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
  write(repo, 'b.txt', 'b\n')
  await commitAll(repo, 'base')
  const trash = async (path: string) => renameSync(path, join(binned, basename(path)))
  return { tmp, repo, binned, trash }
}

describe('gitops', () => {
  it('discard restores tracked files and bins new ones', async () => {
    const { repo, binned, trash } = await setup()
    write(repo, 'a.txt', 'changed\n')
    unlinkSync(join(repo, 'b.txt'))
    write(repo, 'new.txt', 'new\n')
    write(repo, 'staged-new.txt', 'staged\n')
    await run(repo, ['add', 'staged-new.txt'])
    const st = await status(repo)
    await ops.discard(repo, st, st.changes, trash)
    expect(await byPath(repo)).toEqual({})
    expect(readFileSync(join(repo, 'a.txt'), 'utf8').startsWith('line 1')).toBe(true)
    expect(existsSync(join(repo, 'b.txt'))).toBe(true)
    expect(readdirSync(binned).sort()).toEqual(['new.txt', 'staged-new.txt'])
  })

  it('discards a rename', async () => {
    const { repo, trash } = await setup()
    await run(repo, ['mv', 'b.txt', 'moved.txt'])
    const st = await status(repo)
    await ops.discard(repo, st, st.changes, trash)
    expect(await byPath(repo)).toEqual({})
    expect(existsSync(join(repo, 'b.txt'))).toBe(true)
  })

  it('stages one hunk and commits only that', async () => {
    const { repo } = await setup()
    const lines = readFileSync(join(repo, 'a.txt'), 'utf8').split('\n').slice(0, -1)
    lines[1] = 'TOP EDIT'
    lines[27] = 'BOTTOM EDIT'
    write(repo, 'a.txt', lines.join('\n') + '\n')
    const unstaged = await ops.hunks(repo, 'a.txt', false)
    expect(unstaged).toHaveLength(2)
    await ops.applyHunk(repo, hunkPatch(unstaged[0]), 'stage')
    const change = (await byPath(repo))['a.txt']
    expect(isPartial(change)).toBe(true)

    await commit(repo, await status(repo), 'top only', [change])
    const committed = await run(repo, ['show', 'HEAD:a.txt'])
    expect(committed).toContain('TOP EDIT')
    expect(committed).not.toContain('BOTTOM EDIT')
    const left = (await byPath(repo))['a.txt']
    expect([left.x, left.y]).toEqual(['.', 'M']) // the bottom edit is still waiting
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('BOTTOM EDIT')
  })

  it('unstages and discards a hunk', async () => {
    const { repo } = await setup()
    write(repo, 'a.txt', readFileSync(join(repo, 'a.txt'), 'utf8').replace('line 2\n', 'two\n'))
    await ops.applyHunk(repo, hunkPatch((await ops.hunks(repo, 'a.txt', false))[0]), 'stage')
    await ops.applyHunk(repo, hunkPatch((await ops.hunks(repo, 'a.txt', true))[0]), 'unstage')
    expect(isStaged((await byPath(repo))['a.txt'])).toBe(false)
    await ops.applyHunk(repo, hunkPatch((await ops.hunks(repo, 'a.txt', false))[0]), 'discard')
    expect(await byPath(repo)).toEqual({})
  })

  it('switches, creates and tracks remote branches', async () => {
    const { tmp, repo } = await setup()
    await ops.createBranch(repo, 'feature/x')
    expect((await status(repo)).branch).toBe('feature/x')
    await expect(ops.createBranch(repo, 'bad..name')).rejects.toBeInstanceOf(GitError)
    await ops.switchBranch(repo, 'main')
    const clone = join(tmp, 'clone')
    await run(tmp, ['clone', '-q', repo, clone])
    const b = await ops.branches(clone)
    expect([b.current, b.local.map(([n]) => n)]).toEqual(['main', ['main']])
    expect(b.remote).toEqual(['origin/feature/x'])
    await ops.switchRemote(clone, 'origin/feature/x')
    const st = await status(clone)
    expect([st.branch, st.upstream]).toEqual(['feature/x', 'origin/feature/x'])
  })

  it('round-trips a stash and aborts a merge', async () => {
    const { repo } = await setup()
    write(repo, 'a.txt', 'wip\n')
    write(repo, 'untracked.txt', 'u\n')
    await ops.stash(repo)
    expect(await byPath(repo)).toEqual({})
    expect(await ops.stashes(repo)).toHaveLength(1)
    await ops.stashPop(repo)
    expect(new Set(Object.keys(await byPath(repo)))).toEqual(new Set(['a.txt', 'untracked.txt']))

    await commitAll(repo, 'wip')
    await ops.createBranch(repo, 'side')
    write(repo, 'a.txt', 'side\n')
    await commitAll(repo, 'side')
    await ops.switchBranch(repo, 'main')
    write(repo, 'a.txt', 'main\n')
    await commitAll(repo, 'main')
    await run(repo, ['merge', 'side'], { check: false })
    expect((await status(repo)).operation).toBe('merge')
    await ops.abort(repo, 'merge')
    expect((await status(repo)).operation).toBeNull()
  })

  it('ignores new and tracked files', async () => {
    const { repo } = await setup()
    write(repo, 'build/out.log', 'x\n')
    write(repo, 'notes [draft].md', 'y\n')
    const choices = Object.fromEntries(ops.ignoreChoices((await byPath(repo))['build/out.log']))
    expect(choices).toEqual({ 'This File': '/build/out.log', 'All .log Files': '*.log', 'Folder build/': '/build/' })
    await ops.ignore(repo, choices['Folder build/'])
    await ops.ignore(repo, choices['Folder build/']) // not added twice
    const [pattern] = ops.ignoreChoices((await byPath(repo))['notes [draft].md']).map(([, p]) => p).filter((p) => p.startsWith('/'))
    expect(pattern).toBe('/notes \\[draft].md')
    await ops.ignore(repo, pattern)
    expect(Object.keys(await byPath(repo))).toEqual(['.gitignore']) // both are now ignored
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('/build/\n/notes \\[draft].md\n')

    write(repo, 'b.txt', 'changed tracked file\n')
    await ops.ignore(repo, '/b.txt', ['b.txt'])
    const change = (await byPath(repo))['b.txt']
    expect([change.x, change.kind]).toEqual(['D', 'tracked']) // removed from the index...
    expect(existsSync(join(repo, 'b.txt'))).toBe(true) // ...but kept on disk
  })

  it('sets and reads the identity', async () => {
    const { repo } = await setup()
    await ops.setIdentity(repo, 'Repo Person', 'repo@example.com')
    expect(await ops.identity(repo)).toEqual({ name: 'Repo Person', email: 'repo@example.com' })
    await expect(ops.setIdentity(repo, 'x', 'not-an-email')).rejects.toBeInstanceOf(GitError)
  })

  it('escapes gitignore patterns and reads profiles from include files', async () => {
    expect(ops.gitignoreEscape('#notes ')).toBe('\\#notes\\ ')
    expect(ops.suffix('.gitignore')).toBe('')
    const home = tempDir()
    write(home, '.gitconfig', '[user]\n  name = Me\n  email = me@x\n')
    write(home, '.gitconfig-work', '[user]\n  name = Me At Work\n  email = me@work\n')
    write(home, '.gitconfig-dupe', '[user]\n  name = Me\n  email = me@x\n')
    expect(await ops.profiles(home)).toEqual([
      { label: 'Global', name: 'Me', email: 'me@x' },
      { label: 'Work', name: 'Me At Work', email: 'me@work' },
    ])
  })
})
