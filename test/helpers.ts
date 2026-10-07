import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import type { Change } from '../src/shared/types'
import { run } from '../src/core/git/run'
import { status } from '../src/core/git/status'
import { commit } from '../src/core/git/commit'

const made: string[] = []

/** A temporary directory removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'repodeck-test-'))
  made.push(dir)
  return dir
}

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

export async function initRepo(dir = tempDir(), ...extra: string[]): Promise<string> {
  await run(dir, ['init', '-q', '-b', 'main', ...extra])
  return dir
}

export function write(repo: string, name: string, text = 'x\n'): void {
  mkdirSync(dirname(join(repo, name)), { recursive: true })
  writeFileSync(join(repo, name), text)
}

export async function commitAll(repo: string, message: string): Promise<void> {
  const st = await status(repo)
  await commit(repo, st, message, st.changes)
}

export async function byPath(repo: string): Promise<Record<string, Change>> {
  return Object.fromEntries((await status(repo)).changes.map((c) => [c.path, c]))
}

export async function committedFiles(repo: string, rev = 'HEAD'): Promise<Set<string>> {
  const out = await run(repo, ['show', '--name-only', '--no-renames', '--format=', rev])
  return new Set(out.split('\n').filter(Boolean))
}

export async function subjects(repo: string, rev = 'HEAD'): Promise<string[]> {
  return (await run(repo, ['log', '--format=%s', rev])).split('\n').slice(0, -1)
}
