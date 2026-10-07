import { mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { letter, isStaged, hasCommits } from '../src/shared/changes'
import { GitError, run } from '../src/core/git/run'
import { commitFileDiff, commitFiles, findRepos, log, parseRefs, status } from '../src/core/git/status'
import { commit } from '../src/core/git/commit'
import { backgroundFetch } from '../src/core/git/sync'
import { byPath, commitAll, committedFiles, initRepo, tempDir, write } from './helpers'

describe('git', () => {
  it('commits only the selected untracked files as the initial commit', async () => {
    const repo = await initRepo()
    write(repo, 'a.txt')
    write(repo, 'dir/b [1].txt')
    write(repo, 'c.txt')
    const st = await status(repo)
    expect(hasCommits(st)).toBe(false)
    expect(new Set(st.changes.map(letter))).toEqual(new Set(['U']))
    await commit(repo, st, 'first', st.changes.filter((c) => c.path !== 'c.txt'))
    expect(await committedFiles(repo)).toEqual(new Set(['a.txt', 'dir/b [1].txt']))
    expect(Object.keys(await byPath(repo))).toEqual(['c.txt'])
  })

  it('commits only the selection and keeps other staged work', async () => {
    const repo = await initRepo()
    for (const n of ['keep.txt', 'edit.txt', 'gone.txt', 'old.txt']) write(repo, n, `${n} original content\n`)
    await commitAll(repo, 'base')
    write(repo, 'edit.txt', 'changed\n')
    write(repo, 'keep.txt', 'staged but unselected\n')
    await run(repo, ['add', 'keep.txt'])
    unlinkSync(join(repo, 'gone.txt'))
    await run(repo, ['mv', 'old.txt', 'new.txt'])
    const changes = await byPath(repo)
    expect(letter(changes['edit.txt'])).toBe('M')
    expect(letter(changes['gone.txt'])).toBe('D')
    expect([letter(changes['new.txt']), changes['new.txt'].orig]).toEqual(['R', 'old.txt'])
    expect(isStaged(changes['keep.txt'])).toBe(true)

    const st = await status(repo)
    await commit(repo, st, 'second', ['edit.txt', 'gone.txt', 'new.txt'].map((p) => changes[p]))
    expect(await committedFiles(repo)).toEqual(new Set(['edit.txt', 'gone.txt', 'new.txt', 'old.txt']))
    const left = await byPath(repo)
    expect(Object.keys(left)).toEqual(['keep.txt'])
    expect(isStaged(left['keep.txt'])).toBe(true)
  })

  it('reads the log graph, refs and branch status', async () => {
    const repo = await initRepo()
    write(repo, 'a')
    await commitAll(repo, 'one')
    await run(repo, ['checkout', '-q', '-b', 'feature/x'])
    write(repo, 'b')
    await commitAll(repo, 'two | with: odd chars')
    await run(repo, ['tag', 'v1'])
    await run(repo, ['checkout', '-q', 'main'])
    write(repo, 'c')
    await commitAll(repo, 'three')

    const st = await status(repo)
    expect(st.branch).toBe('main')
    const rows = await log(repo, st)
    expect(rows).toHaveLength(3)
    const bySubject = Object.fromEntries(rows.map((r) => [r.subject, r]))
    expect(bySubject['three'].refs).toEqual([['head', 'main']])
    expect([...bySubject['two | with: odd chars'].refs].sort()).toEqual([['branch', 'feature/x'], ['tag', 'v1']])
    expect(bySubject['three'].parents).toEqual([bySubject['one'].fullSha])
    expect(bySubject['one'].parents).toEqual([])
  })

  it('background fetch sees new upstream commits', async () => {
    const repo = await initRepo()
    expect(await backgroundFetch(repo)).toBe(false) // no remote: nothing to do
    write(repo, 'a')
    await commitAll(repo, 'one')
    const tmp = tempDir()
    const clone = join(tmp, 'clone')
    await run(tmp, ['clone', '-q', repo, clone])
    write(repo, 'b')
    await commitAll(repo, 'two')
    expect((await status(clone)).behind).toBe(0)
    expect(await backgroundFetch(clone)).toBe(true)
    expect((await status(clone)).behind).toBe(1)

    await run(clone, ['remote', 'set-url', 'origin', join(tmp, 'missing')])
    await expect(backgroundFetch(clone)).rejects.toBeInstanceOf(GitError)
  })

  it('lists commit files with letters, renames and merges', async () => {
    const repo = await initRepo()
    for (const n of ['keep.txt', 'old.txt', 'gone.txt']) write(repo, n, `${n} content\n`)
    await commitAll(repo, 'base')
    const root = (await log(repo, await status(repo)))[0].fullSha
    expect(new Set((await commitFiles(repo, root)).map((f) => `${f.path}:${f.letter}`)))
      .toEqual(new Set(['keep.txt:A', 'old.txt:A', 'gone.txt:A']))

    write(repo, 'keep.txt', 'changed\n')
    write(repo, 'dir/new file.txt', 'new\n')
    unlinkSync(join(repo, 'gone.txt'))
    await run(repo, ['mv', 'old.txt', 'renamed.txt'])
    await commitAll(repo, 'changes')
    const head = (await log(repo, await status(repo)))[0].fullSha
    const files = Object.fromEntries((await commitFiles(repo, head)).map((f) => [f.path, f]))
    expect(Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.letter])))
      .toEqual({ 'keep.txt': 'M', 'dir/new file.txt': 'A', 'gone.txt': 'D', 'renamed.txt': 'R' })
    expect(files['renamed.txt'].orig).toBe('old.txt')
    expect(await commitFileDiff(repo, head, files['keep.txt'])).toContain('+changed')
    expect(await commitFileDiff(repo, head, files['renamed.txt'])).toContain('rename from old.txt')

    await run(repo, ['checkout', '-q', '-b', 'side'])
    write(repo, 'side.txt', 'side\n')
    await commitAll(repo, 'side')
    await run(repo, ['checkout', '-q', 'main'])
    await run(repo, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side'])
    const merge = (await log(repo, await status(repo)))[0]
    expect(merge.parents).toHaveLength(2)
    expect((await commitFiles(repo, merge.fullSha)).map((f) => [f.path, f.letter])).toEqual([['side.txt', 'A']])
  })

  it('parses refs including remotes', () => {
    const refs = parseRefs('HEAD -> main, origin/main, origin/HEAD, tag: v2, fix/y', new Set(['origin']))
    expect(refs).toEqual([['head', 'main'], ['remote', 'origin/main'], ['tag', 'v2'], ['branch', 'fix/y']])
  })

  it('finds repos in a folder of projects', async () => {
    const parent = tempDir()
    mkdirSync(join(parent, 'one'))
    mkdirSync(join(parent, 'plain'))
    await run(join(parent, 'one'), ['init', '-q'])
    expect(await findRepos(parent)).toEqual([join(parent, 'one')])
    const repo = await initRepo()
    expect(await findRepos(repo)).toEqual([repo])
  })
})
