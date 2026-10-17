import { describe, expect, it } from 'vitest'
import { Semaphore } from '../src/core/scheduler'

const gate = () => {
  let open!: () => void
  const promise = new Promise<void>((r) => { open = r })
  return { promise, open }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('Semaphore', () => {
  it('never runs more than its limit at once, and runs every task', async () => {
    const sem = new Semaphore(2)
    let active = 0
    let peak = 0
    const done: number[] = []
    await Promise.all(Array.from({ length: 7 }, (_, i) => sem.run(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      done.push(i)
    })))
    expect(peak).toBe(2)
    expect(done.sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('starts waiting tasks in the order they queued', async () => {
    const sem = new Semaphore(1)
    const first = gate()
    const order: string[] = []
    const p1 = sem.run(async () => { order.push('a'); await first.promise })
    const p2 = sem.run(async () => { order.push('b') })
    const p3 = sem.run(async () => { order.push('c') })
    await tick()
    expect(order).toEqual(['a'])
    first.open()
    await Promise.all([p1, p2, p3])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('returns the task result and passes its rejection through', async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(async () => 42)).resolves.toBe(42)
    await expect(sem.run(async () => { throw new Error('nope') })).rejects.toThrow('nope')
  })

  it('frees the slot after a failed task so the queue keeps moving', async () => {
    const sem = new Semaphore(1)
    const failing = sem.run(async () => { throw new Error('fail') })
    const next = sem.run(async () => 'after')
    await expect(failing).rejects.toThrow('fail')
    await expect(next).resolves.toBe('after')
  })
})
