// The core: a utility process (plain Node, no Electron APIs) that owns git, file watching, stats
// and settings. The renderer talks to it over a MessagePort it gets from main; things only main
// can do (Trash, notifications, relaunching) go back to main over parentPort.

import type { MessagePortMain } from 'electron'
import { Endpoint } from '../shared/rpc'
import { cache } from './cache'
import { activity } from './activity'
import { Deck } from './deck'
import { GithubWatch, UpdateWatch } from './services'
import { handlers } from './api'
import { useLoginItems } from './platform/autostart'

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (e: { data: unknown; ports: MessagePortMain[] }) => void): void
}

const parent = (process as unknown as { parentPort: ParentPort }).parentPort
const appDir = process.env.REPODECK_APP_DIR || process.cwd()
const version = process.env.REPODECK_VERSION || '0.0.0'

// -- main <-> core ----------------------------------------------------------------------------

let toHost: ((m: unknown) => void) | null = null
const main = new Endpoint({
  send: (m) => parent.postMessage(m),
  listen: (fn) => {
    toHost = fn
  },
})

// -- renderer <-> core ------------------------------------------------------------------------

const renderers = new Set<Endpoint>()
const broadcast = (name: string, data: unknown) => {
  for (const r of renderers) r.emit(name, data)
}

// main decides between an in-app toast (window focused) and a desktop notification
const host = {
  emit: broadcast,
  toast: (message: string) => broadcast('toast', message),
  announce: (message: string, body?: string, key?: string, uri?: string) =>
    main.emit('announce', { message, body, key, uri, notify: deck.settings.notify }),
}
const deck = new Deck(host, appDir)
const github = new GithubWatch(deck, host)
// Installed copies update from GitHub Releases (main); a checkout updates itself through git.
const updates = process.env.REPODECK_PACKAGED ? null : new UpdateWatch(deck, host, version)
if (process.platform !== 'linux') {
  useLoginItems({ get: () => main.call<boolean>('loginItem', {}), set: (on) => main.call<boolean>('loginItem', { on }) })
}
activity().subscribe((entry) => broadcast('activity', entry))

const api = handlers(deck, github, updates, {
  trash: (path) => main.call('trash', { path }, 30_000),
  relaunch: () => main.call('relaunch', null, 10_000),
}, version)

function attach(port: MessagePortMain): void {
  const endpoint = new Endpoint({
    send: (m) => port.postMessage(m),
    listen: (fn) => port.on('message', (e) => fn(e.data)),
  })
  endpoint.handle(api as unknown as Record<string, (args: never) => unknown>)
  renderers.add(endpoint)
  port.on('close', () => {
    renderers.delete(endpoint)
    endpoint.close()
  })
  port.start()
}

main.handle({
  shutdown: () => {
    cache().save() // don't lose results computed in the last seconds before quitting
    github.close()
    updates?.close()
    deck.close()
    setTimeout(() => process.exit(0), 50)
  },
  windowFocused: () => deck.refreshAll(),
  settings: () => deck.settings,
  log: ({ message }: { message: string }) => void activity().add(message, null, 'auto'),
})

parent.on('message', (e) => {
  const data = e.data as { type?: string } | null
  if (data?.type === 'attach' && e.ports.length) attach(e.ports[0])
  else toHost?.(e.data)
})

process.on('uncaughtException', (err) => {
  activity().add(`Internal error: ${err.message}`, null, 'auto', 'error')
})
