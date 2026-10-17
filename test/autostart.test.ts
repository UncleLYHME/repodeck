import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autostartEnabled, launcher, setAutostart, useLoginItems } from '../src/core/platform/autostart'
import { tempDir } from './helpers'

const linux = process.platform === 'linux'
const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME }
let home: string

beforeEach(() => {
  home = tempDir()
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = join(home, 'cfg')
})

afterEach(() => {
  for (const [key, value] of [['HOME', saved.HOME], ['XDG_CONFIG_HOME', saved.XDG]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const entry = () => join(home, 'cfg', 'autostart', 'dev.foundry.RepoDeck.desktop')

describe('start on login', () => {
  it('prefers the launcher installed in ~/.local/bin over the checkout\'s', () => {
    expect(launcher('/opt/repodeck')).toBe('/opt/repodeck/bin/repodeck')
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    writeFileSync(join(home, '.local/bin/repodeck'), '#!/bin/sh\n')
    expect(launcher('/opt/repodeck')).toBe(join(home, '.local/bin/repodeck'))
  })

  it.runIf(linux)('writes, detects and removes the XDG autostart entry', async () => {
    expect(autostartEnabled()).toBe(false)
    await setAutostart(true, '/opt/repodeck')
    expect(autostartEnabled()).toBe(true)
    const text = readFileSync(entry(), 'utf8')
    expect(text.split('\n')).toEqual(expect.arrayContaining([
      '[Desktop Entry]', 'Type=Application', 'Name=RepoDeck', 'Exec=/opt/repodeck/bin/repodeck',
      'Icon=/opt/repodeck/data/repodeck.svg', 'Terminal=false', 'X-GNOME-Autostart-enabled=true',
    ]))
    expect(text.endsWith('\n')).toBe(true)
    await setAutostart(false, '/opt/repodeck')
    expect(existsSync(entry())).toBe(false)
    expect(autostartEnabled()).toBe(false)
  })

  it.runIf(linux)('rewrites the entry when turned on twice, and turning off with none is harmless', async () => {
    await setAutostart(false, '/opt/repodeck')
    await setAutostart(true, '/opt/one')
    await setAutostart(true, '/opt/two')
    const text = readFileSync(entry(), 'utf8')
    expect(text).toContain('Exec=/opt/two/bin/repodeck')
    expect(text).not.toContain('/opt/one')
  })

  it.skipIf(linux)('needs main\'s login-item hook off Linux, then follows it', async () => {
    await expect(setAutostart(true, '/x')).rejects.toThrow('not available')
    let on = false
    useLoginItems({ get: async () => on, set: async (v) => (on = v) })
    await setAutostart(true, '/x')
    expect(autostartEnabled()).toBe(true)
    await setAutostart(false, '/x')
    expect(autostartEnabled()).toBe(false)
  })
})
