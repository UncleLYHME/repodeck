import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { CSP } from '../src/shared/csp'
import { type Fixture, git, launch, makeFixture } from './fixture'

test.describe.configure({ mode: 'serial' })

let f: Fixture
let app: ElectronApplication
let win: Page

const panel = (name: string): Locator => win.getByRole('article', { name })
const changeRow = (repo: string, file: string): Locator =>
  panel(repo).getByRole('listitem').filter({ has: win.getByRole('checkbox', { name: `Commit ${file}` }) })

// What the page's content security policy refused, as the browser reports it on the console.
const refusedByPolicy: string[] = []

test.beforeAll(async () => {
  f = makeFixture()
  ;({ app, win } = await launch(f))
  win.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) refusedByPolicy.push(message.text())
  })
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

test('the Clock preference switches times between 12- and 24-hour', async () => {
  const times = win.locator('main li .meta.whitespace-nowrap')
  await win.keyboard.press('Control+,')
  const clock = async (label: string) => {
    await win.getByRole('combobox', { name: 'Clock' }).click()
    await win.getByRole('option', { name: label }).click()
  }
  await clock('24-hour')
  await expect(times.first()).toHaveText(/^\d{2}:\d{2}$/)
  await clock('12-hour')
  await expect(times.first()).toHaveText(/^\d{1,2}:\d{2}\s?[AP]M$/i)
  await clock('System')
  await win.keyboard.press('Escape')
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

test('the page runs under a content security policy that its own code never trips', async () => {
  const policy = () => win.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))
  expect(await policy()).toBe(CSP)
  // Everything shown so far (the deck, the compare and hunk views, history, analytics, preferences)
  // loaded its scripts, styles and images within the policy. So does the page itself, loaded anew
  // here so that it is watched from its first line.
  await win.reload()
  await expect(win.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
  expect(await policy()).toBe(CSP)
  expect(refusedByPolicy).toEqual([])

  // What a page gone wrong would reach for is refused: script that isn't one of its own files, and the network.
  const tried = await win.evaluate(async () => {
    const refused: string[] = []
    document.addEventListener('securitypolicyviolation', (e) => refused.push(e.effectiveDirective))
    // The debugger that runs this for the test lets it evaluate strings while it starts. After the
    // first pause it is judged like the page's own code.
    await new Promise((done) => setTimeout(done))
    const script = document.createElement('script')
    script.textContent = 'globalThis.inlineRan = true'
    document.head.append(script)
    script.remove()
    const button = document.createElement('button')
    button.setAttribute('onclick', 'globalThis.handlerRan = true')
    button.click()
    let evaluated = false
    for (const evaluate of [() => (0, eval)('true') as boolean, () => new Function('return true')() as boolean]) {
      try {
        evaluated ||= evaluate()
      } catch {
        // refused
      }
    }
    await fetch('https://example.invalid/').catch(() => {})
    await new Promise((done) => {
      const image = new Image()
      image.onload = image.onerror = done
      image.src = 'https://example.invalid/pixel.png'
    })
    await new Promise((done) => setTimeout(done, 100)) // the reports arrive after the attempts
    const ran = globalThis as unknown as { inlineRan?: boolean; handlerRan?: boolean }
    return { ran: [ran.inlineRan === true, ran.handlerRan === true, evaluated], refused: [...new Set(refused)].sort() }
  })
  expect(tried.ran).toEqual([false, false, false])
  expect(tried.refused).toEqual(['connect-src', 'img-src', 'script-src', 'script-src-attr', 'script-src-elem'])
  expect(refusedByPolicy.length).toBeGreaterThan(0) // and the console, watched above, does report what is refused
})

test('adds a folder only when the user chose it', async () => {
  // Repositories outside the folder the deck watches: gamma with delta next to it, epsilon on its own.
  const [gamma, , epsilon] = ['elsewhere/gamma', 'elsewhere/delta', 'dropped/epsilon'].map((at) => {
    const repo = join(f.root, at)
    mkdirSync(repo, { recursive: true })
    git(repo, 'init', '-q')
    writeFileSync(join(repo, 'README.md'), `# ${at}\n`)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'first commit')
    return repo
  })
  // What a page gone wrong could do: call the core by itself.
  const ask = (method: string, args: unknown): Promise<string> =>
    win.evaluate(([name, given]) => {
      const bridge = (globalThis as unknown as { repodeck: { call: (method: string, args: unknown) => Promise<unknown> } }).repodeck
      return bridge.call(name, given).then(String, (e: Error) => `refused: ${e.message}`)
    }, [method, args] as const)
  const refused = 'refused: Only a folder you chose can be added.'
  await win.getByRole('button', { name: 'Projects', exact: true }).click()

  // Main never saw the user choose the folder: not added.
  expect(await ask('addFolders', { paths: [gamma] })).toBe(refused)
  await expect(panel('gamma')).toHaveCount(0)

  // Chosen in the Add Folder dialog (answered here in the user's place): added.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, gamma)
  await win.keyboard.press('Control+O')
  await expect(panel('gamma')).toBeVisible()

  // The repository next to it joins only when the user agrees, in main's own dialog, to have the
  // folder's projects shown automatically.
  const answer = (button: number) => app.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async () => ({ response, checkboxChecked: false })
  }, button)
  await answer(1) // Cancel
  await ask('setGroup', { folder: join(f.root, 'elsewhere'), watching: true })
  await expect(panel('gamma')).toBeVisible()
  await expect(panel('delta')).toHaveCount(0)
  await answer(0) // Show
  await ask('setGroup', { folder: join(f.root, 'elsewhere'), watching: true })
  await expect(panel('delta')).toBeVisible()

  // Dropped on the window by the user (a real drop, made through the browser's own input): added,
  // by the page's own drop handler.
  const cdp = await win.context().newCDPSession(win)
  const data = { items: [], files: [epsilon], dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, x: 500, y: 500, data })
  await expect(panel('epsilon')).toBeVisible()

  // A choice is good for one add: taken out of the deck again, the page can't put it back by itself.
  await ask('removeRepo', { path: epsilon })
  await expect(panel('epsilon')).toHaveCount(0)
  expect(await ask('addFolders', { paths: [epsilon] })).toBe(refused)

  // Nor with a file it was once given: looking up its path chooses nothing, and a drop the page
  // makes itself is not the user's. (That drop doesn't bubble, so only the preload sees it: the
  // page's own drop handler can't ask for the folder first.)
  const input = await win.evaluateHandle(() => {
    const element = document.createElement('input')
    element.type = 'file'
    document.body.append(element)
    return element
  })
  await input.setInputFiles(join(epsilon, 'README.md'))
  const held = await input.evaluate((element) => {
    const bridge = (globalThis as unknown as { repodeck: { host: { pathForFile: (file: File) => string } } }).repodeck
    const file = element.files![0]
    const transfer = new DataTransfer()
    transfer.items.add(file)
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: false, cancelable: true }))
    element.remove()
    return bridge.host.pathForFile(file)
  })
  expect(held).toBe(join(epsilon, 'README.md'))
  expect(await ask('addFolders', { paths: [held] })).toBe(refused)
  await expect(panel('epsilon')).toHaveCount(0)
})

test('main shows only deck folders and opens only web links for the page', async () => {
  // Called the way a page could call them; nothing here opens a window (each call is refused).
  const host = (name: string, ...args: unknown[]): Promise<string> =>
    win.evaluate(([method, given]) => {
      const bridge = (globalThis as unknown as { repodeck: { host: Record<string, (...a: unknown[]) => Promise<unknown>> } }).repodeck
      return bridge.host[method](...given).then(() => 'done', (e: Error) => e.message)
    }, [name, args] as const)
  expect(await host('openPath', f.root)).toContain('Not in the deck') // a folder, but not one of the deck's
  expect(await host('openPath', join(f.alpha, 'README.md'))).toContain('Not in the deck') // a file, even inside one
  expect(await host('openPath', '/bin/sh')).toContain('Not in the deck')
  expect(await host('openPath', 'alpha')).toContain('Not a folder')
  expect(await host('openInEditor', f.root)).toContain('Not in the deck')
  expect(await host('openExternal', 'file:///etc/passwd')).toContain('Only web links can be opened')
  expect(await host('update', 'reboot')).toContain('Unknown update action')

  // What the page does ask for still works: a repository of the deck and the settings folder open.
  // The file manager is replaced by a list here, so the test opens no window.
  const replaced = await app.evaluate(({ shell }) => {
    const opened: string[] = []
    const record = async (path: string): Promise<string> => (opened.push(path), '')
    shell.openPath = record
    ;(globalThis as unknown as { opened: string[] }).opened = opened
    return shell.openPath === record
  })
  expect(replaced).toBe(true)
  const settings = join(f.env.XDG_CONFIG_HOME, 'repodeck')
  expect(await host('openPath', f.alpha)).toBe('done')
  expect(await host('openPath', settings)).toBe('done')
  expect(await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([f.alpha, settings])
})

test("the page lives at RepoDeck's own address, which leads to the built page and nothing else", async () => {
  expect(win.url()).toBe('repodeck://app/index.html')

  // A script somewhere else on the disk (a file in a repository, say) is not the page's to run.
  const outside = join(f.root, 'outside.js')
  writeFileSync(outside, 'globalThis.outsideRan = true\n')
  const tried = await win.evaluate(async (src) => {
    const script = document.createElement('script')
    const loaded = await new Promise<boolean>((done) => {
      script.onload = () => done(true)
      script.onerror = () => done(false)
      script.src = src
      document.head.append(script)
    })
    script.remove()
    return { loaded, ran: (globalThis as unknown as { outsideRan?: boolean }).outsideRan === true }
  }, pathToFileURL(outside).href)
  expect(tried).toEqual({ loaded: false, ran: false })

  // Asked the way any page could ask: only files of the built page are served.
  const status = (url: string, method = 'GET'): Promise<number> =>
    app.evaluate(({ net }, [to, how]) => net.fetch(to, { method: how }).then((r) => r.status, () => 0), [url, method] as const)
  expect(await status('repodeck://app/index.html')).toBe(200)
  expect(await status('repodeck://app/index.html', 'POST')).toBe(404)
  expect(await status('repodeck://app/..%2Fmain%2Findex.js')).toBe(404) // main's own code, one folder up
  expect(await status('repodeck://app/..%2F..%2Fpackage.json')).toBe(404)
  expect(await status('repodeck://app/assets/no-such-file.js')).toBe(404)
  expect(await status('repodeck://elsewhere/index.html')).toBe(404)
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
