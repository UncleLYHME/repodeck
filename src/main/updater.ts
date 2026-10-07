// Updates for installed copies, from GitHub Releases (electron-updater). Copies run from a git
// checkout update through the checkout instead (src/core/update.ts).

import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from '../shared/types'
import { releaseBullets } from './notes'

export const RELEASES_URL = 'https://github.com/UncleLYHME/repodeck/releases/latest'
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 30 * 60_000
const debug = (...args: unknown[]) => process.env.REPODECK_DEBUG && console.log('[updater]', ...args)

/**
 * Copies that can replace themselves: Windows installs and Linux AppImages. The macOS app isn't
 * signed yet (macOS only installs signed updates) and a .deb belongs to the package manager, so
 * those are offered the download instead.
 */
export function canSelfUpdate(): boolean {
  if (process.platform === 'win32') return true
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE)
  return false
}

export class Updater {
  found: UpdateInfo | null = null

  constructor(private onFound: (u: UpdateInfo) => void, private enabled: () => Promise<boolean>) {}

  start(): void {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = canSelfUpdate()
    autoUpdater.autoInstallOnAppQuit = canSelfUpdate()
    autoUpdater.logger = null
    autoUpdater.on('update-available', (info) => {
      if (!canSelfUpdate()) this.report({ version: info.version, source: 'manual', notes: releaseBullets(info.releaseNotes), url: RELEASES_URL })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.report({ version: info.version, source: 'download', notes: releaseBullets(info.releaseNotes) })
    })
    autoUpdater.on('error', (e) => debug('update check failed:', e.message)) // offline, rate-limited: try again next time
    autoUpdater.on('update-not-available', (info) => debug('up to date:', info.version))
    autoUpdater.on('download-progress', (p) => debug(`downloading ${Math.round(p.percent)}%`))
    setTimeout(() => void this.check(), FIRST_CHECK_MS)
    setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  private report(update: UpdateInfo): void {
    debug(`update ${update.source}:`, update.version)
    if (this.found?.version === update.version && this.found.source === update.source) return
    this.found = update
    this.onFound(update)
  }

  async check(): Promise<void> {
    if (!app.isPackaged || !(await this.enabled().catch(() => true))) return
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // checked again later
    }
  }

  /** Restart into the downloaded version, or open its download page. */
  install(): void {
    if (!this.found) return
    if (this.found.source === 'manual') void shell.openExternal(this.found.url ?? RELEASES_URL)
    else autoUpdater.quitAndInstall(false, true)
  }
}
