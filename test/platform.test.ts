import { describe, expect, it } from 'vitest'
import { parseLsof } from '../src/core/platform/services'
import { releaseBullets } from '../src/main/notes'
import { basename } from '../src/shared/time'

describe('platform helpers', () => {
  it('parses lsof listeners (macOS), one entry per port', () => {
    const text = 'p501\ncnode\nn*:3000\nn[::]:3000\np777\ncPython\nn127.0.0.1:8000\n'
    expect(parseLsof(text)).toEqual([[3000, 'node', 501], [8000, 'Python', 777]])
  })

  it('takes bullet points from release notes in HTML or Markdown', () => {
    expect(releaseBullets('<ul>\n<li>Faster &amp; <code>lighter</code></li>\n<li>Fixes</li>\n</ul>')).toEqual(['Faster & lighter', 'Fixes'])
    expect(releaseBullets('- One\n* Two\nnot a bullet')).toEqual(['One', 'Two'])
    expect(releaseBullets(null)).toEqual([])
  })

  it('names Windows and POSIX paths alike', () => {
    expect(basename('C:\\Users\\me\\repo')).toBe('repo')
    expect(basename('/home/me/repo/')).toBe('repo')
  })
})
