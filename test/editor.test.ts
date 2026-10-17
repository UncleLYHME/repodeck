import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { editorCommand, isInside, windowsCodeExe } from '../src/main/editor'
import { realpathSync } from 'node:fs'
import { tempDir, write } from './helpers'

const posix = { platform: 'linux' as const, env: {}, realpath: realpathSync }

describe('editorCommand', () => {
  it('passes folders and files as plain arguments, no shell', () => {
    const dir = tempDir()
    write(dir, 'src/a.ts')
    expect(editorCommand(dir, undefined, posix)).toEqual({ command: 'code', args: [dir] })
    expect(editorCommand(dir, 'src/a.ts', posix)).toEqual({ command: 'code', args: ['-g', join(dir, 'src/a.ts')] })
    const odd = 'we"ird & name.ts'
    write(dir, odd)
    expect(editorCommand(dir, odd, posix).args).toEqual(['-g', join(dir, odd)])
  })

  it('rejects files outside the repo, by path or through a symlink', () => {
    const dir = tempDir()
    const outside = tempDir()
    write(outside, 'secret.txt')
    expect(() => editorCommand(dir, '../x', posix)).toThrow(/Not inside/)
    expect(() => editorCommand(dir, join(outside, 'secret.txt'), posix)).toThrow(/Not inside/)
    mkdirSync(join(dir, 'sub'))
    symlinkSync(outside, join(dir, 'sub', 'link'))
    expect(() => editorCommand(dir, 'sub/link/secret.txt', posix)).toThrow(/Not inside/)
  })

  it('on Windows launches Code.exe directly, with the quote left in the argument', () => {
    const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
    const win = {
      platform: 'win32' as const,
      env: { PATH: 'C:\\Windows;C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin' },
      realpath: (p: string) => p,
      exists: (p: string) => p === exe,
    }
    const cmd = editorCommand('C:\\repo', 'a" & calc & ".txt', win)
    expect(cmd.command).toBe(exe)
    expect(cmd.args).toEqual(['-g', 'C:\\repo\\a" & calc & ".txt'])
    expect(() => editorCommand('C:\\repo', '..\\other\\x.txt', win)).toThrow(/Not inside/)
    expect(() => editorCommand('C:\\repo', undefined, { ...win, exists: () => false })).toThrow(/not found/)
  })

  it('finds Code.exe in the usual install folders', () => {
    const exe = 'C:\\Program Files\\Microsoft VS Code\\Code.exe'
    expect(windowsCodeExe({ ProgramFiles: 'C:\\Program Files' }, (p) => p === exe)).toBe(exe)
    expect(windowsCodeExe({}, () => true)).toBeNull()
  })

  it('isInside compares resolved paths', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('C:\\r', 'C:\\r\\x', 'win32')).toBe(true)
    expect(isInside('C:\\r', 'D:\\r\\x', 'win32')).toBe(false)
  })
})
