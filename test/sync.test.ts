// A bare 'origin' with two clones: `mine` (the deck's repo) and `theirs` (someone else pushing).

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canFastForward } from '../src/shared/changes'
import { GitError, run } from '../src/core/git/run'
import { status } from '../src/core/git/status'
import { commit } from '../src/core/git/commit'
import { fastForward, push } from '../src/core/git/sync'
import { subjects, tempDir } from './helpers'

async function commitFile(repo: string, name: string, text: string, message: string) {
  writeFileSync(join(repo, name), text)
  const st = await status(repo)
  await commit(repo, st, message, st.changes.filter((c) => c.path === name))
}

async function setup() {
  const root = tempDir()
  const origin = join(root, 'origin.git')
  const mine = join(root, 'mine')
  const theirs = join(root, 'theirs')
  await run(root, ['init', '-q', '--bare', '-b', 'main', origin])
  await run(root, ['clone', '-q', origin, mine])
  await commitFile(mine, 'shared.txt', 'line 1\n', 'base')
  await run(mine, ['push', '-q', '-u', 'origin', 'main'])
  await run(root, ['clone', '-q', origin, theirs])
  const theirPush = async (name: string, text: string, message: string) => {
    await commitFile(theirs, name, text, message)
    await run(theirs, ['push', '-q'])
    await run(mine, ['fetch', '-q'])
  }
  return { origin, mine, theirs, theirPush }
}

describe('sync', () => {
  it('fast-forward keeps unrelated local edits', async () => {
    const { mine, theirPush } = await setup()
    await theirPush('theirs.txt', 'x\n', 'their change')
    writeFileSync(join(mine, 'shared.txt'), 'my edit in progress\n')
    expect(canFastForward(await status(mine))).toBe(true)
    await fastForward(mine)
    expect([(await status(mine)).behind, (await subjects(mine))[0]]).toEqual([0, 'their change'])
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('my edit in progress\n')
  })

  it('fast-forward refuses when local edits would be overwritten', async () => {
    const { mine, theirPush } = await setup()
    await theirPush('shared.txt', 'their version\n', 'their change')
    writeFileSync(join(mine, 'shared.txt'), 'my edit in progress\n')
    await expect(fastForward(mine)).rejects.toBeInstanceOf(GitError)
    expect((await status(mine)).behind).toBe(1)
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('my edit in progress\n')
  })

  it('push when diverged rebases, then pushes', async () => {
    const { origin, mine, theirPush } = await setup()
    await theirPush('theirs.txt', 'x\n', 'their change')
    await commitFile(mine, 'mine.txt', 'y\n', 'my change')
    writeFileSync(join(mine, 'wip.txt'), 'uncommitted\n') // survives via --autostash
    await push(mine, (await status(mine)).upstream)
    expect(await subjects(origin, 'main')).toEqual(['my change', 'their change', 'base'])
    const st = await status(mine)
    expect([st.ahead, st.behind, st.operation]).toEqual([0, 0, null])
    expect(readFileSync(join(mine, 'wip.txt'), 'utf8')).toBe('uncommitted\n')
  })

  it('a conflicting push aborts cleanly', async () => {
    const { origin, mine, theirPush } = await setup()
    await theirPush('shared.txt', 'their line\n', 'their change')
    await commitFile(mine, 'shared.txt', 'my line\n', 'my change')
    await expect(push(mine, (await status(mine)).upstream)).rejects.toBeInstanceOf(GitError)
    const st = await status(mine)
    expect([st.ahead, st.behind, st.operation]).toEqual([1, 1, null])
    expect((await subjects(mine))[0]).toBe('my change')
    expect((await subjects(origin, 'main'))[0]).toBe('their change')
  })

  it('only the checked-out branch is pulled', async () => {
    const { mine, theirs, theirPush } = await setup()
    await run(theirs, ['push', '-q', 'origin', 'main:feature'])
    await run(mine, ['fetch', '-q'])
    await run(mine, ['branch', '-q', '--track', 'feature', 'origin/feature'])
    await run(theirs, ['fetch', '-q'])
    await run(theirs, ['checkout', '-q', '-b', 'feature', 'origin/feature'])
    await theirPush('f.txt', 'f\n', 'feature update')
    await run(theirs, ['checkout', '-q', 'main'])
    await theirPush('m.txt', 'm\n', 'main update')

    const featureBefore = await run(mine, ['rev-parse', 'feature'])
    expect(canFastForward(await status(mine))).toBe(true)
    await fastForward(mine)
    expect((await subjects(mine))[0]).toBe('main update')
    expect(await run(mine, ['rev-parse', 'feature'])).toBe(featureBefore) // untouched

    await run(mine, ['checkout', '-q', 'feature']) // now it's the current branch, so it gets pulled
    expect(canFastForward(await status(mine))).toBe(true)
    await fastForward(mine)
    expect((await subjects(mine))[0]).toBe('feature update')
  })

  it('detects an operation in progress', async () => {
    const { mine } = await setup()
    await run(mine, ['checkout', '-q', '-b', 'side'])
    await commitFile(mine, 'shared.txt', 'side\n', 'side')
    await run(mine, ['checkout', '-q', 'main'])
    await commitFile(mine, 'shared.txt', 'main\n', 'main')
    await run(mine, ['merge', 'side'], { check: false })
    const st = await status(mine)
    expect(st.operation).toBe('merge')
    expect(canFastForward(st)).toBe(false)
  })
})
