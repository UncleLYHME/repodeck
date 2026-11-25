import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_PAGE, folderView, isAppPage, pageFile, webLink } from '../src/main/guard'

describe('isAppPage', () => {
  it("knows the page by the app's own address", () => {
    expect(isAppPage(APP_PAGE, APP_PAGE)).toBe(true)
    expect(isAppPage(`${APP_PAGE}?x=1#top`, APP_PAGE)).toBe(true)
    expect(isAppPage('repodeck://app/assets/index.js', APP_PAGE)).toBe(true) // served from the same folder, by main alone
  })

  it('takes a page from anywhere else for a different page', () => {
    for (const url of [
      'file:///opt/RepoDeck/resources/app.asar/out/renderer/index.html', // "file://" alone used to be enough
      'file:///home/me/clone/index.html',
      'file://app/index.html',
      'repodeck://other/index.html', 'repodeck://app.example/index.html', 'repodeck://app:8080/index.html', 'repodeck:app/index.html',
      'repodecks://app/index.html', 'https://app/index.html', 'https://example.com/repodeck://app/index.html',
      'about:blank', 'data:text/html,hi', 'chrome-error://chromewebdata/', '', 'not a url',
    ]) expect(isAppPage(url, APP_PAGE), url).toBe(false)
    for (const url of [undefined, null, 7, {}, [APP_PAGE]]) expect(isAppPage(url, APP_PAGE)).toBe(false)
  })

  it('never takes a file for the page, whatever it is compared with', () => {
    const file = 'file:///opt/RepoDeck/resources/app.asar/out/renderer/index.html'
    expect(isAppPage(file, file)).toBe(false)
  })

  it('in development means the dev server, exactly', () => {
    const dev = 'http://localhost:5173'
    expect(isAppPage('http://localhost:5173/', dev)).toBe(true)
    expect(isAppPage('http://localhost:5173/src/main.tsx?t=1', dev)).toBe(true)
    for (const url of [
      'http://localhost:5173.example.com/', // started with the dev URL, which used to be enough
      'http://localhost:51730/', 'http://localhost:5174/', 'https://localhost:5173/', 'http://localhost/',
      'http://localhost:5173@example.com/', 'file:///tmp/index.html', APP_PAGE,
    ]) expect(isAppPage(url, dev), url).toBe(false)
  })
})

describe('pageFile', () => {
  const root = '/opt/RepoDeck/resources/app.asar/out/renderer'

  it("finds the built page's files", () => {
    expect(pageFile(APP_PAGE, root, posix)).toBe(`${root}/index.html`)
    expect(pageFile('repodeck://app/assets/index-B1x_9.js?v=1#top', root, posix)).toBe(`${root}/assets/index-B1x_9.js`)
    expect(pageFile('repodeck://app/assets/a%20b.css', root, posix)).toBe(`${root}/assets/a b.css`)
    const windows = 'C:\\Program Files\\RepoDeck\\resources\\app.asar\\out\\renderer'
    expect(pageFile('repodeck://app/assets/index.js', windows, win32)).toBe(`${windows}\\assets\\index.js`)
  })

  it('serves nothing outside that folder', () => {
    for (const url of [
      'repodeck://app/..%2F..%2Fmain%2Findex.js', 'repodeck://app/assets/..%2F..%2F..%2Fpackage.json', 'repodeck://app/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd',
      'repodeck://app/..%5C..%5Cmain%5Cindex.js', 'repodeck://app/assets\\..\\..\\main\\index.js', 'repodeck://app/index.html%00.png', 'repodeck://app/%zz',
      'repodeck://app/', 'repodeck://app', 'repodeck://other/index.html', 'repodeck://app:8080/index.html',
      'file:///etc/passwd', 'https://app/index.html', '', 'not a url',
    ]) expect(pageFile(url, root, posix), url).toBeNull()
    for (const url of [undefined, null, 7, {}]) expect(pageFile(url, root, posix)).toBeNull()
    // what a URL already folds away ("..", an absolute path, another drive) stays in the folder, where there is no such file
    for (const url of ['repodeck://app/../../etc/passwd', 'repodeck://app//etc/passwd', 'repodeck://app/%2Fetc%2Fpasswd']) {
      expect(pageFile(url, root, posix), url).toMatch(new RegExp(`^${root}/`))
    }
    const windows = 'C:\\app\\out\\renderer'
    for (const url of ['repodeck://app/C:/Windows/win.ini', 'repodeck://app//server/share/x', 'repodeck://app/..%2F..%2Fmain%2Findex.js']) {
      const file = pageFile(url, windows, win32)
      expect(file === null || file.startsWith(`${windows}\\`), url).toBe(true)
    }
  })
})

describe('webLink', () => {
  it('hands on web links only, in their normal form', () => {
    expect(webLink('https://github.com/UncleLYHME/repodeck/pull/1')).toBe('https://github.com/UncleLYHME/repodeck/pull/1')
    expect(webLink('http://example.com')).toBe('http://example.com/')
    expect(webLink('https://example.com/a b')).toBe('https://example.com/a%20b')
  })

  it('refuses everything that would start a program or open a file', () => {
    for (const url of [
      'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'smb://host/share', 'ms-msdt:/id', 'vscode://file/etc',
      'mailto:a@example.com', '/usr/bin/true', 'C:\\Windows\\System32\\calc.exe', 'https://', 'not a url', '',
    ]) expect(webLink(url), url).toBeNull()
    for (const url of [undefined, null, 7, {}, ['https://example.com']]) expect(webLink(url)).toBeNull()
  })
})

describe('folderView', () => {
  it('opens folders, and on macOS only reveals one that the system would run or install', () => {
    expect(folderView('/Users/me/code/repodeck', 'darwin')).toBe('open')
    expect(folderView('/Users/me/Library/Application Support/RepoDeck', 'darwin')).toBe('open')
    expect(folderView('/Users/me/code/.dotfiles', 'darwin')).toBe('open')
    for (const name of ['Tool.app', 'Tool.APP', 'Tool.app/', 'Setup.pkg', 'a..app', 'next.js', 'Tool\n.app', 'Tool.app\n', 'Tool.']) {
      expect(folderView(`/Users/me/code/${name}`, 'darwin'), name).toBe('reveal')
    }
    expect(folderView('/home/me/code/Tool.app', 'linux')).toBe('open')
    expect(folderView('C:\\code\\Tool.app', 'win32')).toBe('open')
  })
})
