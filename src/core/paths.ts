// Where RepoDeck keeps its files: the same XDG locations the Python version used, so settings,
// the activity log and folder lists carry over. REPODECK_PROFILE suffixes them (tests, QA copies).

import { homedir } from 'node:os'
import { join } from 'node:path'

const profile = process.env.REPODECK_PROFILE ? `-${process.env.REPODECK_PROFILE}` : ''
const name = `repodeck${profile}`

function xdg(variable: string, fallback: string): string {
  const v = process.env[variable]
  return v && v.startsWith('/') ? v : join(homedir(), fallback)
}

export const configDir = (): string => join(xdg('XDG_CONFIG_HOME', '.config'), name)
export const cacheDir = (): string => join(xdg('XDG_CACHE_HOME', '.cache'), name)
export const stateDir = (): string => join(xdg('XDG_STATE_HOME', '.local/state'), name)
export const autostartDir = (): string => join(xdg('XDG_CONFIG_HOME', '.config'), 'autostart')
