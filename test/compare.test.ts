import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { run } from '../src/core/git/run'
import { commitFiles, log, status } from '../src/core/git/status'
import { Unreadable, commitVersions, workingVersions } from '../src/core/compare'
import { initRepo } from './helpers'

// The renderer's side-by-side view aligns files with @codemirror/merge. These pin down how it lines
// versions up (the Python version used difflib, which kept edits one line apart separate).
const chunks = (a: string, b: string) => Chunk.build(Text.of(a.split('\n')), Text.of(b.split('\n')))
const line = (doc: string, pos: number) => doc.slice(0, pos).split('\n').length

describe('alignment', () => {
  it('lines rows up around a replaced line and an insertion', () => {
    const old = 'a\nb\nc\nd\ne\nf\n'
    const neu = 'a\nB changed\nc\nd\ne\nnew line\nf\n'
    const found = chunks(old, neu)
    expect(found).toHaveLength(2)
    expect([line(old, found[0].fromA), line(neu, found[0].fromB)]).toEqual([2, 2]) // replace b
    expect(found[1].fromA).toBe(found[1].toA) // pure insertion: nothing on the left
    expect(neu.slice(found[1].fromB, found[1].toB)).toBe('new line\n')
    expect([line(old, found[1].fromA), line(neu, found[1].fromB)]).toEqual([6, 6]) // numbers stay true per side
  })

  it('groups edits only one line apart into one change (unlike difflib)', () => {
    const found = chunks('a\nb\nc\nd\n', 'a\nB changed\nc\nnew line\nd\n')
    expect(found).toHaveLength(1)
  })

  it('highlights only the changed words of a replaced line', () => {
    const old = 'total = price * qty\n'
    const neu = 'total = price * quantity + tax\n'
    const [chunk] = chunks(old, neu)
    const left = chunk.changes.map((c) => old.slice(chunk.fromA + c.fromA, chunk.fromA + c.toA)).join('')
    const right = chunk.changes.map((c) => neu.slice(chunk.fromB + c.fromB, chunk.fromB + c.toB)).join('')
    expect(left.length).toBeLessThanOrEqual('qty'.length)
    expect('quantity + tax'.includes(right.trim()) || right.includes('uantity')).toBe(true)
    expect(right).not.toContain('total')
  })

  it('pads the shorter side of an uneven replacement', () => {
    const [chunk] = chunks('x\n', 'y1\ny2\ny3\n')
    expect(chunk.endB - chunk.fromB).toBeGreaterThan(chunk.endA - chunk.fromA)
  })
})

describe('versions', () => {
  it('reads working and commit versions', async () => {
    const repo = await initRepo()
    writeFileSync(join(repo, 'a.py'), 'print(1)\n')
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([0, 1, ...Buffer.from('binary')]))
    await run(repo, ['add', '-A'])
    await run(repo, ['commit', '-qm', 'one'])
    writeFileSync(join(repo, 'a.py'), 'print(2)\n')
    writeFileSync(join(repo, 'new.txt'), 'hello\n')
    const st = await status(repo)
    const ch = Object.fromEntries(st.changes.map((c) => [c.path, c]))
    expect(await workingVersions(repo, st, ch['a.py'])).toEqual(['print(1)\n', 'print(2)\n'])
    expect(await workingVersions(repo, st, ch['new.txt'])).toEqual(['', 'hello\n'])

    await run(repo, ['commit', '-qam', 'two'])
    const rows = await log(repo, await status(repo))
    const [f] = await commitFiles(repo, rows[0].fullSha)
    expect(await commitVersions(repo, rows[0].fullSha, f)).toEqual(['print(1)\n', 'print(2)\n'])
    const root = rows[rows.length - 1].fullSha
    const binFile = (await commitFiles(repo, root)).find((x) => x.path === 'bin.dat')!
    await expect(commitVersions(repo, root, binFile)).rejects.toBeInstanceOf(Unreadable)
  })
})
