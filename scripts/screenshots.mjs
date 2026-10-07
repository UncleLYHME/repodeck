// README screenshots from a made-up deck: `pnpm build && xvfb-run -a node scripts/screenshots.mjs`.
// Builds throwaway repos with a few weeks of history from several people, then photographs the app.

import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

// Panels show repo paths, so the deck lives somewhere readable.
const root = join(tmpdir(), 'code')
if (existsSync(root)) throw new Error(`${root} exists; move it out of the way first`)
const scratch = mkdtempSync(join(tmpdir(), 'repodeck-shots-'))
const out = new URL('../docs/screenshots/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const gitconfig = join(scratch, 'gitconfig')
writeFileSync(gitconfig, '[user]\n  name = Riley Chen\n  email = riley@example.com\n[init]\n  defaultBranch = main\n')
const env = { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' }
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' })

const PEOPLE = [['Riley Chen', 'riley@example.com'], ['Sam Rivera', 'sam@example.org'], ['Alex Kim', 'alex@example.net']]
const SUBJECTS = ['feat: add search to the dashboard', 'fix: keep scroll position on refresh', 'refactor: split the API client',
  'feat: dark mode for settings', 'docs: explain the release flow', 'fix: handle empty states', 'perf: cache avatars',
  'feat: keyboard shortcuts', 'chore: update dependencies', 'test: cover the sync worker', 'feat: export to CSV',
  'fix: timezone in reports', 'style: tidy the header', 'feat: onboarding checklist']
let seed = 7
const rand = (n) => (seed = (seed * 16807) % 2147483647) % n

const LINES = {
  tsx: (n, i) => `export function ${n}() {\n  const [items, setItems] = useState([])\n  useEffect(() => load().then(setItems), [])\n  return <List items={items} revision={${i}} />\n}\n`,
  ts: (n, i) => `export async function ${n}(id: string) {\n  const res = await fetch(\`/api/${n}/\${id}?v=${i}\`)\n  return res.json()\n}\n`,
  rs: (n, i) => `pub fn ${n}(config: &Config) -> Result<()> {\n    let retries = ${i % 7 + 1};\n    sync(config, retries)\n}\n`,
  md: (n, i) => `## ${n}\n\nStep ${i}: run the command, then check the output.\n`,
  other: (n, i) => `${n} = ${i}\n`,
}
const kind = (file) => (/\.tsx$/.test(file) ? 'tsx' : /\.ts$/.test(file) ? 'ts' : /\.rs$/.test(file) ? 'rs' : /\.md$/.test(file) ? 'md' : 'other')
const NAMES = ['loadReports', 'syncUsers', 'renderChart', 'fetchTeams', 'saveDraft', 'exportCsv', 'searchIndex', 'refreshToken']

function project(folder, name, files, commits) {
  const repo = join(root, folder, name)
  const origin = join(scratch, 'origins', `${name}.git`)
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  execFileSync('git', ['init', '-q', '--bare', origin], { env })
  git(repo, 'remote', 'add', 'origin', origin)
  for (let i = commits; i >= 0; i--) {
    const [author, email] = PEOPLE[rand(PEOPLE.length)]
    const file = files[rand(files.length)]
    const path = join(repo, file)
    mkdirSync(join(path, '..'), { recursive: true })
    const before = existsSync(path) ? readFileSync(path, 'utf8') : `// ${name}: ${file}\n`
    writeFileSync(path, before + '\n' + LINES[kind(file)](NAMES[rand(NAMES.length)], commits - i))
    git(repo, 'add', '-A')
    const when = `@${Math.floor(Date.now() / 1000 - i * 86400 * (0.4 + rand(10) / 10) - rand(36000))} +0000`
    execFileSync('git', ['-C', repo, 'commit', '-qm', SUBJECTS[rand(SUBJECTS.length)]],
      { env: { ...env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
  }
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  return repo
}

/** Commits someone else pushed (the repo is behind by `n` after a fetch). */
function theirCommits(repo, n) {
  const other = join(scratch, `other-${n}-${rand(9999)}`)
  execFileSync('git', ['clone', '-q', git(repo, 'remote', 'get-url', 'origin').trim(), other], { env })
  for (let i = 0; i < n; i++) {
    writeFileSync(join(other, 'README.md'), readFileSync(join(other, 'README.md'), 'utf8') + `\nNote ${i}\n`)
    git(other, 'commit', '-qam', ['docs: clarify setup', 'fix: flaky upload test'][i % 2])
  }
  git(other, 'push', '-q')
  git(repo, 'fetch', '-q')
}

const web = ['src/App.tsx', 'src/components/Header.tsx', 'src/pages/Dashboard.tsx', 'src/lib/api.ts', 'README.md']
const api = ['src/server.ts', 'src/routes/users.ts', 'src/routes/reports.ts', 'README.md']
const cli = ['src/main.rs', 'src/config.rs', 'src/sync.rs', 'README.md']
const repos = {
  aurora: project('Work', 'aurora-web', web, 40),
  orbit: project('Work', 'orbit-api', api, 28),
  nebula: project('Side projects', 'nebula-cli', cli, 22),
  forge: project('Side projects', 'pixel-forge', web, 16),
  docs: project('Side projects', 'starlight-docs', ['docs/index.md', 'docs/guide.md', 'docs/api.md', 'README.md'], 12),
}
// a little life: a feature branch with unpushed work, new remote commits, edits in progress, a dev server
git(repos.aurora, 'checkout', '-qb', 'feature/search')
git(repos.aurora, 'push', '-q', '-u', 'origin', 'feature/search')
writeFileSync(join(repos.aurora, 'src/components/Search.tsx'), 'export function Search({ onQuery }) {\n  return <input placeholder="Search…" onChange={(e) => onQuery(e.target.value)} />\n}\n')
git(repos.aurora, 'add', '-A')
git(repos.aurora, 'commit', '-qm', 'feat: search box on the dashboard')
const dash = join(repos.aurora, 'src/pages/Dashboard.tsx')
writeFileSync(dash, readFileSync(dash, 'utf8').replace('useState([])', 'useState<Report[]>([])').replace(/revision=\{(\d+)\} \/>/, 'revision={$1} filter={query} />'))
writeFileSync(join(repos.aurora, 'src/pages/Search.test.tsx'), "it('filters reports', () => {\n  expect(filter(['a', 'b'], 'a')).toEqual(['a'])\n})\n")
theirCommits(repos.orbit, 2)
const reports = join(repos.orbit, 'src/routes/reports.ts')
writeFileSync(reports, readFileSync(reports, 'utf8').replace(/v=(\d+)/, 'v=$1&format=csv'))
writeFileSync(join(repos.forge, 'src/App.tsx'), readFileSync(join(repos.forge, 'src/App.tsx'), 'utf8') + '\nexport const theme = "dusk"\n')
const server = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => r.end('ok')).listen(5173)"], { cwd: repos.aurora })

// GitHub cards: a stand-in `gh` with canned data, and remotes that look like GitHub ones.
for (const [key, repo] of Object.entries(repos)) git(repo, 'remote', 'set-url', 'origin', `https://github.com/acme/${repo.split('/').pop()}.git`)
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z')
const pr = (repo, number, title, draft = false) => ({ repository: { nameWithOwner: `acme/${repo}` }, number, title, url: `https://github.com/acme/${repo}/pull/${number}`, isDraft: draft, updatedAt: ago(2) })
const canned = {
  review: [pr('orbit-api', 214, 'Paginate the reports endpoint'), pr('aurora-web', 88, 'Keyboard shortcuts for the dashboard')],
  mine: [pr('aurora-web', 91, 'Search box on the dashboard'), pr('nebula-cli', 12, 'Retry syncs with backoff', true)],
  runs: [{ workflowName: 'CI', headBranch: 'main', conclusion: 'failure', status: 'completed', url: 'https://github.com/acme/orbit-api/actions/runs/1', createdAt: ago(3), displayTitle: 'fix: flaky upload test' },
    { workflowName: 'Deploy', headBranch: 'main', conclusion: 'success', status: 'completed', url: 'https://github.com/acme/orbit-api/actions/runs/2', createdAt: ago(20), displayTitle: 'chore: update dependencies' }],
}
const bin = join(scratch, 'bin')
mkdirSync(bin)
writeFileSync(join(scratch, 'gh.json'), JSON.stringify(canned))
writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const data = require(${JSON.stringify(join(scratch, 'gh.json'))})
const args = process.argv.slice(2).join(' ')
const out = args.startsWith('search prs') ? (args.includes('review-requested') ? data.review : data.mine)
  : args.startsWith('run list') ? (args.includes('orbit-api') ? data.runs : [])
  : args.startsWith('pr list') ? data.mine.filter((p) => args.includes(p.repository.nameWithOwner)).map((p) => ({ ...p, author: { login: 'riley' }, headRefName: 'feature/search' }))
  : []
process.stdout.write(JSON.stringify(out))
`, { mode: 0o755 })

const config = join(scratch, 'config')
mkdirSync(join(config, 'repodeck'), { recursive: true })
writeFileSync(join(config, 'repodeck', 'repos.json'), JSON.stringify({
  auto_fetch: false, auto_pull: false, notify: false, update_checks: false,
  pinned: [repos.aurora],
  groups: ['Work', 'Side projects'].map((f) => ({ folder: join(root, f), expanded: true, watch: true, hidden: [], auto_pull: true, repos: [] })),
}))

const app = await electron.launch({
  args: ['.', '--no-sandbox'],
  env: { ...env, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: join(scratch, 'cache'), XDG_STATE_HOME: join(scratch, 'state'), PATH: `${bin}:${process.env.PATH}`, REPODECK_PROFILE: '' },
})
const win = await app.firstWindow()
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
await win.waitForTimeout(5000)
const shot = (name) => win.screenshot({ path: join(out, `${name}.png`) })
await shot('home')
await win.getByRole('button', { name: 'Projects', exact: true }).click()
await win.waitForTimeout(2500)
await shot('projects')
await win.getByRole('button', { name: /^aurora-web,/ }).click()
await win.waitForTimeout(2500)
await shot('analytics')
await win.getByRole('button', { name: 'Open Panel' }).click()
await win.waitForTimeout(1500)
await win.getByRole('article', { name: 'aurora-web' }).getByRole('listitem').filter({ hasText: 'Dashboard.tsx' }).click()
await win.waitForTimeout(800)
await win.getByRole('dialog').getByRole('button', { name: 'Side by Side' }).click()
await win.waitForTimeout(1500)
await shot('compare')
await app.close()
server.kill()
execFileSync('gio', ['trash', root, scratch])
console.log(`screenshots in ${out}`)
