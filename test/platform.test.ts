import { describe, expect, it } from 'vitest'
import { parseLsof } from '../src/core/platform/services'
import { localeHour12, parseClock } from '../src/main/clock'
import { releaseBullets } from '../src/main/notes'
import { basename, clockHour } from '../src/shared/time'

describe('platform helpers', () => {
  it('parses lsof listeners (macOS), one entry per port', () => {
    const text = 'p501\ncnode\nn*:3000\nn[::]:3000\np777\ncPython\nn127.0.0.1:8000\n'
    expect(parseLsof(text)).toEqual([[3000, 'node', 501], [8000, 'Python', 777]])
  })

  it('takes bullet points from release notes in HTML or Markdown', () => {
    expect(releaseBullets('<ul>\n<li>Faster &amp; <code>lighter</code></li>\n<li>Fixes</li>\n</ul>')).toEqual(['Faster & lighter', 'Fixes'])
    expect(releaseBullets('- One\n* Two\nnot a bullet')).toEqual(['One', 'Two'])
    expect(releaseBullets('- **Update** downloads `it`')).toEqual(['Update downloads it'])
    expect(releaseBullets(null)).toEqual([])
  })

  it('names Windows and POSIX paths alike', () => {
    expect(basename('C:\\Users\\me\\repo')).toBe('repo')
    expect(basename('/home/me/repo/')).toBe('repo')
  })

  it("reads each system's 12/24-hour clock setting", () => {
    expect(parseClock('linux', "'12h'\n")).toBe(true)
    expect(parseClock('linux', "'24h'\n")).toBe(false)
    expect(parseClock('linux', '')).toBeUndefined()
    expect(parseClock('darwin', '{\n    AppleICUForce24HourTime = 1;\n}')).toBe(false)
    expect(parseClock('darwin', '{\n    AppleICUForce12HourTime = 1;\n}')).toBe(true)
    expect(parseClock('darwin', '{\n    AppleLocale = "en_GB";\n}')).toBeUndefined()
    expect(parseClock('win32', '    sShortTime    REG_SZ    h:mm tt\r\n')).toBe(true)
    expect(parseClock('win32', '    sShortTime    REG_SZ    HH:mm\r\n')).toBe(false)
  })

  it("falls back to the region's clock", () => {
    expect(localeHour12('en_US.UTF-8')).toBe(true)
    expect(localeHour12('en-GB')).toBe(false)
    expect(localeHour12('de_DE.UTF-8@euro')).toBe(false)
    expect(typeof localeHour12('C')).toBe('boolean')
  })

  it('labels hours in either clock', () => {
    expect(clockHour(9, false)).toBe('09:00')
    expect(clockHour(24, false)).toBe('00:00')
    expect(clockHour(14, true)).toMatch(/^2\s?PM$/i)
  })
})
