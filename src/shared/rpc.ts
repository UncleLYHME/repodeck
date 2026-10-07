// A tiny request/response + event protocol over anything that can post messages
// (Electron MessagePortMain, a DOM MessagePort, a utility process's parentPort).

export interface Wire {
  send(message: unknown): void
  listen(handler: (message: unknown) => void): void
}

type Message =
  | { t: 'req'; id: number; m: string; a: unknown }
  | { t: 'res'; id: number; ok: true; v: unknown }
  | { t: 'res'; id: number; ok: false; e: string }
  | { t: 'evt'; n: string; d: unknown }

export type Handler = (args: never) => unknown

export class Endpoint {
  private nextId = 1
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }>()
  private handlers: Record<string, Handler> = {}
  private listeners = new Map<string, Set<(data: unknown) => void>>()

  constructor(private wire: Wire) {
    wire.listen((raw) => this.receive(raw as Message))
  }

  handle(handlers: Record<string, Handler>): void {
    Object.assign(this.handlers, handlers)
  }

  call<T = unknown>(method: string, args?: unknown, timeoutMs = 0): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const entry: { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> } = {
        resolve: resolve as (v: unknown) => void,
        reject,
      }
      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          this.waiting.delete(id)
          reject(new Error(`${method} timed out`))
        }, timeoutMs)
      }
      this.waiting.set(id, entry)
      this.wire.send({ t: 'req', id, m: method, a: args })
    })
  }

  emit(name: string, data?: unknown): void {
    this.wire.send({ t: 'evt', n: name, d: data })
  }

  on(name: string, fn: (data: unknown) => void): () => void {
    let set = this.listeners.get(name)
    if (!set) this.listeners.set(name, (set = new Set()))
    set.add(fn)
    return () => set.delete(fn)
  }

  /** Fail every call still waiting (the other side went away). */
  close(reason = 'disconnected'): void {
    for (const w of this.waiting.values()) {
      if (w.timer) clearTimeout(w.timer)
      w.reject(new Error(reason))
    }
    this.waiting.clear()
  }

  private async receive(msg: Message): Promise<void> {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'evt') {
      for (const fn of this.listeners.get(msg.n) ?? []) fn(msg.d)
      for (const fn of this.listeners.get('*') ?? []) fn({ name: msg.n, data: msg.d })
    } else if (msg.t === 'res') {
      const w = this.waiting.get(msg.id)
      if (!w) return
      this.waiting.delete(msg.id)
      if (w.timer) clearTimeout(w.timer)
      if (msg.ok) w.resolve(msg.v)
      else w.reject(new Error(msg.e))
    } else if (msg.t === 'req') {
      const fn = this.handlers[msg.m]
      try {
        if (!fn) throw new Error(`Unknown method ${msg.m}`)
        const v = await fn(msg.a as never)
        this.wire.send({ t: 'res', id: msg.id, ok: true, v: v === undefined ? null : v })
      } catch (e) {
        this.wire.send({ t: 'res', id: msg.id, ok: false, e: e instanceof Error ? e.message : String(e) })
      }
    }
  }
}
