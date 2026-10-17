// How to start VS Code for a folder or file: a plain argument list, never a shell command line.

import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, win32 } from 'node:path'

export interface EditorEnv {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  realpath: (path: string) => string
  exists?: (path: string) => boolean
}

export interface EditorCommand {
  command: string
  args: string[]
}

/** True when `target` is `root` or sits below it (compared as resolved paths). */
export function isInside(root: string, target: string, platform: NodeJS.Platform = process.platform): boolean {
  const rel = platform === 'win32' ? win32.relative(root, target) : relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !win32.isAbsolute(rel))
}

/** The VS Code executable on Windows: `code.cmd` is a batch file (it needs a shell), so launch Code.exe instead. */
export function windowsCodeExe(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string | null {
  const candidates: string[] = []
  for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
    // <install>\bin\code.cmd -> <install>\Code.exe
    if (/[\\/]bin$/i.test(dir)) candidates.push(win32.join(dir, '..', 'Code.exe'))
  }
  if (env.LOCALAPPDATA) candidates.push(win32.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'))
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (base) candidates.push(win32.join(base, 'Microsoft VS Code', 'Code.exe'))
  }
  return candidates.find((c) => /Code\.exe$/i.test(c) && exists(c)) ?? null
}

/**
 * Command and arguments to open `folder` (or `file` within it) in VS Code. `file` must stay inside
 * `folder`, including after symlinks are resolved; otherwise this throws.
 */
export function editorCommand(folder: string, file: string | undefined, host: EditorEnv): EditorCommand {
  const win = host.platform === 'win32'
  const root = host.realpath(folder)
  let target = folder
  if (file !== undefined) {
    if (file.includes('\0')) throw new Error('Invalid file path')
    target = win ? win32.resolve(folder, file) : resolve(folder, file)
    if (!isInside(win ? win32.resolve(folder) : resolve(folder), target, host.platform)) {
      throw new Error(`Not inside the repository: ${file}`)
    }
    let real = target
    try {
      real = host.realpath(target)
    } catch {
      // The file may not exist yet; the lexical check above already holds.
    }
    if (!isInside(root, real, host.platform)) throw new Error(`Not inside the repository: ${file}`)
  }
  const args = file !== undefined ? ['-g', target] : [target]
  if (!win) return { command: 'code', args }
  const exe = windowsCodeExe(host.env, host.exists)
  if (!exe) throw new Error('VS Code was not found')
  return { command: exe, args }
}
