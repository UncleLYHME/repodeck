import type { Change, Hunk, Status } from './types'

export function letter(c: Change): string {
  if (c.kind === 'untracked') return 'U'
  if (c.kind === 'conflict') return '!'
  return c.y !== '.' ? c.y : c.x
}

export function isStaged(c: Change): boolean {
  return c.kind === 'tracked' && c.x !== '.'
}

/** Some changes staged, more on top in the working tree: committing takes only the staged part. */
export function isPartial(c: Change): boolean {
  return isStaged(c) && c.y !== '.'
}

/** New in the index or untracked: discarding moves the file to the Trash. */
export function isNewFile(c: Change): boolean {
  return c.kind === 'untracked' || 'AC'.includes(c.x)
}

export function hasCommits(st: Status): boolean {
  return st.oid !== '' && st.oid !== '(initial)'
}

export function canFastForward(st: Status): boolean {
  return Boolean(st.upstream && st.behind && !st.ahead && !st.operation && st.branch !== '(detached)')
}

export const hunkPatch = (h: Hunk): string => h.header + h.body
export const hunkTitle = (h: Hunk): string => h.body.split('\n')[0]

/** CSS class colouring a git status letter (M, A, D, R, ...); st-C is reserved for conflicts. */
export function statusClass(l: string): string {
  return `st-${l === 'C' ? 'R' : l === '!' ? 'C' : l}`
}
