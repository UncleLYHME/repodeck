// Start on Login. Linux: an XDG autostart entry (same file the Python version wrote).

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { autostartDir } from '../paths'

const entry = () => join(autostartDir(), 'dev.foundry.RepoDeck.desktop')

export function launcher(appDir: string): string {
  const installed = join(homedir(), '.local/bin/repodeck')
  return existsSync(installed) ? installed : join(appDir, 'bin/repodeck')
}

export function autostartEnabled(): boolean {
  return process.platform === 'linux' && existsSync(entry())
}

export function setAutostart(on: boolean, appDir: string): void {
  if (process.platform !== 'linux') throw new Error('Start on Login is only available on Linux for now.')
  if (!on) {
    if (existsSync(entry())) unlinkSync(entry())
    return
  }
  mkdirSync(autostartDir(), { recursive: true })
  writeFileSync(entry(), [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RepoDeck',
    "Comment=Bird's-eye source control for several git repositories",
    `Exec=${launcher(appDir)}`,
    `Icon=${join(appDir, 'data/repodeck.svg')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n'))
}
