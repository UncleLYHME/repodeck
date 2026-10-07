/* Charts for Home and the project page: daily bars, a weekday x hour heatmap, a stacked bar.

Colors follow the dataviz rules: the heatmap is one hue stepped dark -> bright (sequential);
languages use the validated categorical order in a fixed slot order with "Other" in neutral gray;
text stays in neutral ink.
*/

import { useState } from 'react'
import { clockHour, parseDay } from '@shared/time'
import { useHour12 } from '../store'

const BAR = '#3b6fe0'
const BAR_TODAY = '#6f97ff'
const BAR_EMPTY = 'rgba(255,255,255,0.08)'
export const CATEGORICAL = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const OTHER_COLOR = '#5e5e66'
const HEAT = ['#26282e', '#1f3a66', '#2a5aa8', '#3a78d6', '#7ea2ff'] // empty, then increasing commits
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const fmtDay = (day: string) => parseDay(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** Daily commit bars that grow in when the numbers change; hover a bar for its date and count. */
export function Bars({ days, height = 78 }: { days: [string, number][]; height?: number }) {
  const peak = Math.max(1, ...days.map(([, n]) => n))
  const total = days.reduce((a, [, n]) => a + n, 0)
  return (
    <div className="flex items-end gap-[clamp(2px,0.6vw,6px)]" style={{ height }} role="img"
      aria-label={`${total} commits over ${days.length} days`}>
      {days.map(([day, n], i) => (
        <div key={day} className="group relative flex h-full flex-1 items-end" title={`${fmtDay(day)}: ${n} commit${n === 1 ? '' : 's'}`}>
          <div className="w-full origin-bottom rounded-[3px] transition-[height,scale] duration-700 ease-out starting:scale-y-0"
            style={{ height: n ? Math.max(2, (n / peak) * (height - 4)) : 2, background: !n ? BAR_EMPTY : i === days.length - 1 ? BAR_TODAY : BAR }} />
        </div>
      ))}
    </div>
  )
}

export function DayLetters({ days }: { days: [string, number][] }) {
  return (
    <div className="mt-0.5 flex gap-[clamp(2px,0.6vw,6px)]" aria-hidden="true">
      {days.map(([day]) => <span key={day} className="flex-1 text-center text-[10px] text-white/40">{parseDay(day).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>)}
    </div>
  )
}

export function DateTicks({ days, every = 7 }: { days: [string, number][]; every?: number }) {
  return (
    <div className="mt-0.5 flex gap-[clamp(2px,0.6vw,6px)]" aria-hidden="true">
      {days.map(([day], i) => (
        <span key={day} className="flex-1 overflow-visible text-center text-[10px] whitespace-nowrap text-white/40">
          {(days.length - 1 - i) % every === 0 ? parseDay(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
        </span>
      ))}
    </div>
  )
}

function heatLevel(count: number, peak: number): number {
  if (!count || !peak) return 0
  return Math.min(HEAT.length - 1, 1 + Math.floor((count / peak) * (HEAT.length - 2) + 0.5))
}

/** When commits happen: 7 rows (Mon..Sun) x 24 hourly columns, with a less/more legend. */
export function Heatmap({ punchcard }: { punchcard: [number, number, number][] }) {
  const counts = new Map(punchcard.map(([d, h, n]) => [`${d},${h}`, n]))
  const peak = Math.max(0, ...punchcard.map(([, , n]) => n))
  const hour12 = useHour12()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <div className="flex flex-col gap-[3px]" aria-hidden="true">
          {DAY_NAMES.map((d) => <span key={d} className="h-[14px] text-[10px] leading-[14px] text-white/45">{d}</span>)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]" role="img" aria-label="Commits by weekday and hour">
            {DAY_NAMES.map((name, d) => Array.from({ length: 24 }, (_, h) => {
              const n = counts.get(`${d},${h}`) ?? 0
              return <div key={`${d}-${h}`} className="h-[14px] rounded-[3px]" style={{ background: HEAT[heatLevel(n, peak)] }}
                title={`${name} ${clockHour(h, hour12)}–${clockHour(h + 1, hour12)} · ${n} commit${n === 1 ? '' : 's'}`} />
            }))}
          </div>
          <div className="grid grid-cols-[repeat(24,minmax(0,1fr))]" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-[10px] whitespace-nowrap text-white/45">{h % 6 === 0 ? (hour12 ? clockHour(h, true) : h) : ''}</span>)}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-[10px] text-white/45">
        Less {HEAT.map((c) => <span key={c} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: c }} />)} More
      </div>
    </div>
  )
}

/** Fixed slot order by rank in this repo; "Other" is always gray. */
export function languageParts(languages: [string, number][]): [string, number, string][] {
  let slot = 0
  return languages.map(([name, size]) => [name, size, name === 'Other' ? OTHER_COLOR : CATEGORICAL[slot++ % CATEGORICAL.length]])
}

const share = (v: number, total: number) => {
  const s = v / total
  return s > 0 && s < 0.005 ? '<1%' : `${Math.round(s * 100)}%`
}

/** One bar split into segments (2px gaps, rounded ends), then a two-column legend in neutral ink. */
export function StackedBar({ parts }: { parts: [string, number, string][] }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = parts.reduce((a, [, v]) => a + v, 0) || 1
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-[10px] gap-[2px]" role="img" aria-label={parts.map(([n, v]) => `${n} ${share(v, total)}`).join(', ')}>
        {parts.map(([name, value, color]) => (
          <div key={name} className="h-full min-w-[2px] rounded-[4px]" style={{ flexGrow: value, background: color, opacity: hover && hover !== name ? 0.5 : 1 }}
            title={`${name} · ${share(value, total)}`} onMouseEnter={() => setHover(name)} onMouseLeave={() => setHover(null)} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-[18px] gap-y-1.5">
        {parts.map(([name, value, color]) => (
          <div key={name} className="flex items-center gap-2 text-[13px]" onMouseEnter={() => setHover(name)} onMouseLeave={() => setHover(null)}>
            <span className="h-[10px] w-[10px] flex-none rounded-[3px]" style={{ background: color }} />
            <span className="flex-1">{name}</span>
            <span className="meta">{share(value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A thin horizontal meter (most active repos, contributors). */
export function Meter({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full origin-left rounded-full bg-accent transition-[width,scale] duration-500 starting:scale-x-0" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  )
}
