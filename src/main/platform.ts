// Per-platform details for main: the app menu, the PATH GUI apps get, opening VS Code, login items.

import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { app, Menu } from 'electron'
import { editorCommand } from './editor'

/**
 * macOS needs a menu for Cmd+Q and copy/paste in text fields. Elsewhere there is none, so no
 * default accelerators get in the way (Ctrl+R refreshes repos, it doesn't reload the page).
 */
export function setMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]))
}

/**
 * Apps started from the Dock or Finder get a bare PATH (no Homebrew), so git and gh go missing.
 * Ask the login shell for the user's PATH, as a terminal would see it.
 */
export function loginPath(): string | undefined {
  if (process.platform !== 'darwin') return undefined
  const fallback = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? '/usr/bin:/bin'].join(':')
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { encoding: 'utf8', timeout: 3000 })
    return /__PATH__(.*)__PATH__/.exec(out)?.[1] || fallback
  } catch {
    return fallback
  }
}

/** Open a folder, or a file inside it, in VS Code. Never goes through a shell. */
export function openInCode(folder: string, file?: string): void {
  const cmd = editorCommand(folder, file, { platform: process.platform, env: process.env, realpath: realpathSync })
  spawn(cmd.command, cmd.args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
}

/** Start on Login for macOS and Windows (Linux uses an XDG autostart entry, written by the core). */
export const loginItem = {
  get: (): boolean => app.getLoginItemSettings().openAtLogin,
  set: (on: boolean): void => app.setLoginItemSettings({ openAtLogin: on }),
}
