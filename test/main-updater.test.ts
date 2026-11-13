import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, shell: { openExternal: vi.fn() } }))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))

import { canSelfUpdate } from '../src/main/updater'

describe('installed update trust', () => {
  it('keeps unsigned release packages on the manual download path', () => {
    const previous = process.env.APPIMAGE
    process.env.APPIMAGE = '/tmp/RepoDeck.AppImage'
    try {
      expect(canSelfUpdate()).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.APPIMAGE
      else process.env.APPIMAGE = previous
    }
  })
})
