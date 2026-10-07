// Which processes listen on TCP ports, and where they run. Linux: `ss` plus /proc/<pid>/cwd;
// macOS: `lsof`. Windows doesn't expose a process's working folder, so it reports none.

import { readFile, readlink } from 'node:fs/promises'
import { exec } from '../git/run'

export interface Listener {
  port: number
  name: string
  pid: number
  cwd: string
}

const SS_LINE = /^\S+\s+\d+\s+\d+\s+(?<addr>\S+):(?<port>\d+)\s+\S+.*?users:\(\((?<users>.*)\)\)/
const SS_USER = /"(?<name>[^"]+)",pid=(?<pid>\d+)/

/** `ss -ltnpH` lines -> [port, process name, pid], one entry per port. */
export function parseSs(text: string): [number, string, number][] {
  const seen = new Set<number>()
  const out: [number, string, number][] = []
  for (const line of text.split('\n')) {
    const m = SS_LINE.exec(line.trim())
    if (!m?.groups) continue
    const port = Number(m.groups.port)
    const user = SS_USER.exec(m.groups.users)
    if (user?.groups && !seen.has(port)) {
      seen.add(port)
      out.push([port, user.groups.name, Number(user.groups.pid)])
    }
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** `lsof -nP -iTCP -sTCP:LISTEN -F pcn` -> [port, command, pid], one entry per port. */
export function parseLsof(text: string): [number, string, number][] {
  const out: [number, string, number][] = []
  const seen = new Set<number>()
  let pid = 0
  let name = ''
  for (const line of text.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'c') name = line.slice(1)
    else if (line[0] === 'n') {
      const port = Number(/:(\d+)$/.exec(line)?.[1])
      if (port && !seen.has(port)) {
        seen.add(port)
        out.push([port, name, pid])
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0])
}

async function macListeners(): Promise<Listener[]> {
  let text = ''
  try {
    text = (await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], undefined, { timeout: 5000 })).stdout
  } catch {
    return []
  }
  return Promise.all(parseLsof(text).map(async ([port, name, pid]) => {
    let cwd = ''
    try {
      const r = await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F', 'n'], undefined, { timeout: 3000 })
      cwd = r.stdout.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? ''
    } catch {
      // gone, or another user's
    }
    return { port, name, pid, cwd }
  }))
}

export async function listeners(): Promise<Listener[]> {
  if (process.platform === 'darwin') return macListeners()
  if (process.platform !== 'linux') return []
  let text = ''
  try {
    text = (await exec('ss', ['-ltnpH'], undefined, { timeout: 5000 })).stdout
  } catch {
    return []
  }
  return Promise.all(parseSs(text).map(async ([port, ssName, pid]) => {
    let name = ssName
    let cwd = ''
    try {
      cwd = await readlink(`/proc/${pid}/cwd`)
      // ss shows the thread name ("MainThread" for Node); the program is more telling.
      const argv0 = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')[0]
      if (argv0) name = argv0.split('/').pop()!
    } catch {
      // another user's process, or gone
    }
    return { port, name, pid, cwd }
  }))
}
