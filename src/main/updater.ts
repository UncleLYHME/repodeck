// Updates for installed copies, from GitHub Releases (electron-updater). Copies run from a git
// checkout update through the checkout instead (src/core/update.ts).
//
// The flow: a new release is announced (available) -> Update downloads it in the background ->
// ready: it installs the next time RepoDeck quits, or right away with Restart Now. With "Install
// Updates Automatically" the download starts by itself.

import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'
import { releaseBullets } from './notes'

export const RELEASES_URL = 'https://github.com/UncleLYHME/repodeck/releases/latest'
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 15 * 60_000
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

export interface UpdaterSettings {
  updateChecks: boolean
  autoUpdate: boolean
}

export class Updater {
  status: UpdateStatus = {
    phase: 'idle', version: null, notes: [], progress: 0, manual: !canSelfUpdate(), checkedAt: null, source: 'installer',
    url: RELEASES_URL,
  }
  private announced = new Set<string>()

  constructor(
    private onChange: (s: UpdateStatus, announce: string | null) => void,
    private settings: () => Promise<UpdaterSettings>,
  ) {}

  start(): void {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = false // Update (or the auto-update preference) starts the download
    autoUpdater.autoInstallOnAppQuit = true // a downloaded update installs on the next quit
    autoUpdater.logger = null
    autoUpdater.on('update-available', (info) => {
      this.set({ phase: 'available', version: info.version, notes: releaseBullets(info.releaseNotes), progress: 0, error: undefined })
      void this.settings().then((s) => {
        if (s.autoUpdate) void this.download()
      }, () => {})
    })
    autoUpdater.on('update-not-available', () => {
      if (this.status.phase === 'checking') this.set({ phase: 'up-to-date', error: undefined })
    })
    autoUpdater.on('download-progress', (p) => this.set({ phase: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ phase: 'ready', version: info.version, progress: 100 }))
    autoUpdater.on('error', (e) => {
      debug('failed:', e.message) // offline, rate-limited: try again next time
      const phase = this.status.phase === 'checking' ? 'error' : this.status.phase === 'downloading' ? 'available' : this.status.phase
      this.set({ phase, error: e.message.split('\n')[0] })
    })
    setTimeout(() => void this.check(false), FIRST_CHECK_MS)
    setInterval(() => void this.check(false), CHECK_EVERY_MS)
  }

  private set(patch: Partial<UpdateStatus>): void {
    const stamped = patch.phase && patch.phase !== 'downloading' && patch.phase !== 'checking'
    this.status = { ...this.status, ...patch, checkedAt: stamped ? Date.now() : this.status.checkedAt }
    debug(this.status.phase, this.status.version ?? '', this.status.phase === 'downloading' ? `${this.status.progress}%` : '')
    let announce: string | null = null
    const key = `${this.status.phase}:${this.status.version}`
    if ((this.status.phase === 'available' || this.status.phase === 'ready') && !this.announced.has(key)) {
      this.announced.add(key)
      announce = this.status.phase === 'available' ? `RepoDeck ${this.status.version} is available` : `RepoDeck ${this.status.version} is ready`
    }
    this.onChange(this.status, announce)
  }

  /** userAsked: Check Now, which checks even when automatic checks are off. */
  async check(userAsked = true): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.status
    if (this.status.phase === 'downloading' || this.status.phase === 'ready') return this.status
    const s = await this.settings().catch(() => ({ updateChecks: true, autoUpdate: false }))
    if (!userAsked && !s.updateChecks) return this.status
    this.set({ phase: 'checking', error: undefined })
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // reported through the 'error' event
    }
    return this.status
  }

  /** Download the available update (or open its page where it can't install itself). */
  async download(): Promise<UpdateStatus> {
    if (this.status.phase !== 'available') return this.status
    if (this.status.manual) {
      void shell.openExternal(RELEASES_URL)
      return this.status
    }
    this.set({ phase: 'downloading', progress: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch {
      // reported through the 'error' event
    }
    return this.status
  }

  /** Quit and install the downloaded update now, then start again. */
  restart(): void {
    if (this.status.phase === 'ready') autoUpdater.quitAndInstall(false, true)
  }
}
