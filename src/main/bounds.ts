// Remember the window's size and place between runs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { screen, type BrowserWindow } from 'electron'

interface Bounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

/** RepoDeck's settings folder (the core uses the same rule; see src/core/paths.ts). */
export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.startsWith('/') ? process.env.XDG_CONFIG_HOME : join(homedir(), '.config')
  const profile = process.env.REPODECK_PROFILE ? `-${process.env.REPODECK_PROFILE}` : ''
  return join(base, `repodeck${profile}`)
}

const file = () => join(configDir(), 'window.json')

export function loadBounds(): Bounds {
  const fallback: Bounds = { width: 1600, height: 980 }
  try {
    const b = JSON.parse(readFileSync(file(), 'utf8')) as Bounds
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x !== undefined && b.y !== undefined && b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y)
    return visible ? b : { width: b.width, height: b.height, maximized: b.maximized }
  } catch {
    return fallback
  }
}

export function saveBounds(win: BrowserWindow): void {
  try {
    const b = win.getNormalBounds()
    mkdirSync(join(file(), '..'), { recursive: true })
    writeFileSync(file(), JSON.stringify({ ...b, maximized: win.isMaximized() }))
  } catch {
    // not worth failing a quit over
  }
}
