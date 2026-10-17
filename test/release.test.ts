import { describe, expect, it } from 'vitest'
import { changelogSection, nextVersion, noteLines, notesFromCommits, parse, releaseOf } from '../src/shared/release'

describe('release version parsing', () => {
  it.each([
    ['2.1.3', [2, 1, 3]],
    ['v10.0.12', [10, 0, 12]],
    ['2.1.3-beta.1', [2, 1, 3]],
    ['2.1', [0, 0, 0]],
    ['latest', [0, 0, 0]],
    ['', [0, 0, 0]],
    [null, [0, 0, 0]],
    [undefined, [0, 0, 0]],
  ])('parse(%j) = %j', (input, expected) => {
    expect(parse(input)).toEqual(expected)
  })
})

describe('next release version', () => {
  it.each([
    ['2.2.0', 'v2.2.0', '2.2.1'], // same as latest: bump the patch
    ['2.2.0', 'v2.2.9', '2.2.10'], // numeric, not lexical
    ['2.2.0', 'v2.10.0', '2.10.1'], // package.json behind: ignored
    ['2.3.0', 'v2.2.9', '2.3.0'], // raised on purpose
    ['2.2.5', 'v2.2.4', '2.2.5'],
    ['3.0.0', 'v2.99.99', '3.0.0'],
    ['2.2.0', null, '2.2.0'], // first release ever
    ['0.0.0', '', '0.0.1'],
    ['garbage', 'v1.2.3', '1.2.4'],
  ])('package %s, latest %s -> %s', (pkg, latest, expected) => {
    expect(nextVersion(pkg, latest)).toBe(expected)
  })
})

describe('release of a commit', () => {
  it('uses the highest tag on the commit, compared numerically', () => {
    expect(releaseOf('1.0.0', ['v2.2.9', 'v2.2.10', 'v2.2.2'], 'v2.2.10')).toBe('2.2.10')
  })
  it('ignores tags that are not versions', () => {
    expect(releaseOf('2.2.0', ['nightly', 'v0.0.0'], 'v2.2.3')).toBe('2.2.4')
  })
})

describe('release notes from commit subjects', () => {
  it.each([
    ['feat: add search', 'Add search'],
    ['fix(ui): align icons', 'Align icons'],
    ['feat!: drop GTK', 'Drop GTK'],
    ['perf(core)!: faster status', 'Faster status'],
    ['FIX: shouty prefix', 'Shouty prefix'],
    ['refactor: tidy the store', 'Tidy the store'],
    ['no prefix at all', 'No prefix at all'],
    ['  feat:   padded  ', 'Padded'],
  ])('%j becomes the note %j', (subject, note) => {
    expect(noteLines([subject])).toEqual([note])
  })

  it.each(['ci: x', 'test: x', 'tests: x', 'docs: x', 'chore: x', 'chore(release): 2.2.0', 'build: x', 'style: x', 'docs(readme)!: x',
    'Merge pull request #4 from a/b', 'Merge branch main', '', '   '])('leaves out %j', (subject) => {
    expect(noteLines([subject])).toEqual([])
  })

  it('keeps first-seen order and drops duplicates', () => {
    expect(noteLines(['fix: b', 'feat: a', 'fix: b', 'feat: c', 'feat: a'])).toEqual(['B', 'A', 'C'])
  })

  it('formats a Markdown list, or a fallback line when nothing is user-facing', () => {
    expect(notesFromCommits(['feat: one', 'docs: skip', 'fix: two'])).toBe('- One\n- Two')
    expect(notesFromCommits([])).toBe('- Small fixes and improvements.')
    expect(notesFromCommits(['chore: a', 'Merge x'])).toBe('- Small fixes and improvements.')
  })
})

describe('changelog sections', () => {
  const log = ['# Changelog', '', '## 2.2.0 — 2026-10-06', '', '- Newest', '- Also', '', '## v2.1.0 — 2026-10-06', '', '- Older', '',
    '## 2.10.0 — 2026-10-08', '', '- Ten', '', '## 1.0.0', '', '- Last, with no trailing heading', ''].join('\n')

  it('returns exactly the body between two headings', () => {
    expect(changelogSection(log, '2.2.0')).toBe('- Newest\n- Also')
    expect(changelogSection(log, '2.1.0')).toBe('- Older')
  })
  it('reads the last section to the end of the file', () => {
    expect(changelogSection(log, '1.0.0')).toBe('- Last, with no trailing heading')
  })
  it('does not mistake 2.1.0 for 2.10.0 (or the dots for wildcards)', () => {
    expect(changelogSection(log, '2.10.0')).toBe('- Ten')
    expect(changelogSection(log, '2x2x0')).toBeNull()
  })
  it('is null for a missing version or an empty section', () => {
    expect(changelogSection(log, '9.9.9')).toBeNull()
    expect(changelogSection('## 3.0.0\n\n## 2.0.0\n- x', '3.0.0')).toBeNull()
  })
})
