// Small formatting helpers shared by the core and the renderer.

export function plural(n: number, word: string): string {
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return `${n} ${n === 1 ? word : word.slice(0, -1) + 'ies'}`
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Compact relative time: now, 12m, 3h, 5d, 2w. */
export function ago(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - ts)
  for (const [unit, size] of [['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]] as const) {
    if (s >= size) return `${Math.floor(s / size)}${unit}`
  }
  return 'now'
}

/** 1234 -> "1.2k" */
export function short(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k`.replace('.0k', 'k') : String(n)
}

export function isoTs(text: string | undefined | null): number {
  return text ? Date.parse(text) / 1000 : 0
}

export type Phase = 'dawn' | 'day' | 'dusk' | 'night'

export function phaseFor(hour: number): Phase {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 22) return 'Good evening'
  return 'Burning the midnight oil'
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `days` days after (or before) a YYYY-MM-DD date. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const basename = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p

/** Parent folder of a repo-relative path, "" at the top level. */
export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/** "Updated 3m ago", or why the shown GitHub data is old. */
export function freshness(result: { fetchedAt?: number; stale?: string } | null | undefined, now?: number): string {
  const when = result?.fetchedAt
  if (!when) return ''
  const age = ago(when, now)
  if (result.stale) return `GitHub unreachable · showing data from ${age} ago`
  return age === 'now' ? 'Updated just now' : `Updated ${age} ago`
}
