import { describe, expect, it } from 'vitest'
import { canFastForward, hasCommits, isNewFile, isPartial, isStaged, letter, statusClass } from '../src/shared/changes'
import { gitignoreEscape, ignoreChoices, suffix } from '../src/shared/ignore'
import { addDays, ago, freshness, greeting, isoTs, localDate, parseDay, phaseFor, plural, short, basename, dirname } from '../src/shared/time'
import type { Change, Status } from '../src/shared/types'

const change = (o: Partial<Change>): Change => ({ path: 'a.txt', x: '.', y: '.', kind: 'tracked', orig: null, ...o })
const status = (o: Partial<Status>): Status => ({ branch: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, operation: null, changes: [], ...o })

describe('gitignore patterns', () => {
  it.each([
    ['plain/file.txt', 'plain/file.txt'],
    ['a*b?c[d]', 'a\\*b\\?c\\[d]'],
    ['back\\slash', 'back\\\\slash'],
    ['#hash', '\\#hash'],
    ['!bang', '\\!bang'],
    ['trail  ', 'trail\\ \\ '],
    ['in side', 'in side'],
  ])('escapes %j as %j', (input, expected) => {
    expect(gitignoreEscape(input)).toBe(expected)
  })

  it.each([
    ['out.log', '.log'],
    ['dir/archive.tar.gz', '.gz'],
    ['.gitignore', ''],
    ['name.', ''],
    ['Makefile', ''],
    ['a.b/noext', ''],
  ])('suffix of %j is %j', (path, expected) => {
    expect(suffix(path)).toBe(expected)
  })

  it('offers the file, its extension and its folder', () => {
    expect(ignoreChoices(change({ path: 'build/out.log' }))).toEqual([
      ['This File', '/build/out.log'],
      ['All .log Files', '*.log'],
      ['Folder build/', '/build/'],
    ])
  })

  it('leaves out the extension or folder choice when there is none', () => {
    expect(ignoreChoices(change({ path: 'Makefile' }))).toEqual([['This File', '/Makefile']])
    expect(ignoreChoices(change({ path: 'src/deep/LICENSE' })).map((c) => c[0])).toEqual(['This File', 'Folder src/deep/'])
  })
})

describe('change helpers', () => {
  it.each([
    [{ kind: 'untracked' as const }, 'U'],
    [{ kind: 'conflict' as const, x: 'U', y: 'U' }, '!'],
    [{ x: 'M', y: '.' }, 'M'],
    [{ x: 'A', y: 'M' }, 'M'], // the working-tree change wins the letter
    [{ x: '.', y: 'D' }, 'D'],
  ])('letter for %j is %s', (c, expected) => {
    expect(letter(change(c))).toBe(expected)
  })

  it('tells staged, partially staged and new files apart', () => {
    expect(isStaged(change({ x: 'M' }))).toBe(true)
    expect(isStaged(change({ y: 'M' }))).toBe(false)
    expect(isStaged(change({ kind: 'untracked', x: '?' }))).toBe(false)
    expect(isPartial(change({ x: 'M', y: 'M' }))).toBe(true)
    expect(isPartial(change({ x: 'M', y: '.' }))).toBe(false)
    expect(isNewFile(change({ kind: 'untracked', x: '?', y: '?' }))).toBe(true)
    expect(isNewFile(change({ x: 'A' }))).toBe(true)
    expect(isNewFile(change({ x: 'C' }))).toBe(true)
    expect(isNewFile(change({ x: 'M' }))).toBe(false)
  })

  it('knows when a repo has commits and when Update can fast-forward', () => {
    expect(hasCommits(status({ oid: '' }))).toBe(false)
    expect(hasCommits(status({ oid: '(initial)' }))).toBe(false)
    expect(hasCommits(status({}))).toBe(true)
    expect(canFastForward(status({ behind: 2 }))).toBe(true)
    expect(canFastForward(status({ behind: 0 }))).toBe(false)
    expect(canFastForward(status({ behind: 2, ahead: 1 }))).toBe(false)
    expect(canFastForward(status({ behind: 2, operation: 'merge' }))).toBe(false)
    expect(canFastForward(status({ behind: 2, upstream: null }))).toBe(false)
    expect(canFastForward(status({ behind: 2, branch: '(detached)' }))).toBe(false)
  })

  it('maps status letters to CSS classes, keeping st-C for conflicts', () => {
    expect(statusClass('M')).toBe('st-M')
    expect(statusClass('C')).toBe('st-R')
    expect(statusClass('!')).toBe('st-C')
  })
})

describe('time and text helpers', () => {
  it('pluralises, including words ending in a consonant + y', () => {
    expect(plural(1, 'commit')).toBe('1 commit')
    expect(plural(0, 'commit')).toBe('0 commits')
    expect(plural(1, 'repository')).toBe('1 repository')
    expect(plural(3, 'repository')).toBe('3 repositories')
    expect(plural(2, 'day')).toBe('2 days') // vowel + y keeps its y
  })

  it.each([
    [0, 'now'], [59, 'now'], [60, '1m'], [3599, '59m'], [3600, '1h'], [86399, '23h'],
    [86400, '1d'], [6 * 86400, '6d'], [7 * 86400, '1w'], [15 * 86400, '2w'], [-500, 'now'],
  ])('ago(%d seconds old) is %s', (age, expected) => {
    expect(ago(1_000_000 - age, 1_000_000)).toBe(expected)
  })

  it.each([[0, '0'], [999, '999'], [1000, '1k'], [1234, '1.2k'], [1999, '2k'], [1949, '1.9k'], [12_500, '12.5k']])(
    'short(%d) is %s', (n, expected) => {
      expect(short(n)).toBe(expected)
    })

  it('parses ISO times into epoch seconds, 0 for nothing', () => {
    expect(isoTs('2026-10-17T00:00:00Z')).toBe(1792195200)
    expect(isoTs(null)).toBe(0)
    expect(isoTs(undefined)).toBe(0)
    expect(isoTs('')).toBe(0)
  })

  it('picks the time-of-day phase and greeting at their boundaries', () => {
    expect([4, 5, 7, 8, 16, 17, 19, 20, 23, 0].map(phaseFor)).toEqual(
      ['night', 'dawn', 'dawn', 'day', 'day', 'dusk', 'dusk', 'night', 'night', 'night'])
    expect([4, 5, 11, 12, 16, 17, 21, 22, 0].map(greeting)).toEqual(
      ['Burning the midnight oil', 'Good morning', 'Good morning', 'Good afternoon', 'Good afternoon',
        'Good evening', 'Good evening', 'Burning the midnight oil', 'Burning the midnight oil'])
  })

  it('does calendar arithmetic across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-10-17', 0)).toBe('2026-10-17')
    expect(localDate(parseDay('2026-03-09'))).toBe('2026-03-09')
  })

  it('splits paths on either separator', () => {
    expect(basename('/a/b/c/')).toBe('c')
    expect(basename('C:\\a\\b')).toBe('b')
    expect(basename('/')).toBe('/')
    expect(dirname('a/b/c.txt')).toBe('a/b')
    expect(dirname('c.txt')).toBe('')
  })

  it('says how fresh GitHub data is, and when it is old because GitHub is unreachable', () => {
    expect(freshness(null)).toBe('')
    expect(freshness({})).toBe('')
    expect(freshness({ fetchedAt: 1000 }, 1010)).toBe('Updated just now')
    expect(freshness({ fetchedAt: 1000 }, 1000 + 180)).toBe('Updated 3m ago')
    expect(freshness({ fetchedAt: 1000, stale: 'offline' }, 1000 + 7200)).toBe('GitHub unreachable · showing data from 2h ago')
  })
})
