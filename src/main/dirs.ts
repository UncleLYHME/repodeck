// Where RepoDeck keeps settings, cache and logs. Linux: the XDG folders RepoDeck has always used;
// macOS and Windows: the platform's app-data folder. Main computes them and hands them to the core.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

const profile = process.env.REPODECK_PROFILE ? `-${process.env.REPODECK_PROFILE}` : ''

function xdg(variable: string, fallback: string): string {
  const v = process.env[variable]
  return v && v.startsWith('/') ? v : join(homedir(), fallback)
}

export interface Dirs {
  config: string
  cache: string
  state: string
}

export function dirs(): Dirs {
  if (process.platform === 'linux') {
    return {
      config: join(xdg('XDG_CONFIG_HOME', '.config'), `repodeck${profile}`),
      cache: join(xdg('XDG_CACHE_HOME', '.cache'), `repodeck${profile}`),
      state: join(xdg('XDG_STATE_HOME', '.local/state'), `repodeck${profile}`),
    }
  }
  const base = join(app.getPath('appData'), `RepoDeck${profile}`)
  return { config: base, cache: join(base, 'Cache'), state: join(base, 'State') }
}

export const configDir = (): string => dirs().config

/** Environment for the core so it uses the same folders. */
export function dirsEnv(): Record<string, string> {
  const d = dirs()
  return { REPODECK_CONFIG_DIR: d.config, REPODECK_CACHE_DIR: d.cache, REPODECK_STATE_DIR: d.state }
}
