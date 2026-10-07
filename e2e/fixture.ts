// A throwaway home for the app: its own settings, cache, state and git config, with two repos.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface Fixture {
  root: string
  work: string
  alpha: string
  beta: string
  env: Record<string, string>
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, ...gitEnv } })
}

let gitEnv: Record<string, string> = {}

export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'repodeck-e2e-'))
  const gitconfig = join(root, 'gitconfig')
  writeFileSync(gitconfig, '[user]\n  name = E2E\n  email = e2e@example.com\n[init]\n  defaultBranch = main\n')
  gitEnv = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' }
  const work = join(root, 'work')
  const alpha = join(work, 'alpha')
  const beta = join(work, 'beta')
  for (const repo of [alpha, beta]) {
    mkdirSync(repo, { recursive: true })
    git(repo, 'init', '-q')
    writeFileSync(join(repo, 'README.md'), `# ${repo.split('/').pop()}\n`)
    writeFileSync(join(repo, 'app.ts'), Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1}\n`).join(''))
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'first commit')
    writeFileSync(join(repo, 'notes.md'), 'notes\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'add notes')
  }
  const config = join(root, 'config')
  mkdirSync(join(config, 'repodeck'), { recursive: true })
  writeFileSync(join(config, 'repodeck', 'repos.json'), JSON.stringify({
    auto_fetch: false, auto_pull: false, notify: false, update_checks: false, banner_motion: true,
    groups: [{ folder: work, expanded: true, watch: true, hidden: [], auto_pull: true, repos: [alpha, beta] }],
  }))
  return {
    root, work, alpha, beta,
    env: { XDG_CONFIG_HOME: config, XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), XDG_DATA_HOME: join(root, 'data'), ...gitEnv },
  }
}

export async function launch(f: Fixture): Promise<{ app: ElectronApplication; win: Page }> {
  const env = { ...process.env, ...f.env } as Record<string, string>
  delete env.REPODECK_PROFILE
  const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: process.cwd(), env })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000))
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}
