/* Home: a bird's-eye dashboard across every repository in the deck.

Local cards (working now, sync) follow the repo states the core pushes; git activity and recent
commits are re-read (cheaply, cached per repo) when those change; running services are re-checked
every few seconds while Home is shown (ports emit no events); GitHub cards come from the core,
which asks gh every few minutes.
*/

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, FilePen, Folder, RefreshCw as SyncIcon, Server, Star } from 'lucide-react'
import type { DashboardActivity, Services } from '@shared/types'
import { ago, basename, freshness, greeting, isoTs, plural, short } from '@shared/time'
import { api, host } from '../bridge'
import { openProject, runOp, useRepoPaths, useStore } from '../store'
import { Card, Dot, Empty, SkeletonRows, SubHead, throttle } from '../ui/bits'
import { Bars, DayLetters, Meter } from '../ui/charts'
import { ActivityIcon, CommitIcon, PullRequestIcon } from '../ui/icons'
import { Hero } from './Hero'

const SERVICES_MS = 8000
const SHOW = 5
const more = (n: number) => (n > SHOW ? `+${n - SHOW} more` : undefined)

function Composer() {
  const repos = useStore((s) => s.repos)
  const paths = useRepoPaths()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const found = q ? paths.filter((p) => basename(p).toLowerCase().includes(q)).slice(0, 6) : []
  const open = (p: string) => {
    setQuery('')
    openProject(p)
  }
  return (
    <div className="w-[460px] max-w-[calc(100%-32px)] rounded-[14px] border border-line bg-card/95 p-2 shadow-[0_10px_30px_rgb(0_0_0/0.45)]">
      <input className="field h-[38px] border-0 bg-transparent text-[14px]" placeholder="Jump to a project…" value={query} aria-label="Jump to a project"
        onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && found[0] && open(found[0])} />
      {q && (
        <div className="flex flex-col px-1.5 pb-0.5">
          {found.map((p) => (
            <button key={p} className="dash-row" onClick={() => open(p)}>
              <Folder size={14} className="text-white/50" />
              <span className="ellipsis flex-1">{basename(p)}</span>
              <span className="mono">{repos[p]?.status?.branch}</span>
            </button>
          ))}
          {!found.length && <Empty>No matching project</Empty>}
        </div>
      )}
    </div>
  )
}

function HeroBlock() {
  const motion = useStore((s) => s.deck?.settings.bannerMotion ?? true)
  const repos = useStore((s) => s.repos)
  const paths = useRepoPaths()
  const [hello, setHello] = useState(greeting(new Date().getHours()))
  const onPhase = useMemo(() => () => setHello(greeting(new Date().getHours())), [])
  const loaded = paths.map((p) => repos[p]?.status).filter((s) => !!s)
  const dirty = loaded.filter((st) => st!.changes.length).length
  const ahead = loaded.reduce((n, st) => n + st!.ahead, 0)
  const behind = loaded.reduce((n, st) => n + st!.behind, 0)
  const parts = [plural(paths.length, 'project'), dirty ? `${dirty} with changes` : 'all committed']
  if (ahead) parts.push(`↑${ahead} to push`)
  if (behind) parts.push(`↓${behind} to pull`)
  return (
    <div className="relative h-[330px] flex-none overflow-hidden">
      <Hero motion={motion} onPhase={onPhase} />
      <div className="absolute inset-x-0 bottom-1.5 flex flex-col items-center gap-2.5">
        {/* A translucent strip keeps the text readable over any sky, day or night. */}
        <div className="mx-4 flex max-w-[calc(100%-32px)] flex-col items-center gap-1 rounded-[14px] border border-line bg-card/[0.82] px-7 pt-2.5 pb-3 shadow-[0_10px_30px_rgb(0_0_0/0.35)]">
          <p className="text-[11px] font-extrabold tracking-[0.12em] text-white/80 uppercase">{hello}</p>
          <h2 className="text-center text-[24px] leading-tight font-bold">What's happening across your projects?</h2>
          <p className="text-center text-white/65">{parts.join(' · ')}</p>
        </div>
        <Composer />
      </div>
    </div>
  )
}

export function HomePage() {
  const repos = useStore((s) => s.repos)
  const github = useStore((s) => s.github)
  const [activity, setActivity] = useState<DashboardActivity | null>(null)
  const [services, setServices] = useState<Services | null>(null)
  const paths = useRepoPaths()

  // Commits only change when a repo's history moves; the core caches per repo by ref fingerprint.
  const reload = useMemo(() => throttle(800, () => void api.dashboardActivity().then(setActivity, () => {})), [])
  const historyKey = useStore((s) => Object.values(s.histories).map((h) => h[0]?.fullSha ?? '').join())
  useEffect(reload, [reload, historyKey, paths])
  useEffect(() => {
    const poll = () => void api.services().then(setServices, () => {})
    poll()
    const timer = setInterval(poll, SERVICES_MS)
    window.addEventListener('repodeck:reload', poll)
    return () => {
      clearInterval(timer)
      window.removeEventListener('repodeck:reload', poll)
    }
  }, [paths])
  useEffect(() => {
    if (!github) void api.github().then((g) => useStore.setState({ github: g }), () => {})
  }, [github])

  const states = paths.map((p) => repos[p]).filter((r) => r?.status)
  const dirty = states.filter((r) => r.status!.changes.length).sort((a, b) => b.status!.changes.length - a.status!.changes.length)
  const sync = states.flatMap((r) => {
    const st = r.status!
    const parts = [st.ahead && `↑${st.ahead} to push`, st.behind && `↓${st.behind} to pull`, r.pending?.label, r.fetchError && 'fetch failed'].filter(Boolean)
    return parts.length ? [{ r, text: parts.join(' · ') }] : []
  })
  const now = Date.now() / 1000
  const ranked = activity ? Object.entries(activity.perRepo).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="h-full overflow-y-auto">
      <HeroBlock />
      <div className="mx-auto grid max-w-[980px] grid-cols-1 gap-3 px-4 pt-7 pb-8 @2xl:grid-cols-2">
        <Card title="Working now" icon={<FilePen size={14} />} count={dirty.length} note={more(dirty.length)}>
          {!dirty.length && <Empty>Nothing uncommitted. Every project is clean.</Empty>}
          {dirty.slice(0, SHOW).map((r) => {
            const st = r.status!
            const staged = st.changes.filter((c) => c.kind === 'tracked' && c.x !== '.').length
            return (
              <button key={r.path} className="dash-row" onClick={() => openProject(r.path)}>
                <Dot kind="busy" />
                <span className="ellipsis flex-1">{basename(r.path)}</span>
                <span className="mono ellipsis max-w-[130px]">{st.branch}</span>
                <span className="meta whitespace-nowrap">{plural(st.changes.length, 'file')}{staged ? ` · ${staged} staged` : ''}</span>
              </button>
            )
          })}
        </Card>

        <Card title="Pull requests" icon={<PullRequestIcon size={14} />} count={github && !github.error ? github.prs.review.length + github.prs.mine.length : 0}
          note={freshness(github)}>
          {!github ? <SkeletonRows /> : github.error ? <Empty>GitHub unavailable: {github.error}</Empty> : (
            <>
              {!github.prs.review.length && !github.prs.mine.length && <Empty>No open pull requests.</Empty>}
              {([['Waiting on your review', github.prs.review, true], ['Yours', github.prs.mine, false]] as const).map(([title, items, warn]) => items.length > 0 && (
                <div key={title}>
                  <SubHead warn={warn}>{title} · {items.length}</SubHead>
                  {items.slice(0, SHOW).map((pr) => (
                    <button key={pr.url} className="dash-row" onClick={() => void host.openExternal(pr.url)}>
                      <PullRequestIcon size={14} className="flex-none text-ok" />
                      <span className="ellipsis flex-1">{pr.title}</span>
                      <span className="mono whitespace-nowrap">{pr.repo.split('/').pop()}#{pr.number}</span>
                      <span className="meta">{pr.draft ? 'Draft' : 'Open'}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </Card>

        <Card title="Git activity" icon={<ActivityIcon size={14} />}>
          {!activity ? <SkeletonRows n={4} lead="none" /> : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[30px] leading-none font-bold tracking-tight">{activity.total}</span>
                <span className="meta flex-1">commits · {activity.days.length} days</span>
                <span className="font-mono text-[11.5px] text-ok">+{short(activity.added)}</span>
                <span className="font-mono text-[11.5px] text-warn">−{short(activity.deleted)}</span>
              </div>
              <div className="mt-2"><Bars days={activity.days} /></div>
              <DayLetters days={activity.days} />
            </>
          )}
        </Card>

        <Card title="Sync" icon={<SyncIcon size={14} />} count={sync.length} note={more(sync.length)}>
          {!sync.length && <Empty>Everything is in sync with its remote.</Empty>}
          {sync.slice(0, SHOW).map(({ r, text }) => (
            <div key={r.path} className="dash-row" title={r.fetchError ?? undefined}>
              <Dot kind={r.fetchError ? 'warn' : 'sync'} />
              <span className="ellipsis flex-1">{basename(r.path)}</span>
              <span className="meta whitespace-nowrap">{text}</span>
              {!!r.status!.ahead && !r.busy && (
                <button className="chip-btn" title="Push (brings in remote commits first)" onClick={() => void runOp(r.path, () => api.push(r.path))}>Push</button>
              )}
            </div>
          ))}
        </Card>

        <Card title="Recent commits" icon={<CommitIcon size={14} />}>
          {!activity ? <SkeletonRows /> : !activity.recent.length ? <Empty>No commits in the last {activity.days.length} days.</Empty> : activity.recent.slice(0, 6).map(([ts, repo, subject, author, sha]) => (
            <button key={sha + repo} className="dash-row" onClick={() => openProject(repo)} title={`${author} · ${subject}`}>
              <CommitIcon size={14} className="flex-none text-white/45" />
              <span className="ellipsis flex-1">{subject}</span>
              <span className="mono whitespace-nowrap">{basename(repo)} · {sha}</span>
              <span className="meta w-7 text-right">{ago(ts, now)}</span>
            </button>
          ))}
        </Card>

        <Card title="Running services" icon={<Server size={14} />} count={services?.found.length}
          note={services ? [more(services.found.length), services.others ? `${services.others} other ports listening` : ''].filter(Boolean).join(' · ') : undefined}>
          {!services ? <SkeletonRows /> : !services.found.length ? <Empty>No dev servers running from your projects.</Empty> : services.found.slice(0, SHOW).map(([port, repo, proc]) => (
            <button key={port} className="dash-row" onClick={() => void host.openExternal(`http://localhost:${port}`)} title={`Open http://localhost:${port}`}>
              <Dot kind="ok" />
              <span className="mono">:{port}</span>
              <span className="ellipsis flex-1">{basename(repo)}</span>
              <span className="meta">{proc}</span>
            </button>
          ))}
        </Card>

        <Card title="Most active" icon={<Star size={14} />} note={more(ranked.length)}>
          {!activity ? <SkeletonRows /> : !ranked.length ? <Empty>No activity yet.</Empty> : ranked.slice(0, SHOW).map(([repo, count]) => (
            <button key={repo} className="dash-row" onClick={() => openProject(repo)}>
              <span className="ellipsis w-[130px] flex-none">{basename(repo)}</span>
              <Meter value={count} max={ranked[0][1]} />
              <span className="meta w-6 text-right">{count}</span>
            </button>
          ))}
        </Card>

        <Card title="CI failures" icon={<AlertCircle size={14} />} count={github && !github.error ? github.ci.length : 0} note={freshness(github)}>
          {!github ? <SkeletonRows /> : github.error ? <Empty>GitHub unavailable: {github.error}</Empty> : !github.ci.length ? <Empty>No failing workflows.</Empty> : github.ci.slice(0, SHOW).map((run) => (
            <button key={run.url} className="dash-row" onClick={() => void host.openExternal(run.url)} title={run.displayTitle}>
              <AlertCircle size={14} className="flex-none text-warn" />
              <span className="ellipsis max-w-[40%]">{run.workflowName}</span>
              <span className="meta ellipsis flex-1">{basename(run.repo ?? '')} / {run.headBranch}</span>
              <span className="meta">{ago(isoTs(run.createdAt), now)}</span>
            </button>
          ))}
        </Card>
      </div>
    </div>
  )
}
