/** At most `limit` tasks at once; the rest wait their turn. */
export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve))
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.queue.shift()?.()
    }
  }
}

export const reads = new Semaphore(6) // status/log refreshes across all repos
export const network = new Semaphore(2) // background fetches
