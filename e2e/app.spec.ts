import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { type Fixture, git, launch, makeFixture } from './fixture'

test.describe.configure({ mode: 'serial' })

let f: Fixture
let app: ElectronApplication
let win: Page

const panel = (name: string): Locator => win.getByRole('article', { name })
const changeRow = (repo: string, file: string): Locator =>
  panel(repo).getByRole('listitem').filter({ has: win.getByRole('checkbox', { name: `Commit ${file}` }) })

test.beforeAll(async () => {
  f = makeFixture()
  ;({ app, win } = await launch(f))
})

test.afterAll(async () => {
  await app?.close()
})

test('Home shows the deck at a glance', async () => {
  await expect(win.getByRole('heading', { name: "What's happening across your projects?" })).toBeVisible()
  await expect(win.getByText('2 projects · all committed')).toBeVisible()
  await expect(win.getByRole('region', { name: 'Git activity' }).getByText('commits · 14 days')).toBeVisible()
  await expect(win.getByRole('button', { name: 'alpha, clean' })).toBeVisible()
})

test('a file saved in a terminal appears without refreshing', async () => {
  await win.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(panel('alpha')).toBeVisible()
  writeFileSync(join(f.alpha, 'fresh.txt'), 'hello\n')
  await expect(changeRow('alpha', 'fresh.txt')).toBeVisible({ timeout: 4000 })
  await expect(win.getByRole('button', { name: 'alpha, 1 uncommitted changes' })).toBeVisible()
})

test('commits only the checked files', async () => {
  writeFileSync(join(f.alpha, 'keep.txt'), 'not yet\n')
  await expect(changeRow('alpha', 'keep.txt')).toBeVisible()
  await changeRow('alpha', 'keep.txt').getByRole('checkbox').uncheck()
  await panel('alpha').getByRole('textbox', { name: 'Commit message' }).fill('add fresh file')
  await panel('alpha').getByRole('button', { name: 'Commit 1' }).click()
  await expect(win.getByText('alpha: Committed 1 file')).toBeVisible()
  expect(git(f.alpha, 'show', '--name-only', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['add fresh file', '', 'fresh.txt'])
  await expect(changeRow('alpha', 'keep.txt')).toBeVisible()
  await expect(changeRow('alpha', 'fresh.txt')).toHaveCount(0)
})

test('stages one hunk from the hunk view', async () => {
  const lines = readFileSync(join(f.alpha, 'app.ts'), 'utf8').split('\n')
  lines[1] = 'export const line2 = "top"'
  lines[27] = 'export const line28 = "bottom"'
  writeFileSync(join(f.alpha, 'app.ts'), lines.join('\n'))
  await expect(changeRow('alpha', 'app.ts')).toBeVisible()
  await changeRow('alpha', 'app.ts').click()
  const sheet = win.getByRole('dialog', { name: 'app.ts' })
  await expect(sheet.getByText('Unstaged · 2', { exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Stage' }).first().click()
  await expect(sheet.getByText('Staged · 1', { exact: true })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(changeRow('alpha', 'app.ts').getByText('partial')).toBeVisible()
})

test('compares a new file side by side', async () => {
  await changeRow('alpha', 'keep.txt').click()
  const sheet = win.getByRole('dialog', { name: 'keep.txt' })
  await expect(sheet.getByText('1 change · +1 −0')).toBeVisible()
  await expect(sheet.locator('.cm-mergeView')).toBeVisible()
  await sheet.getByRole('button', { name: 'Unified' }).click()
  await expect(sheet.locator('.cm-mergeView')).toHaveCount(0)
  await expect(sheet.locator('.cm-editor')).toBeVisible()
  await sheet.getByRole('button', { name: 'Side by Side' }).click()
  await win.keyboard.press('Escape')
})

test('discards a new file into the Trash', async () => {
  await changeRow('alpha', 'keep.txt').getByRole('button', { name: 'Discard changes to keep.txt' }).click()
  await win.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click()
  await expect(changeRow('alpha', 'keep.txt')).toHaveCount(0)
  expect(existsSync(join(f.alpha, 'keep.txt'))).toBe(false)
})

test('right-click ignores every file with that extension', async () => {
  writeFileSync(join(f.alpha, 'debug.log'), 'noise\n')
  await expect(changeRow('alpha', 'debug.log')).toBeVisible()
  await changeRow('alpha', 'debug.log').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Ignore All .log Files' }).click()
  await expect(win.getByText('alpha: Ignored *.log')).toBeVisible()
  await expect(changeRow('alpha', 'debug.log')).toHaveCount(0)
  await expect(changeRow('alpha', '.gitignore')).toBeVisible()
  expect(readFileSync(join(f.alpha, '.gitignore'), 'utf8')).toBe('*.log\n')
})

test('creates and switches branches from the branch pill', async () => {
  await panel('beta').getByRole('button', { name: /^Branch main/ }).click()
  await win.getByRole('textbox', { name: 'Find or create a branch' }).fill('feature/e2e')
  await win.getByRole('button', { name: 'Create branch “feature/e2e” from here' }).click()
  await expect(win.getByText('beta: Created feature/e2e')).toBeVisible()
  await expect(panel('beta').getByRole('button', { name: /^Branch feature\/e2e/ })).toBeVisible()
  expect(git(f.beta, 'branch', '--show-current').trim()).toBe('feature/e2e')
  await panel('beta').getByRole('button', { name: /^Branch feature\/e2e/ }).click()
  await win.getByRole('button', { name: 'main', exact: true }).click()
  await expect(panel('beta').getByRole('button', { name: /^Branch main/ })).toBeVisible()
})

test('history expands a commit into its files and searches', async () => {
  const history = panel('beta').getByRole('region', { name: 'History' })
  await history.getByRole('button', { name: /add notes/ }).click()
  await expect(history.getByRole('listitem').filter({ hasText: 'notes.md' })).toBeVisible()
  await history.getByRole('button', { name: 'Search history' }).click()
  await history.getByRole('textbox', { name: 'Search history' }).fill('first')
  await expect(history.getByRole('button', { name: /first commit/ })).toBeVisible()
  await expect(history.getByRole('button', { name: /add notes/ })).toHaveCount(0)
})

test('the activity log records what happened', async () => {
  await win.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(win.getByText('Committed 1 file').first()).toBeVisible()
  await expect(win.getByText('Created feature/e2e').first()).toBeVisible()
})

test('the project page shows analytics', async () => {
  await win.getByRole('button', { name: /^alpha,/ }).click()
  await expect(win.getByRole('region', { name: 'All time' }).getByText('3', { exact: true })).toBeVisible()
  await expect(win.getByRole('region', { name: 'Languages' }).getByText('TypeScript')).toBeVisible()
})

test("the project page's branch pill shows another branch's stats without checking it out", async () => {
  const current = git(f.alpha, 'branch', '--show-current').trim()
  git(f.alpha, 'branch', 'older', 'HEAD~1')
  const allTime = win.getByRole('region', { name: 'All time' })
  await win.getByRole('button', { name: /^Stats for branch / }).click()
  await win.getByRole('button', { name: 'older', exact: true }).click()
  await expect(allTime.getByText('2', { exact: true })).toBeVisible()
  await expect(win.getByText('not checked out')).toBeVisible()
  expect(git(f.alpha, 'branch', '--show-current').trim()).toBe(current)
  await win.getByRole('button', { name: `Back to ${current}` }).click()
  await expect(allTime.getByText('3', { exact: true })).toBeVisible()
})

test('the refresh button spins until the refresh is done', async () => {
  const button = win.getByRole('button', { name: 'Refresh all' })
  const icon = button.locator('svg')
  await button.click()
  await expect(icon).toHaveClass(/spin-soft/)
  await expect(button).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 })
  await expect(icon).not.toHaveClass(/spin-soft/, { timeout: 3000 }) // finishes its turn, then stops
})

test('with reduced motion the refresh icon stays still', async () => {
  await win.emulateMedia({ reducedMotion: 'reduce' })
  const button = win.getByRole('button', { name: 'Refresh all' })
  await button.click()
  expect(await button.locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  await expect(button).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 })
  await expect(button.locator('svg')).not.toHaveClass(/spin-soft/)
  await win.emulateMedia({ reducedMotion: 'no-preference' })
})

test('preferences save to repos.json and survive a restart', async () => {
  await win.keyboard.press('Control+,')
  await win.getByRole('switch', { name: 'Animated Banner' }).click()
  await win.keyboard.press('Escape')
  const file = join(f.env.XDG_CONFIG_HOME, 'repodeck', 'repos.json')
  await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).banner_motion).toBe(false)
  await app.close()
  ;({ app, win } = await launch(f))
  await expect(win.getByRole('heading', { name: "What's happening across your projects?" })).toBeVisible() // loaded
  await win.keyboard.press('Control+,')
  await expect(win.getByRole('switch', { name: 'Animated Banner' })).not.toBeChecked()
})
