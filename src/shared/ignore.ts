// .gitignore patterns offered for a changed file (shared: the renderer builds the menu, the core writes).

import type { Change } from './types'
import { basename, dirname } from './time'

/** A literal path as a .gitignore pattern (glob characters, leading #/!, trailing spaces escaped). */
export function gitignoreEscape(path: string): string {
  let out = [...path].map((ch) => ('*?[\\'.includes(ch) ? '\\' + ch : ch)).join('')
  if (out[0] === '#' || out[0] === '!') out = '\\' + out
  const stripped = out.replace(/ +$/, '')
  return stripped !== out ? stripped + '\\ '.repeat(out.length - stripped.length) : out
}

/** Python's PurePath.suffix: ".log" for "out.log", "" for ".gitignore" or "name.". */
export function suffix(path: string): string {
  const name = basename(path)
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? name.slice(i) : ''
}

/** [label, pattern] offered for a changed file: the file, its extension, its folder. */
export function ignoreChoices(change: Change): [string, string][] {
  const choices: [string, string][] = [['This File', '/' + gitignoreEscape(change.path)]]
  const ext = suffix(change.path)
  if (ext) choices.push([`All ${ext} Files`, '*' + gitignoreEscape(ext)])
  const parent = dirname(change.path)
  if (parent) choices.push([`Folder ${parent}/`, '/' + gitignoreEscape(parent) + '/'])
  return choices
}
