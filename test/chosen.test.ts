import { describe, expect, it } from 'vitest'
import { CHOICE_LASTS, Chosen } from '../src/main/chosen'

describe('folders the user chose', () => {
  it('lets through only what was chosen', () => {
    const chosen = new Chosen()
    expect(chosen.note(['/work/a', '/work/b'])).toEqual(['/work/a', '/work/b'])
    expect(chosen.take(['/work/c'])).toBe(false)
    expect(chosen.take(['/work/a', '/work/c'])).toBe(false) // one the user never pointed at spoils the request
    expect(chosen.take(['/work'])).toBe(false) // not the folder above it
    expect(chosen.take(['/work/a/'])).toBe(false) // nor another way of writing it
    expect(chosen.take(['/work/a', '/work/b'])).toBe(true)
  })

  it('counts each choice once', () => {
    const chosen = new Chosen()
    chosen.note(['/work/a'])
    expect(chosen.take(['/work/a'])).toBe(true)
    expect(chosen.take(['/work/a'])).toBe(false) // removed from the deck again: the page can't put it back by itself
    chosen.note(['/work/a'])
    expect(chosen.take(['/work/a', '/work/a'])).toBe(true)
    expect(chosen.take([])).toBe(true) // nothing asked for, nothing added
  })

  it('refuses a request that keeps what it did not use', () => {
    const chosen = new Chosen()
    chosen.note(['/work/a'])
    expect(chosen.take(['/work/a', '/elsewhere'])).toBe(false)
    expect(chosen.take(['/work/a'])).toBe(true) // the choice was not used up by the refused request
  })

  it('lets a choice lapse when the page does not use it right away', () => {
    let now = 1_000_000
    const chosen = new Chosen(() => now)
    chosen.note(['/work/a', '/work/b'])
    now += CHOICE_LASTS
    expect(chosen.take(['/work/a'])).toBe(true) // still within the moment
    now += 1
    expect(chosen.take(['/work/b'])).toBe(false) // kept for later: by then another checkout could sit there
    chosen.note(['/work/b'])
    expect(chosen.take(['/work/b'])).toBe(true) // chosen anew
  })

  it('refuses anything that is not a list of paths', () => {
    const chosen = new Chosen()
    chosen.note(['/work/a'])
    for (const paths of [undefined, null, '/work/a', { 0: '/work/a', length: 1 }, [['/work/a']], [null]]) expect(chosen.take(paths)).toBe(false)
  })
})
