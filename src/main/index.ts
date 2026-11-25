// Electron main: the window, the core utility process, and the few things only main can do
// (Trash, notifications, dialogs, opening URLs and editors, relaunching).

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, MessageChannelMain, Notification, session, shell, utilityProcess,
  type IpcMainEvent, type IpcMainInvokeEvent, type UtilityProcess,
} from 'electron'
import type { UpdateAction } from '../shared/types'
import { Endpoint } from '../shared/rpc'
import { loadBounds, saveBounds } from './bounds'
import { Chosen } from './chosen'
import { systemHour12 } from './clock'
import { configDir, dirsEnv } from './dirs'
import { folderView, isAppPage, webLink } from './guard'
import { loginItem, loginPath, openInCode, setMenu } from './platform'
import { adoptSession, otherSession, sessionEnv } from './session'
import { Updater, type UpdaterSettings } from './updater'

const APP_DIR = app.getAppPath() // the checkout (package.json, bin/, data/), or app.asar when installed
const DEV_URL = process.env.ELECTRON_RENDERER_URL
// The one page that gets the core and may ask main for anything.
const PAGE_URL = DEV_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
// A real file for notifications (the notification daemon can't read inside app.asar).
const ICON = join(APP_DIR.replace(/app\.asar$/, 'app.asar.unpacked'), 'data/repodeck.png')

// xrdp and VMs often have no GPU render node; software compositing avoids a crashing GPU process.
const hasGpu = process.platform !== 'linux' || (existsSync('/dev/dri') && readdirSync('/dev/dri').some((n) => n.startsWith('renderD')))
if (!hasGpu && process.env.REPODECK_GPU !== '1') app.disableHardwareAcceleration()
app.setName('RepoDeck')
// Chromium's own data (and the single-instance lock) per profile, next to RepoDeck's settings.
app.setPath('userData', join(configDir(), 'electron'))

let win: BrowserWindow | null = null
let core: UtilityProcess | null = null
let coreRpc: Endpoint | null = null
let quitting = false
const updater = new Updater(
  (status, title) => {
    win?.webContents.send('main-event', { name: 'update', data: status })
    if (!title) return
    void coreRpc?.call('log', { message: title }).catch(() => {})
    const body = status.phase === 'ready' ? 'It installs when you quit RepoDeck.' : 'Open RepoDeck to update.'
    announce({ message: title, body, key: 'update', notify: true })
  },
  async () => (await coreRpc?.call<UpdaterSettings>('settings', null, 5000)) ?? { updateChecks: true, autoUpdate: false },
)

const foldersIn = (argv: string[]) => argv.filter((a) => isAbsolute(a) && isDir(a) && a !== APP_DIR)

const chosen = new Chosen() // what the user asked to have added: the core adds nothing else
let launchFolders = foldersIn(process.argv) // handed to the page once

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// -- the core -------------------------------------------------------------------------------

function startCore(): void {
  core = utilityProcess.fork(join(__dirname, 'core.js'), [], {
    serviceName: 'RepoDeck Core',
    env: {
      ...process.env, ...dirsEnv(), PATH: loginPath() ?? process.env.PATH ?? '',
      REPODECK_APP_DIR: APP_DIR, REPODECK_VERSION: app.getVersion(), REPODECK_PACKAGED: app.isPackaged ? '1' : '',
    },
  })
  const proc = core
  let deliver: ((m: unknown) => void) | null = null
  proc.on('message', (m) => deliver?.(m))
  coreRpc = new Endpoint({ send: (m) => proc.postMessage(m), listen: (fn) => { deliver = fn } })
  coreRpc.handle({
    trash: async ({ path }: { path: string }) => shell.trashItem(path),
    chosen: ({ paths }: { paths: unknown }) => chosen.take(paths),
    // The user's word that every repository in a folder may join the deck: asked in a dialog of
    // main's own, which the page can bring up but not answer. Cancel is the default.
    confirmWatch: async ({ folder }: { folder: unknown }) => {
      if (!win || typeof folder !== 'string') return false
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Show', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Show new projects in “${basename(folder)}” automatically?`,
        detail: `Every repository in ${folder} joins the deck, now and whenever a new one appears there.`,
      })
      return response === 0
    },
    relaunch: async () => relaunch(),
    loginItem: async ({ on }: { on?: boolean }) => {
      if (on !== undefined) loginItem.set(on)
      return loginItem.get()
    },
  })
  coreRpc.on('announce', (data) => announce(data as Announcement))
  coreRpc.on('settings', (data) => {
    if ((data as UpdaterSettings).autoUpdate) void updater.download() // switched on with an update waiting
  })
  proc.on('exit', () => {
    coreRpc?.close('core stopped')
    if (quitting) return
    setTimeout(() => { // a crash: start again and reconnect the window
      startCore()
      connect()
    }, 1000)
  })
}

/** Give the window a fresh MessagePort to the core: only while it shows RepoDeck's own page. */
function connect(): void {
  if (!win || !core || !isAppPage(win.webContents.getURL(), PAGE_URL)) return
  const { port1, port2 } = new MessageChannelMain()
  core.postMessage({ type: 'attach' }, [port1])
  win.webContents.postMessage('core-port', null, [port2])
}

// -- feedback ---------------------------------------------------------------------------------

interface Announcement {
  message: string
  body?: string
  key?: string
  uri?: string
  notify: boolean
}

const notes = new Map<string, Notification>()

/** A toast while the window is focused; a desktop notification while it's in the background. */
function announce(a: Announcement): void {
  if (!win || win.isFocused() || !a.notify || !Notification.isSupported()) {
    win?.webContents.send('main-event', { name: 'toast', data: a.message })
    return
  }
  if (a.key) notes.get(a.key)?.close()
  const note = new Notification({ title: a.message, body: a.body ?? '', icon: ICON })
  note.on('click', () => {
    const link = webLink(a.uri)
    if (link) void shell.openExternal(link)
    else win?.show()
  })
  if (a.key) notes.set(a.key, note)
  note.show()
}

/** Start again: installed copies directly; a checkout through its launcher (which rebuilds) once this process is gone. */
function relaunch(folders: string[] = []): void {
  if (app.isPackaged) {
    app.relaunch({ args: [...process.argv.slice(1), ...folders] })
    app.quit()
    return
  }
  const launcher = join(APP_DIR, 'bin/repodeck')
  const script = 'while kill -0 "$0" 2>/dev/null; do sleep 0.1; done; exec "$@"'
  spawn('sh', ['-c', script, String(process.pid), launcher, ...folders], { cwd: app.getPath('home'), detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 100)
}

// -- the window -------------------------------------------------------------------------------

function createWindow(): void {
  const bounds = loadBounds()
  win = new BrowserWindow({
    ...bounds,
    minWidth: 400,
    minHeight: 420,
    show: false,
    title: 'RepoDeck',
    backgroundColor: '#17181b',
    icon: join(APP_DIR, 'data/repodeck.png'),
    // Our header is the title bar: traffic lights on macOS, window-control overlay elsewhere.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#17181b', symbolColor: '#d7d9de', height: 46 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  if (bounds.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())
  win.webContents.on('did-finish-load', connect)
  if (process.env.REPODECK_DEBUG) {
    win.webContents.on('console-message', (e) => console.log(`[renderer ${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`))
    win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer gone]', d.reason))
  }
  win.on('focus', () => void coreRpc?.call('windowFocused').catch(() => {}))
  win.on('close', () => win && saveBounds(win))
  win.on('closed', () => {
    win = null
  })
  // Nothing but our own page loads in the window; links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const link = webLink(url)
    if (link) void shell.openExternal(link)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  void win.loadURL(PAGE_URL) // the address trusted() goes by, in one spelling
}

// -- renderer -> main ------------------------------------------------------------------------

/** Only RepoDeck's own page, in the top frame of its window, may ask main for anything. */
function trusted(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = e.senderFrame
  return !!win && e.sender === win.webContents && !!frame && frame.parent === null && isAppPage(frame.url, PAGE_URL)
}

/**
 * A folder the page may have shown or opened: a repository in the deck, or (where named) RepoDeck's
 * settings folder. The path is looked up before the disk is asked anything, so a path the page made
 * up is never touched (on Windows, a look at a share on another machine would sign in to it).
 */
async function deckFolder(path: unknown, settings = false): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`Not a folder: ${String(path)}`)
  const known = (settings && path === configDir()) || (await coreRpc?.call<boolean>('inDeck', { path }, 5000)) === true
  if (!known) throw new Error(`Not in the deck: ${path}`)
  if (!isDir(path)) throw new Error(`Not a folder: ${path}`)
  return path
}

function hostHandlers(): void {
  const handle = (name: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(name, (e, ...args) => {
      if (!trusted(e)) throw new Error('Untrusted sender')
      return fn(...(args as never[]))
    })
  handle('host:openExternal', (url: unknown) => {
    const link = webLink(url)
    if (!link) throw new Error('Only web links can be opened')
    return shell.openExternal(link)
  })
  // The file manager shows folders only: a file handed to the system to open could be a program.
  handle('host:openPath', async (path: unknown) => {
    const given = await deckFolder(path, true)
    // macOS goes by the folder a link leads to, so that folder is the one judged and shown
    const folder = process.platform === 'darwin' ? realpathSync(given) : given
    if (folderView(folder) === 'open') return shell.openPath(folder)
    shell.showItemInFolder(folder)
    return ''
  })
  handle('host:openInEditor', async (path: unknown, file?: unknown) => {
    if (file !== undefined && typeof file !== 'string') throw new Error('Invalid file path')
    openInCode(await deckFolder(path), file)
  })
  handle('host:appInfo', async () => ({
    packaged: app.isPackaged, version: app.getVersion(), update: app.isPackaged ? updater.status : null,
    hour12: await systemHour12(app.getSystemLocale()),
  }))
  handle('host:update', async (action: UpdateAction) => {
    if (action === 'check') return updater.check(true)
    if (action === 'download') return updater.download()
    if (action !== 'restart') throw new Error('Unknown update action')
    if (updater.status.phase === 'ready') {
      quitting = true // the core is stopped here, so the quit that installs isn't held up
      await coreRpc?.call('shutdown', null, 1500).catch(() => {})
      updater.restart()
    }
    return updater.status
  })
  handle('host:chooseFolders', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Add repository or folder of repositories',
      properties: ['openDirectory', 'multiSelections'],
    })
    return result.canceled ? [] : chosen.note(result.filePaths)
  })
  handle('host:initialFolders', () => {
    const folders = chosen.note(launchFolders)
    launchFolders = []
    return folders
  })
  // From the preload, which saw the user drop these on the window; it waits for the answer, so they
  // count as chosen before the page can ask for them to be added.
  ipcMain.on('host:dropped', (e, paths: unknown) => {
    if (trusted(e) && Array.isArray(paths)) chosen.note(paths.filter((path): path is string => typeof path === 'string'))
    e.returnValue = null
  })
}

// -- lifecycle --------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock({ session: sessionEnv() })) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv, _cwd, data) => {
    const session = otherSession(sessionEnv(), data)
    if (session) {
      // Launched from another desktop session (a new remote-desktop login): reopen there.
      adoptSession(session)
      relaunch(foldersIn(argv))
      return
    }
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    const folders = chosen.note(foldersIn(argv))
    if (folders.length) win.webContents.send('main-event', { name: 'openFolders', data: folders })
  })

  app.whenReady().then(() => {
    // The page needs no camera, location, clipboard reading or any other permission: all are refused.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) => decide(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    setMenu()
    hostHandlers()
    startCore()
    createWindow()
    updater.start()
  })

  app.on('window-all-closed', () => app.quit())

  app.on('before-quit', (e) => {
    if (quitting || !coreRpc) return
    e.preventDefault()
    quitting = true
    const done = () => app.quit()
    void coreRpc.call('shutdown', null, 1500).then(done, done)
  })
}
