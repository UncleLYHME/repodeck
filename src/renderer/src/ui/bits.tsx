// Small shared pieces: skeleton rows, cards, switches, dots.

import type { ReactNode } from 'react'
import { Switch as BaseSwitch } from '@base-ui/react/switch'

export function SkeletonRows({ n = 3, lead = 'dot' }: { n?: number; lead?: 'dot' | 'check' | 'none' }) {
  const widths = ['72%', '54%', '64%', '46%', '58%', '68%']
  return (
    <div className="flex flex-col gap-3 py-1.5" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5">
          {lead !== 'none' && <div className={`skeleton ${lead === 'dot' ? 'h-2.5 w-2.5 rounded-full' : 'h-4 w-4'}`} />}
          <div className="skeleton h-2.5" style={{ width: widths[i % widths.length] }} />
        </div>
      ))}
    </div>
  )
}

export function Card({ title, icon, count, note, extra, children, className = '' }: {
  title: string
  icon?: ReactNode
  count?: number
  note?: string
  extra?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card flex min-w-0 flex-col gap-2 px-3.5 py-3 ${className}`} aria-label={title}>
      <header className="flex items-center gap-2">
        {icon && <span className="text-white/55">{icon}</span>}
        <h2 className="text-[12.5px] font-semibold text-white/85">{title}</h2>
        {!!count && <span className="count badge-warn">{count}</span>}
        <div className="ml-auto flex items-center gap-1">{extra}</div>
      </header>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      {note && <footer className="text-[11.5px] text-white/45">{note}</footer>}
    </section>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="py-1.5 text-[13px] text-white/45">{children}</p>
export const SubHead = ({ children, warn }: { children: ReactNode; warn?: boolean }) => (
  <h3 className={`mt-1.5 text-[11px] font-semibold ${warn ? 'text-busy' : 'text-white/50'}`}>{children}</h3>
)

export const Dot = ({ kind }: { kind: 'busy' | 'sync' | 'ok' | 'warn' | 'idle' }) => <span className={`dot dot-${kind}`} aria-hidden="true" />

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <BaseSwitch.Root className="switch" checked={checked} onCheckedChange={(v) => onChange(v)} disabled={disabled} aria-label={label}>
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  )
}

/** Run `fn` at most once per `ms`, on the trailing edge. */
export function throttle(ms: number, fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }
}
