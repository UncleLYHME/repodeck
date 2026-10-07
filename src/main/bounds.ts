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

/** The saved size and place, kept on a screen that exists now and no larger than it (xrdp sessions change size). */
export function loadBounds(): Bounds {
  let b: Bounds = { width: 1600, height: 980 }
  try {
    b = { ...b, ...(JSON.parse(readFileSync(file(), 'utf8')) as Bounds) }
  } catch {
    // first run
  }
  const displays = screen.getAllDisplays()
  const home = displays.find(({ workArea: a }) =>
    b.x !== undefined && b.y !== undefined && b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y)
  const area = (home ?? screen.getPrimaryDisplay()).workArea
  const width = Math.min(b.width, area.width)
  const height = Math.min(b.height, area.height)
  if (!home) return { x: area.x, y: area.y, width, height, maximized: b.maximized } // fill the free space, not the monitor
  const x = Math.min(Math.max(b.x!, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(b.y!, area.y), area.y + area.height - height)
  return { x, y, width, height, maximized: b.maximized }
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
