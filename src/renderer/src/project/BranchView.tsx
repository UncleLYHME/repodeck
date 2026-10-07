// The Project page's branch pill: pick a branch to see its stats. Nothing is checked out; switching
// branches stays in the Projects page's branch picker.

import { useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Check, Server } from 'lucide-react'
import type { Branches } from '@shared/types'
import { api } from '../bridge'
import { BranchIcon } from '../ui/icons'
import { Bump } from '../ui/motion'

export function BranchView({ repo, current, viewing, onPick }: {
  repo: string
  current: string
  viewing: string | null // another branch whose stats are shown, or null for the checked-out one
  onPick: (branch: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<Branches | null>(null)
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const shown = viewing ?? current

  const onOpen = (o: boolean) => {
    setOpen(o)
    if (!o) return
    setQuery('')
    setBranches(null)
    void api.branches(repo).then(setBranches, () => setBranches({ current: '', local: [], remote: [] }))
  }

  const q = query.trim().toLowerCase()
  const local = (branches?.local ?? []).map(([n]) => n).filter((n) => !q || n.toLowerCase().includes(q))
  const remote = (branches?.remote ?? []).filter((r) => !q || r.toLowerCase().includes(q))
  const pick = (name: string) => {
    setOpen(false)
    onPick(name === current ? null : name)
  }
  const moveFocus = (e: React.KeyboardEvent, step: number) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const next = buttons[buttons.indexOf(document.activeElement as HTMLButtonElement) + step] ?? (step > 0 ? buttons[0] : undefined)
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }
  const row = (name: string, icon: React.ReactNode, note?: string) => (
    <button key={name} className="menu-item w-full hover:bg-white/[0.07] focus-visible:bg-white/[0.07]" onClick={() => pick(name)}
      aria-current={name === shown || undefined}>
      {name === shown ? <Check size={14} className="text-accent-fg" /> : icon}
      <span className="ellipsis flex-1 text-left">{name}</span>
      {note && <span className="mono">{note}</span>}
    </button>
  )

  return (
    <Popover.Root open={open} onOpenChange={onOpen}>
      <Popover.Trigger className="branch-pill ellipsis" title="Click to see another branch's stats" aria-label={`Stats for branch ${shown}: choose another branch`}>
        <Bump value={shown} className="min-w-0"><span className="ellipsis">{shown}</span></Bump>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="menu-popup w-[320px] p-2">
            <input className="field mb-1.5" placeholder="Find a branch…" value={query} autoFocus aria-label="Find a branch"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (local[0] ?? remote[0])) pick(local[0] ?? remote[0])
                else if (e.key === 'ArrowDown') moveFocus(e, 1)
              }} />
            <div ref={list} className="max-h-[320px] overflow-y-auto" onKeyDown={(e) => {
              if (e.key === 'ArrowDown') moveFocus(e, 1)
              else if (e.key === 'ArrowUp') moveFocus(e, -1)
            }}>
              {!branches && <p className="px-2.5 py-2 text-[13px] text-white/45">Loading branches…</p>}
              {local.map((n) => row(n, <BranchIcon size={14} className="text-white/55" />, n === current ? 'checked out' : undefined))}
              {remote.map((r) => row(r, <Server size={14} className="text-white/55" />, 'remote'))}
              {branches && !local.length && !remote.length && <p className="px-2.5 py-2 text-[13px] text-white/45">No branches</p>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
