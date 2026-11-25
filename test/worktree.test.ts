import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { worktreeParts, worktreePath } from '../src/core/git/worktree'
import { tempDir, write } from './helpers'

describe('paths git reports', () => {
  it('takes a plain path apart and refuses one that leads elsewhere', () => {
    expect(worktreeParts('a.txt')).toEqual(['a.txt'])
    expect(worktreeParts('dir/sub/a b.txt')).toEqual(['dir', 'sub', 'a b.txt'])
    expect(worktreeParts('nested-repo/')).toEqual(['nested-repo']) // how git marks a folder
    for (const bad of ['', '..', '../x', 'a/../../x', '/etc/passwd', 'a//b', './a', 'a/.', 'a/..']) expect(worktreeParts(bad)).toBeNull()
  })

  it('refuses a backslash where it separates folders (Windows), and only there', () => {
    expect(worktreeParts('odd\\name.txt', 'linux')).toEqual(['odd\\name.txt'])
    expect(worktreeParts('dir/file.txt', 'win32')).toEqual(['dir', 'file.txt'])
    for (const bad of ['..\\..\\secret.txt', 'dir\\file.txt', 'dir/..\\x']) expect(worktreeParts(bad, 'win32')).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('finds a file, but not through a linked or missing folder', async () => {
    const repo = tempDir()
    const outside = tempDir()
    write(repo, 'real/a.txt')
    write(outside, 'a.txt')
    symlinkSync(outside, join(repo, 'out'), 'dir')
    symlinkSync('real', join(repo, 'in'), 'dir')
    mkdirSync(join(repo, 'real/deep'))
    symlinkSync(join(outside, 'a.txt'), join(repo, 'real/deep/link.txt'))
    expect(await worktreePath(repo, 'real/a.txt')).toBe(join(repo, 'real/a.txt'))
    expect(await worktreePath(repo, 'real/deep/link.txt')).toBe(join(repo, 'real/deep/link.txt')) // the link itself
    expect(await worktreePath(repo, 'out')).toBe(join(repo, 'out'))
    expect(await worktreePath(repo, 'out/a.txt')).toBeNull()
    expect(await worktreePath(repo, 'in/a.txt')).toBeNull()
    expect(await worktreePath(repo, 'gone/a.txt')).toBeNull()
    expect(await worktreePath(repo, '../x')).toBeNull()
  })
})
