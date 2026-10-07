/* Turn filesystem events (inotify through fs.watch) into throttled callbacks.

inotify is not recursive, so a repository watcher keeps one watch per non-ignored directory in
the working tree, plus the parts of .git that change on commit, checkout, staging and fetch.
fs.watch({recursive}) can't skip ignored folders (it would watch node_modules), so this walks
only what `git ls-files` reports.
*/

import { type FSWatcher, lstatSync, readdirSync, watch } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { run } from './git/run'

export const MAX_DIRS = 4000 // per repository
// macOS (FSEvents) and Windows watch a whole tree natively and cheaply; Linux (inotify) can't skip
// ignored folders that way, so there one watch per non-ignored folder is kept instead.
const NATIVE_TREE = process.platform === 'darwin' || process.platform === 'win32'
const NOISE = /(^|[\\/])(node_modules|\.git[\\/]objects)([\\/]|$)|\.lock$/
const GLOBAL_MAX = 30000 // the system limit (often 65536) is shared with editors and other tools
let watching = 0

/** Run `fn` once, `delayMs` after the first of a burst of calls. */
export class Throttle {
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private delayMs: number, private fn: () => void) {}

  call = (): void => {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.fn()
    }, this.delayMs)
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

export type WatchEvent = 'appeared' | 'gone' | 'changed'

function kindOf(path: string): { exists: boolean; dir: boolean } {
  try {
    const s = lstatSync(path)
    return { exists: true, dir: s.isDirectory() }
  } catch {
    return { exists: false, dir: false }
  }
}

/** A set of non-recursive directory watches reporting (path, appeared|gone|changed). */
export class DirWatcher {
  watchers = new Map<string, FSWatcher>()
  constructor(private onEvent: (path: string, kind: WatchEvent) => void) {}

  add(path: string): void {
    if (this.watchers.has(path) || this.watchers.size >= MAX_DIRS || watching >= GLOBAL_MAX) return
    let w: FSWatcher
    try {
      w = watch(path, { persistent: true }, (type, name) => {
        const full = name ? join(path, name.toString()) : path
        if (type === 'change') this.onEvent(full, 'changed')
        else this.onEvent(full, kindOf(full).exists ? 'appeared' : 'gone')
      })
    } catch {
      return // vanished, unreadable, or out of inotify watches
    }
    w.on('error', () => this.remove(path))
    this.watchers.set(path, w)
    watching += 1
  }

  remove(path: string): void {
    const w = this.watchers.get(path)
    if (!w) return
    this.watchers.delete(path)
    watching -= 1
    try {
      w.close()
    } catch {
      // already gone
    }
  }

  sync(paths: string[]): void {
    const want = new Set(paths)
    for (const p of [...this.watchers.keys()]) if (!want.has(p)) this.remove(p)
    for (const p of paths) this.add(p)
  }

  close(): void {
    for (const p of [...this.watchers.keys()]) this.remove(p)
  }
}

function walk(dir: string, out: string[]): void {
  out.push(dir)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) if (e.isDirectory()) walk(join(dir, e.name), out)
}

/** Directories worth watching: .git state plus every non-ignored working-tree directory. */
export async function repoDirs(repo: string): Promise<string[]> {
  const [gitDir, common, tracked, empties] = await Promise.all([
    run(repo, ['rev-parse', '--absolute-git-dir']),
    run(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    run(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    // --directory also reports new, still-empty folders ("dir/") so files created in them are seen.
    run(repo, ['ls-files', '-z', '--others', '--exclude-standard', '--directory']),
  ])
  const g = gitDir.trim()
  const c = common.trim()
  const meta = [g, join(g, 'logs'), c]
  walk(join(c, 'refs'), meta)
  const tree = new Set([repo])
  for (const f of [...tracked.split('\0'), ...empties.split('\0')]) {
    if (!f) continue
    let parent = f.endsWith('/') ? f.replace(/\/+$/, '') : dirname(f)
    while (parent && parent !== '.') {
      const full = join(repo, parent)
      if (tree.has(full)) break
      tree.add(full)
      parent = dirname(parent)
    }
  }
  const dirs = [...tree].sort((a, b) => a.length - b.length) // shallow directories first
  return [...new Set([...meta, ...dirs])]
}

/** Calls `onChange` shortly after anything git would notice changes in a repository. */
export class RepoWatcher {
  private change: Throttle
  private rescan: Throttle
  private dirs: DirWatcher
  private tree: FSWatcher | null = null
  private closed = false

  constructor(readonly repo: string, onChange: () => void) {
    this.change = new Throttle(150, onChange)
    this.rescan = new Throttle(400, () => void this.scan()) // new folders need new watches
    this.dirs = new DirWatcher((path, kind) => this.event(path, kind))
    if (NATIVE_TREE) {
      try {
        this.tree = watch(repo, { recursive: true }, (_type, name) => {
          if (!NOISE.test(name?.toString() ?? '')) this.change.call()
        })
        this.tree.on('error', () => {})
      } catch {
        this.tree = null
      }
    }
    if (this.tree) this.change.call()
    else void this.scan()
  }

  get count(): number {
    return this.tree ? 1 : this.dirs.watchers.size
  }

  private async scan(): Promise<void> {
    let paths: string[]
    try {
      paths = await repoDirs(this.repo)
    } catch {
      return
    }
    if (this.closed) return
    this.dirs.sync(paths)
    this.change.call() // catch anything written while watches were being set up
  }

  private event(path: string, kind: WatchEvent): void {
    if (path.endsWith('.lock')) return // git's temporary files; the rename that follows is the real change
    if (kind === 'appeared' && kindOf(path).dir) this.rescan.call()
    else if (kind === 'gone') this.dirs.remove(path)
    this.change.call()
  }

  close(): void {
    this.closed = true
    this.change.cancel()
    this.rescan.cancel()
    this.dirs.close()
    this.tree?.close()
  }
}

/** Calls `onChange` when projects appear in, or vanish from, a folder of repositories. */
export class FolderWatcher {
  private change: Throttle
  private dirs: DirWatcher

  constructor(readonly folder: string, onChange: () => void) {
    this.change = new Throttle(400, onChange)
    this.dirs = new DirWatcher((path, kind) => this.event(path, kind))
    this.dirs.add(folder)
    let children: string[] = []
    try {
      children = readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(folder, e.name))
    } catch {
      // unreadable folder
    }
    for (const child of children) this.dirs.add(child) // to notice `git init` or a clone finishing inside a new project
  }

  private event(path: string, kind: WatchEvent): void {
    if (dirname(path) === this.folder) {
      if (kind === 'appeared' && kindOf(path).dir) this.dirs.add(path)
      else if (kind === 'gone') this.dirs.remove(path)
      this.change.call()
    } else if (basename(path) === '.git') {
      this.change.call()
    }
  }

  close(): void {
    this.change.cancel()
    this.dirs.close()
  }
}
