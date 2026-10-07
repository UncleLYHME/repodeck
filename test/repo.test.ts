import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../src/core/git/run'
import { status } from '../src/core/git/status'
import { commit } from '../src/core/git/commit'
import { RepoController, type RepoHost } from '../src/core/repo'
import { RepoWatcher } from '../src/core/watch'
import { initRepo, tempDir } from './helpers'

async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function commitFile(repo: string, name: string, text: string, message: string) {
  writeFileSync(join(repo, name), text)
  const st = await status(repo)
  await commit(repo, st, message, st.changes.filter((c) => c.path === name))
}

async function sync() {
  const root = tempDir()
  const origin = join(root, 'origin.git')
  const mine = join(root, 'mine')
  const theirs = join(root, 'theirs')
  await run(root, ['init', '-q', '--bare', '-b', 'main', origin])
  await run(root, ['clone', '-q', origin, mine])
  await commitFile(mine, 'shared.txt', 'line 1\n', 'base')
  await run(mine, ['push', '-q', '-u', 'origin', 'main'])
  await run(root, ['clone', '-q', origin, theirs])
  const theirPush = async (name: string, text: string) => {
    await commitFile(theirs, name, text, `their ${name}`)
    await run(theirs, ['push', '-q'])
  }
  return { mine, theirPush }
}

function host(autoPull: boolean) {
  const announced: string[] = []
  const h: RepoHost = {
    autoPullFor: () => autoPull,
    announce: (message) => void announced.push(message),
    emitState: () => {},
    emitHistory: () => {},
  }
  return { h, announced }
}

describe('repo controller', () => {
  it('pulls fetched commits on the current branch and says so', async () => {
    const { mine, theirPush } = await sync()
    const { h, announced } = host(true)
    const repo = new RepoController(mine, h)
    try {
      await until(() => repo.status !== null)
      await theirPush('theirs.txt', 'x\n')
      const behind = repo.status!.behind
      await run(mine, ['fetch', '-q'])
      repo.fetchFinished(null, behind, await status(mine))
      await until(async () => (await status(mine)).behind === 0 && announced.some((m) => m.includes('pulled 1 new commit')))
      expect(announced.some((m) => m.includes('to pull'))).toBe(false) // it pulled, so no "to pull" notice
    } finally {
      repo.close()
    }
  })

  it('waits with "pull pending" while local edits are in the way, and says why', async () => {
    const { mine, theirPush } = await sync()
    const { h } = host(true)
    const repo = new RepoController(mine, h)
    try {
      await until(() => repo.status !== null)
      await theirPush('shared.txt', 'their version\n')
      writeFileSync(join(mine, 'shared.txt'), 'my edit in progress\n')
      await run(mine, ['fetch', '-q'])
      repo.refresh()
      await until(() => repo.pullBlocked !== null)
      expect(repo.pendingState()?.label).toBe('pull pending')
      expect((await status(mine)).behind).toBe(1)
    } finally {
      repo.close()
    }
  })

  it('never pulls a diverged branch: "syncs on push"', async () => {
    const { mine, theirPush } = await sync()
    const { h } = host(true)
    const repo = new RepoController(mine, h)
    try {
      await theirPush('theirs.txt', 'x\n')
      await commitFile(mine, 'mine.txt', 'y\n', 'mine')
      await run(mine, ['fetch', '-q'])
      repo.refresh()
      await until(() => repo.status?.behind === 1 && repo.status.ahead === 1)
      expect(repo.pendingState()?.label).toBe('syncs on push')
    } finally {
      repo.close()
    }
  })

  it('tells about new commits when auto-pull is off', async () => {
    const { mine, theirPush } = await sync()
    const { h, announced } = host(false)
    const repo = new RepoController(mine, h)
    try {
      await until(() => repo.status !== null)
      await theirPush('theirs.txt', 'x\n')
      await run(mine, ['fetch', '-q'])
      repo.fetchFinished(null, 0, await status(mine))
      expect(announced).toEqual(['mine: 1 new commit to pull'])
      expect((await status(mine)).behind).toBe(1)
    } finally {
      repo.close()
    }
  })
})

describe('watcher', () => {
  it('notices edits, new folders and files created inside them', async () => {
    const repo = await initRepo()
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    let changes = 0
    const w = new RepoWatcher(repo, () => void changes++)
    try {
      await until(() => changes > 0 && w.count > 0) // the first scan reports once
      const before = changes
      writeFileSync(join(repo, 'a.txt'), 'edited\n')
      await until(() => changes > before)
      mkdirSync(join(repo, 'new', 'deep'), { recursive: true })
      await until(() => w.count >= 3) // rescanned: new/ and new/deep are watched now
      const again = changes
      writeFileSync(join(repo, 'new', 'deep', 'file.txt'), 'x\n')
      await until(() => changes > again)
    } finally {
      w.close()
    }
  })
})
