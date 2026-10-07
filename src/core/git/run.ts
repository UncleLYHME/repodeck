// Thin wrapper around the git CLI. Everything is async: git runs as a child process.

import { spawn } from 'node:child_process'

export class GitError extends Error {}

export const ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0', // never hang waiting for credentials
  GIT_OPTIONAL_LOCKS: '0', // polling `status` must not fight VS Code for index.lock
  GIT_LITERAL_PATHSPECS: '1', // file names are paths, not globs
}
// Background fetches must fail rather than pop up a password, passphrase or host-key prompt.
// Credential helpers and a running ssh-agent still work.
export const QUIET_ENV = { GIT_ASKPASS: 'true', SSH_ASKPASS_REQUIRE: 'never' }
export const NETWORK_TIMEOUT = 120_000
export const SEP = '\x1f'

export interface RunOptions {
  check?: boolean // throw GitError on a non-zero exit (default true)
  timeout?: number // ms
  env?: Record<string, string>
  input?: string
}

export interface Result {
  code: number
  stdout: string
  stderr: string
}

/** Run any program with git's environment (used for git itself and for gh). */
export function exec(cmd: string, args: string[], cwd: string | undefined, opts: RunOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...ENV, ...(opts.env ?? {}) },
        stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      reject(e)
      return
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    if (opts.timeout) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      }, opts.timeout)
    }
    child.stdout!.on('data', (b: Buffer) => out.push(b))
    child.stderr!.on('data', (b: Buffer) => err.push(b))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (timedOut) {
        reject(new GitError(`${cmd} ${args.find((a) => !a.startsWith('-')) ?? ''} timed out`.trim()))
        return
      }
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    })
    if (opts.input !== undefined) {
      child.stdin!.on('error', () => {}) // git may exit before reading everything
      child.stdin!.end(opts.input)
    }
  })
}

export async function run(repo: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const r = await exec('git', ['-c', 'core.quotepath=off', '-C', repo, ...args], undefined, opts)
  if (opts.check !== false && r.code !== 0) {
    throw new GitError((r.stderr || r.stdout).trim() || `git ${args[0]} failed`)
  }
  return r.stdout
}

/** Split like Python's str.split(sep, n): at most n splits, the remainder stays in the last part. */
export function splitN(s: string, sep: string, n: number): string[] {
  const parts: string[] = []
  let rest = s
  while (parts.length < n) {
    const i = rest.indexOf(sep)
    if (i < 0) break
    parts.push(rest.slice(0, i))
    rest = rest.slice(i + sep.length)
  }
  parts.push(rest)
  return parts
}

/** The first line of an error, for one-line summaries. */
export function firstLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.trim().split('\n')[0] || (e instanceof Error ? e.name : 'error')
}
