// Where RepoDeck keeps its files: the same XDG locations RepoDeck 1.x used, so settings,
// the activity log and folder lists carry over. REPODECK_PROFILE suffixes them (tests, QA copies).

import { homedir } from 'node:os'
import { join } from 'node:path'

const profile = process.env.REPODECK_PROFILE ? `-${process.env.REPODECK_PROFILE}` : ''
const name = `repodeck${profile}`

function xdg(variable: string, fallback: string): string {
  const v = process.env[variable]
  return v && v.startsWith('/') ? v : join(homedir(), fallback)
}

// Main passes the folders it chose (per platform, see src/main/dirs.ts); tests and `pnpm core` use XDG.
export const configDir = (): string => process.env.REPODECK_CONFIG_DIR || join(xdg('XDG_CONFIG_HOME', '.config'), name)
export const cacheDir = (): string => process.env.REPODECK_CACHE_DIR || join(xdg('XDG_CACHE_HOME', '.cache'), name)
export const stateDir = (): string => process.env.REPODECK_STATE_DIR || join(xdg('XDG_STATE_HOME', '.local/state'), name)
export const autostartDir = (): string => join(xdg('XDG_CONFIG_HOME', '.config'), 'autostart')
