import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { folderView, isAppPage, webLink } from '../src/main/guard'

describe('isAppPage', () => {
  const page = 'file:///opt/RepoDeck/resources/app.asar/out/renderer/index.html'

  it('knows the one page an installed copy loads', () => {
    expect(isAppPage(page, page, 'linux')).toBe(true)
    expect(isAppPage(`${page}?x=1#top`, page, 'linux')).toBe(true)
    expect(isAppPage(pathToFileURL('/opt/RepoDeck/resources/app.asar/out/renderer/index.html').href, page, 'linux')).toBe(true)
  })

  it('takes any other file, however alike, for a different page', () => {
    for (const url of [
      'file:///home/me/clone/index.html', // "file://" alone used to be enough
      'file:///opt/RepoDeck/resources/app.asar/out/renderer/index.html.evil',
      'file:///opt/RepoDeck/resources/app.asar/out/renderer/other.html',
      'file:///opt/RepoDeck/resources/app.asar/out/renderer/',
      'file://elsewhere/opt/RepoDeck/resources/app.asar/out/renderer/index.html', // the same path on another machine
      'file:///OPT/RepoDeck/resources/app.asar/out/renderer/index.html',
      'https://example.com/opt/RepoDeck/resources/app.asar/out/renderer/index.html',
      'about:blank', 'data:text/html,hi', 'chrome-error://chromewebdata/', '', 'not a url',
    ]) expect(isAppPage(url, page, 'linux'), url).toBe(false)
    for (const url of [undefined, null, 7, {}, [page]]) expect(isAppPage(url, page, 'linux')).toBe(false)
  })

  it('compares the path, not how each side escapes it', () => {
    const spaced = 'file:///Applications/Repo%20Deck%20(beta)/caf%C3%A9/index.html'
    expect(isAppPage("file:///Applications/Repo%20Deck%20%28beta%29/caf%C3%A9/index.html", spaced, 'darwin')).toBe(true)
    expect(isAppPage('file:///Applications/Repo Deck (beta)/café/index.html', spaced, 'darwin')).toBe(true)
    // a "%" in a folder's name: Node escapes it, a URL put together by hand may leave it as it is,
    // also right next to an escape that is one
    expect(isAppPage('file:///home/me/100%done/index.html', pathToFileURL('/home/me/100%done/index.html').href, 'linux')).toBe(true)
    expect(isAppPage('file:///home/me/100%%20Complete/index.html', pathToFileURL('/home/me/100% Complete/index.html').href, 'linux')).toBe(true)
    expect(isAppPage('file:///home/me/caf%E9%20%FF/index.html', 'file:///home/me/caf%e9%20%ff/index.html', 'linux')).toBe(true) // names that aren't UTF-8
    expect(isAppPage('file:///home/me/caf%E9/index.html', 'file:///home/me/caf%C3%A9/index.html', 'linux')).toBe(false)
    expect(isAppPage('file:///home/me/100%25done/other.html', 'file:///home/me/100%25done/index.html', 'linux')).toBe(false)
  })

  it('reads a Windows drive letter in either case', () => {
    const win = 'file:///C:/Users/me/AppData/Local/Programs/RepoDeck/resources/app.asar/out/renderer/index.html'
    expect(isAppPage(win.replace('/C:/', '/c:/'), win, 'win32')).toBe(true)
    expect(isAppPage(win.replace('/C:/', '/D:/'), win, 'win32')).toBe(false)
    expect(isAppPage(win.replace('/C:/', '/c:/'), win, 'linux')).toBe(false) // elsewhere, case tells files apart
  })

  it('in development means the dev server, exactly', () => {
    const dev = 'http://localhost:5173'
    expect(isAppPage('http://localhost:5173/', dev)).toBe(true)
    expect(isAppPage('http://localhost:5173/src/main.tsx?t=1', dev)).toBe(true)
    for (const url of [
      'http://localhost:5173.example.com/', // started with the dev URL, which used to be enough
      'http://localhost:51730/', 'http://localhost:5174/', 'https://localhost:5173/', 'http://localhost/',
      'http://localhost:5173@example.com/', 'file:///tmp/index.html',
    ]) expect(isAppPage(url, dev), url).toBe(false)
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
