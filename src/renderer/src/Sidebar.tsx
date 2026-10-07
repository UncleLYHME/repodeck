// Left navigation: Home, Projects, Activity, and a live list of every project with its state.

import { History, House, LayoutGrid } from 'lucide-react'
import type { RepoState } from '@shared/types'
import { basename } from '@shared/time'
import { showPage, showProject, showUpdate, sortedRepos, useStore, type Page } from './store'
import { Bump } from './ui/motion'

function repoBadge(r: RepoState | undefined): { dot: string; badge: string; state: string } {
  const st = r?.status
  if (st?.changes.length) return { dot: 'dot-busy', badge: String(st.changes.length), state: `${st.changes.length} uncommitted changes` }
  if (st && (st.ahead || st.behind)) return { dot: 'dot-sync', badge: st.ahead ? `↑${st.ahead}` : `↓${st.behind}`, state: 'out of sync' }
  return { dot: 'dot-idle', badge: '', state: 'clean' }
}

function NavRow({ page, label, icon, badge }: { page: Page; label: string; icon: React.ReactNode; badge?: number }) {
  const current = useStore((s) => s.page === page)
  return (
    <button
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] ${current ? 'bg-white/[0.09] font-semibold' : 'hover:bg-white/[0.05]'}`}
      onClick={() => showPage(page)}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
    >
      <span className="text-white/75">{icon}</span>
      <span className="flex-1">{label}</span>
      {!!badge && <Bump value={badge}><span className="count badge-warn">{badge}</span></Bump>}
    </button>
  )
}

export function Sidebar() {
  const deck = useStore((s) => s.deck)
  const repos = useStore((s) => s.repos)
  const version = useStore((s) => s.version)
  const problems = useStore((s) => s.unseenProblems)
  const update = useStore((s) => s.update)
  const updateWaiting = update?.version && ['available', 'downloading', 'ready'].includes(update.phase)
  const current = useStore((s) => (s.page === 'project' ? s.projectPath : null))
  const paths = sortedRepos(deck?.groups.flatMap((g) => g.repos) ?? [], deck?.pinned ?? [])
  const pinned = new Set(deck?.pinned ?? [])
  const dirty = paths.filter((p) => repos[p]?.status?.changes.length).length

  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-side">
      <div className="drag flex h-[46px] flex-none items-center justify-center border-b border-line text-[14px] font-bold mac-traffic-pad">RepoDeck</div>
      <nav className="flex flex-col gap-0.5 px-2 pt-2" aria-label="Pages">
        <NavRow page="home" label="Home" icon={<House size={16} />} />
        <NavRow page="projects" label="Projects" icon={<LayoutGrid size={16} />} badge={dirty} />
        <NavRow page="activity" label="Activity" icon={<History size={16} />} badge={problems} />
      </nav>
      <h2 className="mx-[18px] mt-4 mb-1 text-[10.5px] font-extrabold tracking-[0.1em] text-white/45">PROJECTS</h2>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Projects">
        {paths.map((path) => {
          const { dot, badge, state } = repoBadge(repos[path])
          const selected = current === path
          return (
            <li key={path}>
              <button
                className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] ${selected ? 'bg-white/[0.09] font-semibold' : 'hover:bg-white/[0.05]'}`}
                onClick={() => showProject(path)}
                title={`${path}\nClick for this project's analytics`}
                aria-label={`${basename(path)}, ${state}`}
                aria-current={selected ? 'page' : undefined}
              >
                <span className={`dot ${dot}`} />
                <span className="ellipsis flex-1">{basename(path)}</span>
                {pinned.has(path) && <span className="text-busy" title="Pinned">★</span>}
                {badge && <Bump value={badge}><span className="rounded-full bg-white/[0.06] px-1.5 font-mono text-[11px] text-white/60">{badge}</span></Bump>}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mx-[18px] mt-2 mb-2.5 flex items-center gap-2 text-[11px] text-white/35">
        RepoDeck {version}
        {updateWaiting && (
          <button className="pop-in rounded-full bg-accent/25 px-2 py-px font-bold text-accent-fg hover:bg-accent/35" onClick={showUpdate}
            title={`RepoDeck ${update.version}: ${update.phase === 'ready' ? 'ready to install' : update.phase === 'downloading' ? 'downloading' : 'available'}`}>
            {update.phase === 'ready' ? 'Restart to update' : 'Update'}
          </button>
        )}
      </div>
    </aside>
  )
}
