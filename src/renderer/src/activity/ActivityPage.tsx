// Activity page: the log of what RepoDeck did, grouped by day, newest first.

import { useState } from 'react'
import { AlertCircle, AlertTriangle, History, RefreshCw, User } from 'lucide-react'
import type { ActivityEntry } from '@shared/types'
import { basename, localDate } from '@shared/time'
import { api } from '../bridge'
import { confirm, showProject, useStore } from '../store'

const FILTERS = [['all', 'All'], ['auto', 'Automatic'], ['problems', 'Problems']] as const
type Filter = (typeof FILTERS)[number][0]

function dayTitle(day: string): string {
  const today = localDate(new Date())
  if (day === today) return 'Today'
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === localDate(yesterday)) return 'Yesterday'
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function Icon({ e }: { e: ActivityEntry }) {
  if (e.level === 'error') return <AlertCircle size={16} className="flex-none text-danger" />
  if (e.level === 'warn') return <AlertTriangle size={16} className="flex-none text-busy" />
  if (e.who === 'auto') return <RefreshCw size={16} className="flex-none text-accent-fg" />
  return <User size={16} className="flex-none text-white/60" />
}

export function ActivityPage() {
  const entries = useStore((s) => s.activity)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const visible = [...entries].reverse().filter((e) => {
    if (filter === 'auto' && e.who !== 'auto') return false
    if (filter === 'problems' && e.level === 'info') return false
    return !q || e.message.toLowerCase().includes(q) || (e.repo && basename(e.repo).toLowerCase().includes(q))
  })
  const days: [string, ActivityEntry[]][] = []
  for (const e of visible) {
    const day = localDate(new Date(e.ts * 1000))
    if (days.at(-1)?.[0] === day) days.at(-1)![1].push(e)
    else days.push([day, [e]])
  }

  const clear = async () => {
    if (await confirm({ heading: 'Clear the activity log?', body: "This removes every entry. It can't be undone.", confirm: 'Clear', destructive: true })) {
      await api.clearActivity()
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-3.5 px-4 pt-6 pb-8">
        <header className="flex items-center gap-2.5">
          <div className="flex-1">
            <h2 className="text-[26px] font-bold tracking-tight">Activity</h2>
            <p className="meta">What RepoDeck did: background fetches and pulls, updates, and actions you ran.</p>
          </div>
          <button className="btn pill" onClick={() => void clear()} title="Clear the activity log">Clear</button>
        </header>
        <div className="flex gap-2.5">
          <div className="flex rounded-lg bg-white/[0.06] p-0.5" role="group" aria-label="Show">
            {FILTERS.map(([key, label]) => (
              <button key={key} className={`h-7 rounded-md px-3 text-[12.5px] font-semibold ${filter === key ? 'bg-white/[0.12]' : 'text-white/60'}`}
                aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
          <input className="field flex-1" placeholder="Search activity…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search activity" />
        </div>
        {!days.length ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <History size={48} className="text-white/25" />
            <h3 className="text-[18px] font-bold">Nothing here yet</h3>
            <p className="text-white/55">Fetches, pulls, updates and your actions will show up here.</p>
          </div>
        ) : days.map(([day, list]) => (
          <section key={day} aria-label={dayTitle(day)}>
            <h3 className="mx-1 mt-1 mb-1.5 text-[11px] font-extrabold tracking-[0.08em] text-white/55 uppercase">{dayTitle(day)}</h3>
            <ul className="card overflow-hidden">
              {list.map((e, i) => {
                const time = new Date(e.ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
                const who = e.who === 'auto' ? 'Automatic' : 'You'
                const body = (
                  <>
                    <Icon e={e} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                      <span className="break-words">{e.message}</span>
                      <span className="meta">{e.repo ? `${basename(e.repo)} · ${who}` : who}</span>
                    </span>
                    <span className="meta self-start">{time}</span>
                  </>
                )
                const cls = `flex w-full items-center gap-3 px-3.5 py-2.5 ${i ? 'border-t border-line' : ''}`
                const label = `${e.message}${e.repo ? ` in ${basename(e.repo)}` : ''}, ${who.toLowerCase()}, ${time}`
                return (
                  <li key={`${e.ts}${i}`}>
                    {e.repo ? (
                      <button className={`${cls} hover:bg-white/[0.03]`} onClick={() => showProject(e.repo!)} title={`${e.repo}\nClick for this project`} aria-label={label}>{body}</button>
                    ) : <div className={cls} aria-label={label}>{body}</div>}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
