// The cache and the activity log hold commit, pull-request and repository details. They are files of
// RepoDeck's own, readable by the user only:
//
// - what is written replaces the file with a new one (private from its first byte), so a link, a
//   pipe, a second name for another file or a file somebody still holds open is left behind as it was;
// - a file is changed where it stands (a line added; or, in a folder that takes no new file,
//   rewritten) only when it is known to be such a file, through the handle it was checked on;
// - a file that stood open to other accounts and can't be replaced is closed to them, and from
//   then on only read or emptied: whoever had it open keeps it open, and learns nothing new from it.
//
// "Readable by the user only" is the file's mode, and so as good as the file system's word for it.
// Windows has no modes: there a file is as open as its folder, and RepoDeck's folders are in the
// user's profile, which Windows keeps to that account. A drive that keeps no modes (some network
// and removable ones) is as open as it was mounted; all RepoDeck could do there is keep no cache
// and no log, and it does not go that far.

import { randomUUID } from 'node:crypto'
import {
  closeSync, constants, fchmodSync, fstatSync, ftruncateSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { dirname, join } from 'node:path'

const PRIVATE = 0o600
const SHUT = 0o400 // closed to others where it stood; never added to again
// The file itself, never what a link there points at, and never waiting on a pipe put there.
const AS_ITSELF = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
// A missing file may be made by the append that needs it, where a link in its place is sure not to
// be followed to somewhere else. Elsewhere (Windows) it is made the other way, written aside and
// moved in, where the later of two first writes would win; one RepoDeck runs per profile (main
// holds the lock), so there is no second writer.
const OR_NEW = constants.O_NOFOLLOW ? constants.O_CREAT : 0
const MODES = process.platform !== 'win32' // no modes or owner ids to go by on Windows

/**
 * What an open handle says about the file at `path`, or null unless it is a file of RepoDeck's own: a
 * plain file under this one name, this user's (where that can be told), and the very file the path
 * names. The last check is what stops a link where O_NOFOLLOW is missing (Windows): there the handle
 * would be the file the link points at.
 */
function ownFile(fd: number, path: string): BigIntStats | null {
  const info = fstatSync(fd, { bigint: true })
  const at = lstatSync(path, { bigint: true })
  if (at.isSymbolicLink() || at.dev !== info.dev || at.ino !== info.ino) return null
  if (!info.isFile() || info.nlink !== 1n) return null
  if (MODES && info.uid !== BigInt(process.getuid?.() ?? -1)) return null
  return info
}
const modeOf = (info: BigIntStats): number => Number(info.mode & 0o777n)
const isPrivate = (info: BigIntStats): boolean => !MODES || modeOf(info) === PRIVATE
/** The folder takes no new file, or lets none be moved over the old one. (A full disk is not that: the old file is then left whole.) */
const refused = (e: unknown): boolean => ['EACCES', 'EPERM', 'EBUSY'].includes((e as NodeJS.ErrnoException)?.code ?? '')

/** Change the private file at `path` where it stands. False, with nothing changed, when what is there isn't one. */
function inPlace(path: string, flags: number, change: (fd: number) => void): boolean {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_WRONLY | flags | AS_ITSELF, PRIVATE)
    const info = ownFile(fd, path)
    if (!info || !isPrivate(info)) return false
    change(fd)
    return true
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Empty the file at `path` that was shut where it stood. It stays shut. False when what is there isn't one. */
function emptyShut(path: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | AS_ITSELF)
    const info = ownFile(fd, path)
    if (!MODES || !info || modeOf(info) !== SHUT) return false
    fchmodSync(fd, PRIVATE) // its owner may write to it for this moment, nobody else at any time
    try {
      return inPlace(path, 0, (writing) => ftruncateSync(writing, 0))
    } finally {
      fchmodSync(fd, SHUT)
    }
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Put `text` at `path` as a new private file, in one step. Whatever was there is replaced, not written
 * to. Only in a folder that takes no new file is RepoDeck's own private file there rewritten instead
 * (and one that was shut there emptied, when that is all that is asked).
 */
export function replacePrivate(path: string, text: string): void {
  // Written next to it under a name nobody could have put a link at. The name is short, so there is
  // room for it wherever there is room for the file's own.
  const tmp = join(dirname(path), `.repodeck-${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode: PRIVATE }) // "wx": always a new file
    renameSync(tmp, path) // atomic: a crash never leaves a half-written file
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {
      // never created, or already swapped in
    }
    const rewrite = (fd: number): void => {
      ftruncateSync(fd, 0)
      writeFileSync(fd, text)
    }
    if (!refused(e) || !(inPlace(path, 0, rewrite) || (text === '' && emptyShut(path)))) throw e
  }
}

/**
 * Append to the private file at `path`, which is made if there is none: whoever else adds to the same
 * file at that moment adds to this one too. False, with nothing written, when what is there isn't one.
 */
export function appendPrivate(path: string, text: string): boolean {
  return inPlace(path, constants.O_APPEND | OR_NEW, (fd) => writeFileSync(fd, text))
}

/** Remove the file at `path`. Where the folder won't let go of it, RepoDeck's own file is at least shut. */
export function removePrivate(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    let fd: number | undefined
    try {
      fd = openSync(path, constants.O_RDONLY | AS_ITSELF)
      if (ownFile(fd, path)) fchmodSync(fd, SHUT)
    } catch {
      // the usual case: nothing there
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
}

/**
 * The text of the file at `path`, or null when there is none of RepoDeck's own. One that an earlier
 * version left readable by every account is replaced by a private copy on the way: before it is
 * parsed (so a damaged one is covered too), and as a new file (so nobody who had it open reads on).
 * In a folder that takes no new file it is shut where it stands, until a new file can take its place.
 */
export function readPrivate(path: string): string | null {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | AS_ITSELF)
    const info = ownFile(fd, path)
    if (!info) return null
    const text = readFileSync(fd, 'utf8')
    if (!isPrivate(info)) {
      try {
        replacePrivate(path, text)
      } catch {
        try {
          fchmodSync(fd, SHUT)
        } catch {
          // not the kind of file system that has modes
        }
      }
    }
    return text
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
