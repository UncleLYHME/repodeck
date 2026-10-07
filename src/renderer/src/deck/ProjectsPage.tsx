// The Projects page: one collapsible section per folder, holding the repo panels in a grid.

import { useEffect, useState } from 'react'
import { ChevronRight, FolderOpen } from 'lucide-react'
import type { GroupState, RepoState } from '@shared/types'
import { basename, plural } from '@shared/time'
import { api } from '../bridge'
import { chooseFolders, usePinned, useStore } from '../store'
import { MenuButton } from '../ui/menu'
import { RepoPanel } from './RepoPanel'

const MAX_COLUMNS = 3

function summary(group: GroupState, repos: Record<string, RepoState>): { text: string; tip: string } {
  const states = group.repos.map((p) => [basename(p), repos[p]?.status] as const).filter(([, st]) => st)
  const dirty = states.filter(([, st]) => st!.changes.length)
  const ahead = states.reduce((n, [, st]) => n + st!.ahead, 0)
  const behind = states.reduce((n, [, st]) => n + st!.behind, 0)
  const files = dirty.reduce((n, [, st]) => n + st!.changes.length, 0)
  const parts = !group.repos.length ? ['new projects in this folder will appear here']
    : [dirty.length ? `${dirty.length} with changes (${plural(files, 'file')})` : 'all clean']
  if (ahead) parts.push(`↑${ahead} to push`)
  if (behind) parts.push(`↓${behind} to pull`)
  return { text: parts.join(' · '), tip: dirty.map(([n, st]) => `${n}: ${plural(st!.changes.length, 'change')}`).join('\n') }
}

function FolderGroup({ group }: { group: GroupState }) {
  const repos = useStore((s) => s.repos)
  const pinned = usePinned()
  const { text, tip } = summary(group, repos)
  const pins = new Set(pinned)
  const ordered = [...group.repos].sort((a, b) => Number(pins.has(b)) - Number(pins.has(a))) // pinned first, otherwise keep the order
  const rows = Math.max(1, Math.ceil(ordered.length / MAX_COLUMNS))
  const cols = Math.max(1, Math.ceil(ordered.length / rows))
  const id = `group-${group.folder}`
  // Panels stay mounted while the section slides closed, then unmount (they're heavy).
  const [mounted, setMounted] = useState(group.expanded)
  useEffect(() => {
    if (group.expanded) setMounted(true)
    else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setMounted(false)
  }, [group.expanded])

  return (
    <section aria-label={basename(group.folder)}>
      <div className="flex items-center gap-1">
        <button className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-white/[0.04]"
          onClick={() => void api.setGroup(group.folder, { expanded: !group.expanded })} aria-expanded={group.expanded} aria-controls={id}
          title={group.folder}>
          <ChevronRight size={16} className={`flex-none text-white/60 transition-transform duration-200 ${group.expanded ? 'rotate-90' : ''}`} />
          <span className="text-[16px] font-bold">{basename(group.folder)}</span>
          <span className="count" title={plural(group.repos.length, 'repository')}>{group.repos.length}</span>
          <span className="ellipsis flex-1 text-[13px] text-white/50" title={tip || undefined}>{text}</span>
        </button>
        <MenuButton label="Folder actions" sections={[
          [{ label: 'Show New Projects Automatically', checked: group.watching, onClick: () => void api.setGroup(group.folder, { watching: !group.watching }) }],
          [{ label: 'Remove Folder from Deck', onClick: () => void api.removeGroup(group.folder) }],
        ]} />
      </div>
      <div id={id} className={`grid transition-[grid-template-rows] duration-200 ease-out ${group.expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        onTransitionEnd={(e) => e.target === e.currentTarget && !group.expanded && setMounted(false)}>
        <div className="min-h-0 overflow-hidden">
          {mounted && (
            <div className="grid gap-3 pt-2 pb-1"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(max(380px, calc((100% - ${(cols - 1) * 12}px) / ${cols})), 1fr))` }}>
              {ordered.map((path) => <RepoPanel key={path} repo={path} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function ProjectsPage() {
  const groups = useStore((s) => s.deck?.groups)
  if (!groups?.length) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <FolderOpen size={56} className="text-white/25" />
          <h2 className="text-[20px] font-bold">No repositories yet</h2>
          <p className="text-white/55">Add a git repository, or a folder that contains several.</p>
          <button className="btn btn-primary pill mt-2 h-9 px-5" onClick={() => void chooseFolders()}>Add Folder</button>
        </div>
      </div>
    )
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        {groups.map((g) => <FolderGroup key={g.folder} group={g} />)}
      </div>
    </div>
  )
}
