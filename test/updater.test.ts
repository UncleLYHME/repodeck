import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GitError, run } from '../src/core/git/run'
import { apply, check, newer, notesSince, parseVersion } from '../src/core/update'
import { tempDir } from './helpers'

const CHANGELOG = `# Changelog

## 1.2.0 — 2026-10-08

- Newest thing
- Another

## 1.1.0 — 2026-10-07

* Middle thing

## 1.0.0 — 2026-10-06

- Old thing
`

describe('versions', () => {
  it('parses, compares and reads notes', () => {
    expect(parseVersion('{"name": "repodeck", "version": "1.10.2"}')).toBe('1.10.2')
    expect(parseVersion('nothing here')).toBeNull()
    expect(newer('1.10.0', '1.9.9')).toBe(true)
    expect(newer('1.0.0', '1.0.0')).toBe(false)
    expect(newer(null, '1.0.0')).toBe(false)
    expect(notesSince(CHANGELOG, '1.0.0')).toEqual(['Newest thing', 'Another', 'Middle thing'])
    expect(notesSince(CHANGELOG, '1.2.0')).toEqual([])
  })
})

// origin (bare) -> app (the running checkout) and dev (where a release is made).
async function setup() {
  const root = tempDir()
  const origin = join(root, 'origin.git')
  const app = join(root, 'app')
  const dev = join(root, 'dev')
  await run(root, ['init', '-q', '--bare', '-b', 'main', origin])
  await run(root, ['clone', '-q', origin, dev])
  const release = async (version: string, note: string) => {
    writeFileSync(join(dev, 'package.json'), JSON.stringify({ name: 'repodeck', version }, null, 2) + '\n')
    const log = join(dev, 'CHANGELOG.md')
    const old = existsSync(log) ? readFileSync(log, 'utf8') : '# Changelog\n'
    writeFileSync(log, old.replace('# Changelog\n', `# Changelog\n\n## ${version} — 2026-10-06\n\n- ${note}\n`))
    await run(dev, ['add', '-A'])
    await run(dev, ['commit', '-qm', `release ${version}`])
    await run(dev, ['push', '-q', 'origin', 'HEAD'])
  }
  await release('1.0.0', 'First')
  await run(root, ['clone', '-q', origin, app])
  return { app, release }
}

describe('checkout updates', () => {
  it('finds nothing new', async () => {
    const { app } = await setup()
    expect(await check(app, '1.0.0')).toBeNull()
  })

  it('finds, applies and reports a remote release', async () => {
    const { app, release } = await setup()
    await release('1.1.0', 'Shiny popup')
    const update = await check(app, '1.0.0')
    expect(update).toEqual({ version: '1.1.0', source: 'remote', notes: ['Shiny popup'] })
    await apply(app, update!, '1.0.0')
    expect(readFileSync(join(app, 'package.json'), 'utf8')).toContain('"1.1.0"')
  })

  it('with checks off ignores upstream but not disk', async () => {
    const { app, release } = await setup()
    await release('1.1.0', 'Upstream only')
    await run(app, ['fetch', '-q'])
    expect(await check(app, '1.0.0', { fetch: false, remote: false })).toBeNull()
    expect((await check(app, '1.0.0', { fetch: false }))?.source).toBe('remote')
  })

  it('an update already on disk needs only a restart', async () => {
    const { app, release } = await setup()
    await release('1.1.0', 'Pulled elsewhere')
    await run(app, ['pull', '-q'])
    const update = await check(app, '1.0.0', { fetch: false })
    expect([update?.version, update?.source]).toEqual(['1.1.0', 'disk'])
  })

  it('a conflicting local edit refuses and changes nothing', async () => {
    const { app, release } = await setup()
    await release('1.1.0', 'Conflicts')
    writeFileSync(join(app, 'package.json'), '{"name": "repodeck", "version": "1.0.0", "local": "tweak"}\n')
    const update = await check(app, '1.0.0')
    const failure = apply(app, update!, '1.0.0')
    await expect(failure).rejects.toBeInstanceOf(GitError)
    await expect(failure).rejects.toThrow('Nothing was changed')
    expect(readFileSync(join(app, 'package.json'), 'utf8')).toContain('tweak')
  })
})
