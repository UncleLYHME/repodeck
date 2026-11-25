import { execFileSync } from 'node:child_process'
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
const { readPrivate, replacePrivate } = await import('../src/core/private')
const { ActivityLog } = await import('../src/core/activity')
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

describe.skipIf(process.platform === 'win32')("a file of the user's from another account", () => {
  // Tests can't give a file to another account, so this run stands in for that account instead.
  const asAnotherAccount = () => vi.spyOn(process, 'getuid').mockReturnValue(process.getuid!() + 1)
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(fs.writeFileSync).mockReset().mockImplementation(real.writeFileSync)
  })

  it('is carried over into a new private file', () => {
    const path = join(tempDir(), 'a.jsonl')
    real.writeFileSync(path, 'restored\n')
    real.chmodSync(path, 0o644)
    const was = real.statSync(path).ino
    asAnotherAccount()
    expect(readPrivate(path)).toBe('restored\n')
    const now = real.lstatSync(path)
    expect([real.readFileSync(path, 'utf8'), now.isFile(), now.mode & 0o777, now.ino === was]).toEqual(['restored\n', true, 0o600, false])
  })

  it('is still not read through a link, a second name or a pipe', () => {
    const target = join(tempDir(), 'someone-elses.jsonl')
    real.writeFileSync(target, 'theirs\n')
    real.chmodSync(target, 0o644)
    const [soft, hard, pipe] = ['soft', 'hard', 'pipe'].map((name) => join(tempDir(), name))
    real.symlinkSync(target, soft)
    real.linkSync(target, hard)
    execFileSync('mkfifo', [pipe])
    asAnotherAccount()
    for (const path of [soft, hard, pipe]) expect(readPrivate(path)).toBeNull()
    expect([real.lstatSync(soft).isSymbolicLink(), real.statSync(hard).nlink, real.lstatSync(pipe).isFIFO()]).toEqual([true, 2, true])
    expect([real.readFileSync(target, 'utf8'), real.statSync(target).mode & 0o777]).toEqual(['theirs\n', 0o644])
  })

  it('is left as it was when the folder takes no new file', () => {
    // Stood in for by every new file failing with EACCES, so this runs under any account.
    const folder = tempDir()
    const path = join(folder, 'a.jsonl')
    const history = '{"ts": 1, "message": "from the old account"}\n'
    real.writeFileSync(path, history)
    real.chmodSync(path, 0o644)
    const refuse = (file: unknown, ...rest: unknown[]): void => {
      if (typeof file === 'string') throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      ;(real.writeFileSync as (...a: unknown[]) => void)(file, ...rest)
    }
    vi.mocked(fs.writeFileSync).mockImplementation(refuse as typeof fs.writeFileSync)
    asAnotherAccount()
    const log = new ActivityLog(path)
    expect(log.entries.map((e) => e.message)).toEqual(['from the old account'])
    log.add('pushed', '/r/private-project')
    log.clear()
    vi.mocked(fs.writeFileSync).mockImplementation(real.writeFileSync) // the folder takes new files again
    log.add('pushed again', '/r/private-project')
    log.clear()
    expect([real.readFileSync(path, 'utf8'), real.statSync(path).mode & 0o777, real.readdirSync(folder)]).toEqual([history, 0o644, ['a.jsonl']])
  })
})
