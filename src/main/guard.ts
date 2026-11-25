// What main checks before it acts for the page: which page is asking, and what may be handed to
// the system to open. Plain functions without Electron, so they are tested directly.

import nodePath, { posix, type PlatformPath } from 'node:path'

function parsed(url: unknown): URL | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * RepoDeck's page has an address of its own. Loaded from a file, every file on the disk would be the
 * page's neighbour: a script lying in a repository as much "its own" as the app's. At this address
 * the page reaches the built page's folder and nothing else.
 */
export const APP_SCHEME = 'repodeck'
export const APP_PAGE = `${APP_SCHEME}://app/index.html`

/**
 * True when `url` is at the address RepoDeck's page is served from (`page`): its own scheme and host,
 * or the dev server's in development. A page loaded from a file is never it.
 */
export function isAppPage(url: unknown, page: string): boolean {
  const [at, app] = [parsed(url), parsed(page)]
  return !!at && !!app && app.protocol !== 'file:' && at.protocol === app.protocol && at.host === app.host
}

/**
 * The file in `root` (the built page's folder) that a request to the page's address asks for, or
 * null when it asks for anything else: another host, or a path that leads out of the folder.
 */
export function pageFile(url: unknown, root: string, path: PlatformPath = nodePath): string | null {
  const at = parsed(url)
  if (!at || at.protocol !== `${APP_SCHEME}:` || at.host !== 'app') return null
  let name: string
  try {
    name = decodeURIComponent(at.pathname)
  } catch {
    return null
  }
  if (/[\\\0]/.test(name)) return null // no other way to write a separator, no cut-off name
  const file = path.join(root, name)
  const within = path.relative(root, file)
  const outside = within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)
  return within && !outside ? file : null
}

/** The link in its normal form when it is a web link (http or https), the only kind handed to the system; otherwise null. */
export function webLink(url: unknown): string | null {
  const link = parsed(url)
  return link && (link.protocol === 'http:' || link.protocol === 'https:') ? link.href : null
}

/**
 * How a folder is shown in the file manager. macOS runs a folder that is named like a bundle
 * ("Tool.app") instead of opening it, so a folder with an extension is revealed in its parent there.
 */
export function folderView(path: string, platform: NodeJS.Platform = process.platform): 'open' | 'reveal' {
  if (platform !== 'darwin') return 'open'
  return posix.extname(posix.basename(path)) === '' ? 'open' : 'reveal' // ".config" has no extension
}
