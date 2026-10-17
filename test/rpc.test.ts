import { describe, expect, it, vi } from 'vitest'
import { Endpoint, type Wire } from '../src/shared/rpc'

/** Two endpoints joined by an in-memory wire; delivery is asynchronous like a real MessagePort. */
function pair(): { a: Endpoint; b: Endpoint; sent: unknown[] } {
  let toA: (m: unknown) => void = () => {}
  let toB: (m: unknown) => void = () => {}
  const sent: unknown[] = []
  const wireA: Wire = { send: (m) => { sent.push(m); queueMicrotask(() => toB(m)) }, listen: (h) => { toA = h } }
  const wireB: Wire = { send: (m) => { sent.push(m); queueMicrotask(() => toA(m)) }, listen: (h) => { toB = h } }
  return { a: new Endpoint(wireA), b: new Endpoint(wireB), sent }
}

/** One endpoint whose outgoing messages are only recorded; feed it with `deliver`. */
function lone() {
  let deliver: (m: unknown) => void = () => {}
  const out: any[] = []
  const ep = new Endpoint({ send: (m) => { out.push(m) }, listen: (h) => { deliver = h } })
  return { ep, out, deliver: (m: unknown) => deliver(m) }
}

describe('rpc endpoint', () => {
  it('answers a call with the handler result, sync or async', async () => {
    const { a, b } = pair()
    b.handle({ add: ({ x, y }: { x: number; y: number }) => x + y, later: async () => 'done' })
    await expect(a.call('add', { x: 2, y: 3 })).resolves.toBe(5)
    await expect(a.call('later')).resolves.toBe('done')
  })

  it('turns an undefined result into null so it survives structured cloning', async () => {
    const { a, b } = pair()
    b.handle({ nothing: () => undefined })
    await expect(a.call('nothing')).resolves.toBeNull()
  })

  it('rejects with the handler error message, and for unknown methods', async () => {
    const { a, b } = pair()
    b.handle({ boom: () => { throw new Error('disk full') }, str: () => { throw 'plain string' } })
    await expect(a.call('boom')).rejects.toThrow('disk full')
    await expect(a.call('str')).rejects.toThrow('plain string')
    await expect(a.call('missing')).rejects.toThrow('Unknown method missing')
  })

  it('keeps concurrent calls apart by id, whatever order they finish in', async () => {
    const { a, b } = pair()
    b.handle({ slow: () => new Promise((r) => setTimeout(() => r('slow'), 20)), fast: () => 'fast' })
    const [slow, fast] = await Promise.all([a.call('slow'), a.call('fast')])
    expect([slow, fast]).toEqual(['slow', 'fast'])
  })

  it('merges handlers registered in several handle() calls, later ones winning', async () => {
    const { a, b } = pair()
    b.handle({ one: () => 1, two: () => 'old' })
    b.handle({ two: () => 'new' })
    await expect(a.call('one')).resolves.toBe(1)
    await expect(a.call('two')).resolves.toBe('new')
  })

  it('delivers events to named and wildcard listeners, and stops after unsubscribe', async () => {
    const { a, b } = pair()
    const named = vi.fn()
    const star = vi.fn()
    const off = b.on('changed', named)
    b.on('*', star)
    a.emit('changed', { repo: 'x' })
    a.emit('other')
    await new Promise((r) => setTimeout(r, 0))
    expect(named).toHaveBeenCalledOnce()
    expect(named).toHaveBeenCalledWith({ repo: 'x' })
    expect(star.mock.calls.map((c) => c[0])).toEqual([{ name: 'changed', data: { repo: 'x' } }, { name: 'other', data: undefined }])
    off()
    a.emit('changed', 2)
    await new Promise((r) => setTimeout(r, 0))
    expect(named).toHaveBeenCalledOnce()
  })

  it('times out a call that is never answered, and ignores a late reply', async () => {
    vi.useFakeTimers()
    try {
      const { ep, out, deliver } = lone()
      const p = ep.call('hang', null, 50)
      const assertion = expect(p).rejects.toThrow('hang timed out')
      await vi.advanceTimersByTimeAsync(50)
      await assertion
      deliver({ t: 'res', id: out[0].id, ok: true, v: 'late' }) // must not throw
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not time out when a reply arrives in time', async () => {
    vi.useFakeTimers()
    try {
      const { ep, out, deliver } = lone()
      const p = ep.call('quick', null, 50)
      deliver({ t: 'res', id: out[0].id, ok: true, v: 'ok' })
      await expect(p).resolves.toBe('ok')
      await vi.advanceTimersByTimeAsync(100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('close() fails every pending call with the reason', async () => {
    const { ep } = lone()
    const p1 = ep.call('a')
    const p2 = ep.call('b', null, 10_000)
    ep.close('gone')
    await expect(p1).rejects.toThrow('gone')
    await expect(p2).rejects.toThrow('gone')
    const p3 = ep.call('c')
    ep.close()
    await expect(p3).rejects.toThrow('disconnected')
  })

  it('numbers requests sequentially and ignores malformed messages', async () => {
    const { ep, out, deliver } = lone()
    for (const junk of [null, undefined, 42, 'text', { t: 'res', id: 999, ok: true, v: 1 }]) deliver(junk)
    void ep.call('x', 1).catch(() => {})
    void ep.call('y', 2).catch(() => {})
    expect(out).toEqual([{ t: 'req', id: 1, m: 'x', a: 1 }, { t: 'req', id: 2, m: 'y', a: 2 }])
  })
})
