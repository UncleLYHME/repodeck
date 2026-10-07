// Which processes listen on TCP ports, and where they run. Linux: `ss` plus /proc/<pid>/cwd.
// Other platforms report nothing until they get their own implementation.

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

export async function listeners(): Promise<Listener[]> {
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
