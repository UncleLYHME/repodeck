/// <reference lib="dom" />
// The renderer's only door out: a typed facade over the core's MessagePort and a few main-process
// calls. Raw ipcRenderer and ports never reach the page.

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { Endpoint } from '../shared/rpc'

let port: MessagePort | null = null
let deliver: ((m: unknown) => void) | null = null
const queue: unknown[] = []

const core = new Endpoint({
  send: (m) => (port ? port.postMessage(m) : queue.push(m)),
  listen: (fn) => {
    deliver = fn
  },
})

const listeners = new Map<string, Set<(data: unknown) => void>>()
const dispatch = (name: string, data: unknown) => {
  for (const fn of listeners.get(name) ?? []) fn(data)
}
core.on('*', (e) => {
  const { name, data } = e as { name: string; data: unknown }
  dispatch(name, data)
})

ipcRenderer.on('core-port', (event) => {
  const reconnect = port !== null
  port?.close()
  if (reconnect) core.close('RepoDeck restarted its background process')
  port = event.ports[0]
  port.onmessage = (e: MessageEvent) => deliver?.(e.data)
  while (queue.length) port.postMessage(queue.shift())
  if (reconnect) dispatch('reconnected', null)
})

ipcRenderer.on('main-event', (_e, { name, data }: { name: string; data: unknown }) => dispatch(name, data))

// What the user drops on the window is theirs to add to the deck. Main hears of it from here, where
// the drop itself is seen: only a drop the user made (`isTrusted`, never one the page dispatched),
// and before the page's own handler runs, so main knows the folder by the time the page asks for it.
window.addEventListener('drop', (event) => {
  if (!event.isTrusted) return
  const paths = [...(event.dataTransfer?.files ?? [])].map((file) => webUtils.getPathForFile(file)).filter(Boolean)
  if (paths.length) ipcRenderer.sendSync('host:dropped', paths)
}, true)

const api = {
  call: (method: string, args?: unknown) => core.call(method, args),
  on: (name: string, fn: (data: unknown) => void) => {
    let set = listeners.get(name)
    if (!set) listeners.set(name, (set = new Set()))
    set.add(fn)
    return () => set.delete(fn)
  },
  host: {
    openExternal: (url: string) => ipcRenderer.invoke('host:openExternal', url),
    openPath: (path: string) => ipcRenderer.invoke('host:openPath', path),
    openInEditor: (path: string, file?: string) => ipcRenderer.invoke('host:openInEditor', path, file),
    chooseFolders: (): Promise<string[]> => ipcRenderer.invoke('host:chooseFolders'),
    initialFolders: (): Promise<string[]> => ipcRenderer.invoke('host:initialFolders'),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    appInfo: () => ipcRenderer.invoke('host:appInfo'),
    update: (action: string) => ipcRenderer.invoke('host:update', action),
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('repodeck', api)

export type RepoDeckBridge = typeof api
