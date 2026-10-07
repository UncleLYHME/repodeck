// The branch pill: click it to switch branches, check out a remote branch, or create a new one.

import { useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Check, Server } from 'lucide-react'
import type { Branches, Status } from '@shared/types'
import { api } from '../bridge'
import { runOp } from '../store'
import { BranchIcon } from '../ui/icons'

export function BranchPicker({ repo, status, error }: { repo: string; status: Status | null; error: string | null }) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<Branches | null>(null)
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)

  const label = !status ? (error ? 'unavailable' : '…') : status.branch === '(detached)' ? `detached ${status.oid.slice(0, 7)}` : status.branch
  const tracking = status?.upstream ? `Tracking ${status.upstream}` : error ?? 'No upstream branch'

  const onOpen = (o: boolean) => {
    setOpen(o)
    if (!o) return
    setQuery('')
    setBranches(null)
    void api.branches(repo).then(setBranches, () => setBranches({ current: '', local: [], remote: [] }))
  }

  const q = query.trim().toLowerCase()
  const name = query.trim()
  const local = (branches?.local ?? []).filter(([n]) => !q || n.toLowerCase().includes(q))
  const remote = (branches?.remote ?? []).filter((r) => !q || r.toLowerCase().includes(q))
  const exists = !!branches && (branches.local.some(([n]) => n === name) || branches.remote.includes(name))

  const pick = (kind: 'local' | 'remote', ref: string) => {
    setOpen(false)
    if (kind === 'local') {
      if (ref !== branches?.current) void runOp(repo, () => api.switchBranch(repo, ref))
    } else {
      void runOp(repo, () => api.switchRemote(repo, ref))
    }
  }
  const create = () => {
    setOpen(false)
    void runOp(repo, () => api.createBranch(repo, name))
  }
  const first = () => {
    if (local[0]) pick('local', local[0][0])
    else if (remote[0]) pick('remote', remote[0])
    else if (name && !exists) create()
  }
  const moveFocus = (e: React.KeyboardEvent, step: number) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[i + step] ?? (step > 0 ? buttons[0] : undefined)
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpen}>
      <Popover.Trigger className="branch-pill ellipsis" title={`${tracking} · click to switch branch`} disabled={!status}
        aria-label={`Branch ${label}: switch branch`}>
        <span className="ellipsis">{label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50">
          <Popover.Popup className="menu-popup w-[320px] p-2">
            <input className="field mb-1.5" placeholder="Find or create a branch…" value={query} autoFocus aria-label="Find or create a branch"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') first()
                else if (e.key === 'ArrowDown') moveFocus(e, 1)
              }} />
            {name && !exists && branches && (
              <button className="menu-item w-full hover:bg-white/[0.07]" onClick={create}>Create branch “{name}” from here</button>
            )}
            <div ref={list} className="max-h-[320px] overflow-y-auto" onKeyDown={(e) => {
              if (e.key === 'ArrowDown') moveFocus(e, 1)
              else if (e.key === 'ArrowUp') moveFocus(e, -1)
            }}>
              {!branches && <p className="px-2.5 py-2 text-[13px] text-white/45">Loading branches…</p>}
              {local.map(([n, upstream]) => (
                <button key={n} className="menu-item w-full hover:bg-white/[0.07] focus-visible:bg-white/[0.07]" onClick={() => pick('local', n)}>
                  {n === branches?.current ? <Check size={14} className="text-accent-fg" /> : <BranchIcon size={14} className="text-white/55" />}
                  <span className="ellipsis flex-1 text-left">{n}</span>
                  {upstream && <span className="mono">{upstream}</span>}
                </button>
              ))}
              {remote.map((r) => (
                <button key={r} className="menu-item w-full hover:bg-white/[0.07] focus-visible:bg-white/[0.07]" onClick={() => pick('remote', r)}>
                  <Server size={14} className="text-white/55" />
                  <span className="ellipsis flex-1 text-left">{r}</span>
                  <span className="mono">remote</span>
                </button>
              ))}
              {branches && !local.length && !remote.length && !name && <p className="px-2.5 py-2 text-[13px] text-white/45">No branches</p>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
