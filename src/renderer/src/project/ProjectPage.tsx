/* Project page: analytics for one repository, opened from the sidebar.

Re-reads whenever that repo's history moves, so it stays live; GitHub data loads when the page
opens and every few minutes while it's shown.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, FilePen, Users } from 'lucide-react'
import type { ProjectGithub, ProjectStats } from '@shared/types'
import { ago, basename, dirname, freshness, isoTs, plural, short } from '@shared/time'
import { api, host } from '../bridge'
import { openProject, useStore } from '../store'
import { Card, Dot, Empty, SkeletonRows, SubHead, throttle } from '../ui/bits'
import { Bars, DateTicks, Heatmap, Meter, StackedBar, languageParts } from '../ui/charts'
import { ActivityIcon, BranchIcon, CommitIcon, PullRequestIcon } from '../ui/icons'

const GITHUB_MS = 5 * 60_000
const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])

function Tile({ caption, value, sub }: { caption: string; value?: string; sub?: string }) {
  return (
    <section className="card flex min-w-0 flex-col gap-0.5 px-3.5 py-3" aria-label={caption}>
      <h2 className="text-[12.5px] font-semibold text-white/85">{caption}</h2>
      {value === undefined ? (
        <div className="mt-1.5 flex flex-col gap-2"><div className="skeleton h-[22px] w-[70px]" /><div className="skeleton h-2 w-[150px]" /></div>
      ) : (
        <>
          <span className="text-[26px] leading-tight font-bold tracking-tight">{value}</span>
          <span className="meta ellipsis">{sub}</span>
        </>
      )}
    </section>
  )
}

function runState(run: ProjectGithub['runs'][number]): { dot: 'ok' | 'warn' | 'idle'; word: string } {
  const state = run.conclusion || run.status
  if (state === 'success') return { dot: 'ok', word: 'passed' }
  if (state && FAILED.has(state)) return { dot: 'warn', word: 'failed' }
  if (state === 'cancelled' || state === 'skipped' || state === 'neutral') return { dot: 'idle', word: state }
  return { dot: 'idle', word: 'running' }
}

export function ProjectPage() {
  const path = useStore((s) => s.projectPath)!
  const state = useStore((s) => s.repos[path])
  const pinned = useStore((s) => s.deck?.pinned.includes(path) ?? false)
  const code = useStore((s) => s.capabilities.code)
  const head = useStore((s) => s.histories[path]?.[0]?.fullSha)
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [gh, setGh] = useState<ProjectGithub | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Another project: skeletons instead of the previous project's numbers.
  useEffect(() => {
    setStats(null)
    setGh(null)
    scroller.current?.scrollTo(0, 0)
  }, [path])

  const reload = useMemo(() => throttle(600, () => {
    const p = useStore.getState().projectPath
    if (p) void api.projectStats(p).then((s) => useStore.getState().projectPath === p && setStats(s), () => {})
  }), [])
  useEffect(reload, [reload, path, head, state?.status?.oid, state?.status?.branch])

  useEffect(() => {
    let live = true
    const load = (force = false) => void api.projectGithub(path, force).then((g) => live && setGh(g), () => {})
    void api.projectGithubCached(path).then((cached) => live && cached && setGh((g) => g ?? cached)) // instant; revalidated below
    load()
    const timer = setInterval(() => load(), GITHUB_MS)
    const f5 = () => {
      reload()
      load(true)
    }
    window.addEventListener('repodeck:reload', f5)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('repodeck:reload', f5)
    }
  }, [path, reload])

  const st = state?.status
  const s = stats
  const now = Date.now() / 1000
  const delta = s ? s.commits30 - s.commitsPrev30 : 0
  const trend = !delta ? 'same as' : delta > 0 ? `↑${delta} vs` : `↓${-delta} vs`
  const since = s?.firstCommit ? new Date(s.firstCommit * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'
  const parts = s?.languages.length ? languageParts(s.languages) : []

  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-3 px-4 pt-6 pb-8">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-[240px] flex-1">
            <h2 className="ellipsis text-[26px] font-bold tracking-tight">{pinned ? '★ ' : ''}{basename(path)}</h2>
            <p className="mono ellipsis-start"><bdi>{path}</bdi></p>
            {st && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="branch-pill">{st.branch}</span>
                <span className="meta">{st.upstream ? `↑${st.ahead} ↓${st.behind}` : 'no upstream'}</span>
                <Dot kind={st.changes.length ? 'busy' : 'ok'} />
                <span className="meta">{st.changes.length ? plural(st.changes.length, 'uncommitted change') : 'clean'}</span>
                {state?.pending && <span className="pending-pill" title={state.pending.why}>{state.pending.label}</span>}
              </div>
            )}
          </div>
          <div className="flex gap-1.5">
            <button className="btn btn-primary pill" onClick={() => openProject(path)} title="Commit, branches and history on the Projects page">Open Panel</button>
            {code && <button className="btn pill" onClick={() => void host.openInEditor(path)}>VS Code</button>}
            {gh?.slug && <button className="btn pill" onClick={() => void host.openExternal(`https://github.com/${gh.slug}`)}>GitHub</button>}
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          <Tile caption="Commits · 30 days" value={s ? String(s.commits30) : undefined} sub={`${trend} the previous 30 days`} />
          <Tile caption="Lines changed · 30 days" value={s ? short(s.added30 + s.deleted30) : undefined}
            sub={s ? `+${short(s.added30)} added · −${short(s.deleted30)} removed` : ''} />
          <Tile caption="Streak" value={s ? plural(s.streak, 'day') : undefined} sub={s?.streak ? 'in a row with commits' : 'no commits today or yesterday'} />
          <Tile caption="All time" value={s ? s.totalCommits.toLocaleString() : undefined}
            sub={s ? `commits since ${since} · ${plural(s.authors.length, 'contributor')}` : ''} />
        </div>

        <Card title="Activity · last 30 days" icon={<ActivityIcon size={14} />}>
          {!s ? <SkeletonRows n={4} lead="none" /> : <><Bars days={s.days} height={96} /><DateTicks days={s.days} /></>}
        </Card>

        <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
          <Card title="When commits happen · last 90 days" icon={<Clock size={14} />}>
            <Heatmap punchcard={s?.punchcard ?? []} />
          </Card>
          <Card title="Languages" icon={<CommitIcon size={14} />} note={s ? 'By file size of tracked files' : undefined}>
            {!s ? <SkeletonRows /> : !parts.length ? <Empty>No recognised source files.</Empty> : <StackedBar parts={parts} />}
          </Card>
          <Card title="Most changed files · 90 days" icon={<FilePen size={14} />}>
            {!s ? <SkeletonRows /> : !s.hotFiles.length ? <Empty>No changes in the last 90 days.</Empty> : s.hotFiles.map(([file, commits, churn]) => {
              const content = (
                <>
                  <span className="ellipsis max-w-[45%] flex-none">{basename(file)}</span>
                  <span className="mono ellipsis-start flex-1"><bdi>{dirname(file)}</bdi></span>
                  <span className="meta whitespace-nowrap">{plural(commits, 'commit')} · {short(churn)} lines</span>
                </>
              )
              return code ? (
                <button key={file} className="dash-row" title={file} onClick={() => void host.openInEditor(path, file)}>{content}</button>
              ) : <div key={file} className="dash-row" title={file}>{content}</div>
            })}
          </Card>
          <Card title="Contributors" icon={<Users size={14} />} note={s && s.authors.length > 6 ? `+${s.authors.length - 6} more` : undefined}>
            {!s ? <SkeletonRows /> : !s.authors.length ? <Empty>No commits yet.</Empty> : s.authors.slice(0, 6).map(([name, count]) => (
              <div key={name} className="dash-row">
                <span className="ellipsis w-[140px] flex-none">{name}</span>
                <Meter value={count} max={s.authors[0][1]} />
                <span className="meta w-12 text-right">{count.toLocaleString()}</span>
              </div>
            ))}
          </Card>
          <Card title="Branches" icon={<BranchIcon size={14} />} count={s?.branches.length} note={s && s.branches.length > 6 ? `+${s.branches.length - 6} more` : undefined}>
            {!s ? <SkeletonRows /> : s.branches.slice(0, 6).map(([name, ts, track, current]) => {
              const stale = now - ts > 30 * 86400
              return (
                <div key={name} className="dash-row" title={stale ? 'No commits for 30+ days' : undefined}>
                  <Dot kind={current ? 'ok' : stale ? 'idle' : 'sync'} />
                  <span className="ellipsis flex-1">{name}</span>
                  {track && <span className="mono">{track}</span>}
                  <span className="meta whitespace-nowrap">{current ? 'current · ' : ''}{ago(ts, now)}</span>
                </div>
              )
            })}
          </Card>
          <Card title="GitHub" icon={<PullRequestIcon size={14} />} note={freshness(gh) || undefined}>
            {!gh ? <SkeletonRows /> : !gh.slug ? <Empty>Not hosted on GitHub.</Empty> : gh.error ? <Empty>GitHub unavailable: {gh.error}</Empty> : (
              <>
                <SubHead>Open pull requests · {gh.prs.length}</SubHead>
                {!gh.prs.length && <Empty>None open.</Empty>}
                {gh.prs.slice(0, 4).map((pr) => (
                  <button key={pr.url} className="dash-row" onClick={() => void host.openExternal(pr.url)}>
                    <PullRequestIcon size={14} className="flex-none text-ok" />
                    <span className="ellipsis flex-1">{pr.title}</span>
                    <span className="mono">#{pr.number}</span>
                    <span className="meta">{pr.isDraft ? 'Draft' : 'Open'}</span>
                  </button>
                ))}
                <SubHead>Latest workflow runs</SubHead>
                {!gh.runs.length && <Empty>No workflow runs.</Empty>}
                {gh.runs.slice(0, 4).map((run) => {
                  const { dot, word } = runState(run)
                  return (
                    <button key={run.url} className="dash-row" onClick={() => void host.openExternal(run.url)} title={run.displayTitle}>
                      <Dot kind={dot} />
                      <span className="ellipsis flex-1">{run.workflowName}</span>
                      <span className="mono ellipsis max-w-[120px]">{run.headBranch}</span>
                      <span className="meta whitespace-nowrap">{word} · {ago(isoTs(run.createdAt), now)}</span>
                    </button>
                  )
                })}
              </>
            )}
          </Card>
        </div>

        <Card title="Recent commits" icon={<CommitIcon size={14} />}>
          {!s ? <SkeletonRows /> : !s.recent.length ? <Empty>No commits in the last 90 days.</Empty> : s.recent.map(([ts, subject, author, sha]) => (
            <button key={sha} className="dash-row" onClick={() => openProject(path)}>
              <CommitIcon size={14} className="flex-none text-white/45" />
              <span className="ellipsis flex-1">{subject}</span>
              <span className="meta ellipsis max-w-[140px]">{author}</span>
              <span className="mono">{sha}</span>
              <span className="meta w-7 text-right">{ago(ts, now)}</span>
            </button>
          ))}
        </Card>
      </div>
    </div>
  )
}
