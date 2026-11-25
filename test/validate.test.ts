import { describe, expect, it } from 'vitest'
import { Invalid, checked, flag, hash, list, oneOf, optional, parse, record, setting, text, wholeNumber } from '../src/core/validate'

describe('argument checks', () => {
  it('keeps the named fields of a request and nothing else', () => {
    const spec = { repo: text, paths: list(text), force: optional(flag) }
    // a field that was left out stays left out: it is not handed on as "undefined"
    expect(parse(spec, { repo: '/r', paths: ['a', 'b'], extra: 1 })).toStrictEqual({ repo: '/r', paths: ['a', 'b'] })
    expect(parse(spec, { repo: '/r', paths: [], force: false })).toStrictEqual({ repo: '/r', paths: [], force: false })
    expect(parse(spec, { repo: '/r', paths: [], force: null })).toStrictEqual({ repo: '/r', paths: [] })
    expect(parse({ force: optional(flag) }, undefined)).toStrictEqual({}) // a call without arguments
    expect(parse({ force: optional(flag) }, null)).toStrictEqual({})
  })

  it('refuses a request or a field of the wrong type, naming the field', () => {
    const spec = { repo: text, paths: list(text), force: optional(flag) }
    for (const raw of ['text', 42, ['/r'], true]) expect(() => parse(spec, raw)).toThrow(Invalid)
    expect(() => parse(spec, { repo: 5, paths: [] })).toThrow('repo must be text.')
    expect(() => parse(spec, { repo: '/r', paths: 'a' })).toThrow('paths must be a list.')
    expect(() => parse(spec, { repo: '/r', paths: ['a', {}] })).toThrow('paths must be text.')
    expect(() => parse(spec, { repo: '/r', paths: [], force: 'yes' })).toThrow('force must be true or false.')
    expect(() => parse({ file: record({ path: text }) }, { file: 'a.txt' })).toThrow('file must be an object.')
    expect(() => parse({ file: record({ path: text }) }, { file: { path: 1 } })).toThrow('path must be text.')
  })

  it('accepts only the listed choices, whole numbers in range and commit hashes', () => {
    const mode = oneOf('stage', 'unstage', 'discard')
    expect(mode('stage', 'mode')).toBe('stage')
    for (const bad of ['constructor', '__proto__', 'toString', '', 'Stage', 3, null]) expect(() => mode(bad, 'mode')).toThrow(Invalid)
    const minutes = wholeNumber(1, 60)
    expect(minutes(5, 'minutes')).toBe(5)
    for (const bad of [0, 61, 1.5, -5, NaN, Infinity, '5', null]) expect(() => minutes(bad, 'minutes')).toThrow(Invalid)
    expect(hash('0123abcdEF', 'sha')).toBe('0123abcdEF')
    for (const bad of ['--output=/tmp/x', 'HEAD', 'abc', 'abcd..ef01', '', 7]) expect(() => hash(bad, 'sha')).toThrow()
  })

  it('checks before the handler runs', () => {
    let ran = 0
    const handler = checked({ repo: text }, ({ repo }) => (ran += 1, repo.toUpperCase()))
    expect(handler({ repo: 'r' })).toBe('R')
    expect(() => handler({ repo: {} })).toThrow(Invalid)
    expect(() => handler(undefined)).toThrow(Invalid)
    expect(ran).toBe(1)
  })
})

describe('settings from the page', () => {
  it('takes each known setting with a value of its type', () => {
    expect(setting('autoFetch', false)).toEqual({ key: 'autoFetch', value: false })
    expect(setting('fetchMinutes', 15)).toEqual({ key: 'fetchMinutes', value: 15 })
    expect(setting('diffLayout', 'unified')).toEqual({ key: 'diffLayout', value: 'unified' })
    expect(setting('clock', '24h')).toEqual({ key: 'clock', value: '24h' })
    expect(setting('autostart', true)).toEqual({ key: 'autostart', value: true })
  })

  it('refuses unknown settings, including names every object has', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nope', '', 5, null, undefined, {}]) {
      expect(() => setting(key, true)).toThrow('Unknown setting')
    }
  })

  it('refuses values of the wrong type or out of range', () => {
    for (const value of ['true', 1, null, undefined, {}]) expect(() => setting('autoPull', value)).toThrow(Invalid)
    // 0 or a fraction of a minute would make the background fetch run without a pause
    for (const value of [0, 0.01, -1, 24 * 60 + 1, NaN, Infinity, '5', null]) expect(() => setting('fetchMinutes', value)).toThrow(Invalid)
    for (const value of ['sideways', '', true, null]) expect(() => setting('diffLayout', value)).toThrow(Invalid)
    for (const value of ['25h', 12, null]) expect(() => setting('clock', value)).toThrow(Invalid)
  })
})
