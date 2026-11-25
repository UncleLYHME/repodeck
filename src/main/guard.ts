// What main checks before it acts for the page: which page is asking, and what may be handed to
// the system to open. Plain functions without Electron, so they are tested directly.

import { posix } from 'node:path'

function parsed(url: unknown): URL | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * What the path of a file: URL spells, byte for byte (one character each). Chromium and Node escape
 * different characters, so two spellings of one path differ only in which bytes are written as
 * "%XX". A "%" that starts no escape (a folder called "100% done", in a URL put together by hand)
 * stands for itself.
 */
const spelt = (path: string): string => path.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))

/**
 * True when `url` is the page at `page`, RepoDeck's own, whatever its query or fragment. An installed
 * copy loads one file, so any other file on the disk is a different page; in development the page
 * is whatever the dev server serves from its origin.
 */
export function isAppPage(url: unknown, page: string, platform: NodeJS.Platform = process.platform): boolean {
  const [at, app] = [parsed(url), parsed(page)]
  if (!at || !app || at.protocol !== app.protocol || at.host !== app.host) return false
  if (app.protocol !== 'file:') return true
  const [a, b] = [spelt(at.pathname), spelt(app.pathname)]
  if (platform !== 'win32') return a === b
  const plain = (s: string) => s.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
  return plain(a) === plain(b) // Windows: "c:" and "C:" are one drive
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
