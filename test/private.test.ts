import * as fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tempDir } from './helpers'

// The folder refusing a new file is stood in for by the first write failing with EACCES, so these
// run under any account (an administrator writes into a read-only folder too).
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, writeFileSync: vi.fn(real.writeFileSync), writeSync: vi.fn(real.writeSync) }
})

const real = await vi.importActual<typeof import('node:fs')>('node:fs')
// test/setup.ts loaded the module before this mock existed; a fresh copy is the one that sees it.
vi.resetModules()
const { replacePrivate } = await import('../src/core/private')
const refusedOnce = (): void => {
  vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
  })
}

describe.skipIf(process.platform === 'win32')('replacing a private file where it stands', () => {
  afterEach(() => {
    vi.mocked(fs.writeFileSync).mockReset().mockImplementation(real.writeFileSync)
    vi.mocked(fs.writeSync).mockReset().mockImplementation(real.writeSync)
  })

  it('rewrites it to the new text, shorter or longer', () => {
    const path = join(tempDir(), 'a.jsonl')
    replacePrivate(path, 'a much longer line from before\n')
    refusedOnce()
    replacePrivate(path, 'new\n')
    expect([real.readFileSync(path, 'utf8'), real.statSync(path).mode & 0o777]).toEqual(['new\n', 0o600])
    refusedOnce()
    replacePrivate(path, 'new\nand longer than it was\n')
    expect(real.readFileSync(path, 'utf8')).toBe('new\nand longer than it was\n')
  })

  it('keeps what it held when the rewrite fails part way', () => {
    const path = join(tempDir(), 'a.jsonl')
    replacePrivate(path, '{"message": "kept"}\n')
    refusedOnce()
    vi.mocked(fs.writeSync)
      .mockImplementationOnce((fd: number, buf: any, off?: any, _len?: any, pos?: any) => real.writeSync(fd, buf, off, 3, pos)) // a few bytes land
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
      })
    expect(() => replacePrivate(path, '{"message": "the rest never made it"}\n')).toThrow('permission denied')
    expect(real.readFileSync(path, 'utf8')).toBe('{"message": "kept"}\n')
  })
})
