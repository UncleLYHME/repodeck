import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../src/core/git/run'
import { download, inspect } from '../src/core/update'
import { changelogSection, nextVersion, noteLines, notesFromCommits } from '../src/shared/release'
import { tempDir } from './helpers'

describe('release versions and notes', () => {
  it('numbers each automatic release, unless package.json was raised on purpose', () => {
    expect(nextVersion('2.1.0', 'v2.1.0')).toBe('2.1.1')
    expect(nextVersion('2.1.0', 'v2.1.7')).toBe('2.1.8')
    expect(nextVersion('2.2.0', 'v2.1.7')).toBe('2.2.0')
    expect(nextVersion('3.0.0', null)).toBe('3.0.0')
  })

  it('turns commit subjects into notes, user-facing changes only', () => {
    const subjects = ['feat: search in history', 'fix(sync): keep the branch', 'ci: faster builds', 'docs: readme',
      'chore(release): 2.1.0', 'Merge branch x', 'perf!: lighter graph', 'feat: search in history', '']
    expect(noteLines(subjects)).toEqual(['Search in history', 'Keep the branch', 'Lighter graph'])
    expect(notesFromCommits(['ci: only ci'])).toBe('- Small fixes and improvements.')
  })

  it('prefers a CHANGELOG section when the version has one', () => {
    const log = '# Changelog\n\n## 2.2.0 — 2026-10-07\n\n- Big thing\n\n## 2.1.0 — 2026-10-06\n\n- Old\n'
    expect(changelogSection(log, '2.2.0')).toBe('- Big thing')
    expect(changelogSection(log, '2.1.5')).toBeNull()
  })
})

// origin (bare) -> app (the running checkout) and dev (where changes are pushed from).
async function setup() {
  const root = tempDir()
  const origin = join(root, 'origin.git')
  const app = join(root, 'app')
  const dev = join(root, 'dev')
  await run(root, ['init', '-q', '--bare', '-b', 'main', origin])
  await run(root, ['clone', '-q', origin, dev])
  const push = async (file: string, text: string, message: string) => {
    mkdirSync(join(dev, file, '..'), { recursive: true })
    writeFileSync(join(dev, file), text)
    await run(dev, ['add', '-A'])
    await run(dev, ['commit', '-qm', message])
    await run(dev, ['push', '-q', 'origin', 'HEAD'])
  }
  await push('package.json', '{"name": "repodeck", "version": "2.1.0"}\n', 'chore(release): 2.1.0')
  await push('src/app.ts', 'export const a = 1\n', 'feat: first')
  await run(root, ['clone', '-q', origin, app])
  const built = (await run(app, ['rev-parse', 'HEAD'])).trim() // what the running build was made from
  return { app, built, push }
}

describe('checkout updates', () => {
  it('finds nothing new', async () => {
    const { app, built } = await setup()
    expect((await inspect(app, built, { fetch: true })).phase).toBe('up-to-date')
  })

  it('offers new upstream commits, downloads them, then waits for a restart', async () => {
    const { app, built, push } = await setup()
    await push('src/app.ts', 'export const a = 2\n', 'feat: shiny popup')
    const found = await inspect(app, built, { fetch: true })
    expect(found.phase).toBe('available')
    expect(found.version).toMatch(/^2\.1\.0 · [0-9a-f]{7}$/)
    expect(found.notes).toEqual(['Shiny popup'])
    await download(app)
    expect(readFileSync(join(app, 'src/app.ts'), 'utf8')).toBe('export const a = 2\n')
    const after = await inspect(app, built, { fetch: false })
    expect([after.phase, after.notes]).toEqual(['ready', ['Shiny popup']])
  })

  it('ignores commits that only change docs', async () => {
    const { app, built, push } = await setup()
    await push('README.md', '# RepoDeck\n', 'docs: readme')
    expect((await inspect(app, built, { fetch: true })).phase).toBe('up-to-date')
  })

  it('a pull from elsewhere only needs a restart', async () => {
    const { app, built, push } = await setup()
    await push('src/app.ts', 'export const a = 3\n', 'fix: pulled in a terminal')
    await run(app, ['pull', '-q'])
    expect((await inspect(app, built, { fetch: false })).phase).toBe('ready')
  })

  it('a conflicting local edit refuses and changes nothing', async () => {
    const { app, built, push } = await setup()
    await push('src/app.ts', 'export const a = 4\n', 'feat: conflicts')
    writeFileSync(join(app, 'src/app.ts'), 'export const a = "local tweak"\n')
    expect((await inspect(app, built, { fetch: true })).phase).toBe('available')
    await expect(download(app)).rejects.toThrow('Nothing was changed')
    expect(readFileSync(join(app, 'src/app.ts'), 'utf8')).toContain('local tweak')
  })
})
