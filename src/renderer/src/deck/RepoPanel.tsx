// One repository panel: header, commit box, changes list and history graph.

import { useEffect, useMemo, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { RepoState } from '@shared/types'
import { basename, clockTime, plural } from '@shared/time'
import { api, host } from '../bridge'
import { confirm, runOp, useHour12, useStore } from '../store'
import { MenuButton } from '../ui/menu'
import { Bump } from '../ui/motion'
import { BranchPicker } from './BranchPicker'
import { Changes, MAX_CHANGES } from './Changes'
import { CommitBox } from './CommitBox'
import { History } from './History'

const quotePath = (branch: string) => branch.split('/').map(encodeURIComponent).join('/')

function githubUrl(slug: string, st: RepoState['status'], compare = false): string {
  const branch = st && st.branch !== '(detached)' ? quotePath(st.branch) : ''
  if (compare) return `https://github.com/${slug}/compare/${branch}?expand=1`
  return branch ? `https://github.com/${slug}/tree/${branch}` : `https://github.com/${slug}`
}

function SyncLabel({ state }: { state: RepoState }) {
  const st = state.status
  const hour12 = useHour12()
  if (!st) return null
  let text = st.upstream ? `↑${st.ahead} ↓${st.behind}` : 'local'
  const tip = [st.upstream ? `${st.ahead} to push, ${st.behind} to pull` : 'No upstream branch']
  if (state.fetchedAt) tip.push(`Last fetched at ${clockTime(state.fetchedAt, hour12)}`)
  if (state.fetchError) {
    text = `⚠ ${text}`
    tip.push(`Background fetch failed: ${state.fetchError}`)
  }
  return (
    <Bump value={text}>
      <span className={`text-[12px] whitespace-nowrap ${state.fetchError ? 'text-busy' : 'text-white/55'}`} title={tip.join('\n')}>{text}</span>
    </Bump>
  )
}

async function confirmAbort(repo: string, state: RepoState): Promise<void> {
  const op = state.status?.operation
  if (!op) return
  const ok = await confirm({
    heading: `Abort the ${op}?`,
    body: `This returns the branch to where it was before the ${op} started. Conflict resolutions you've made so far are thrown away.`,
    confirm: 'Abort', cancel: 'Keep Going', destructive: true,
  })
  if (ok) await runOp(repo, () => api.abort(repo))
}

export function RepoPanel({ repo }: { repo: string }) {
  const state = useStore((s) => s.repos[repo])
  const pinned = useStore((s) => s.deck?.pinned.includes(repo) ?? false)
  const excluded = useStore((s) => s.excluded[repo])
  const flash = useStore((s) => s.flash === repo)
  const code = useStore((s) => s.capabilities.code)
  const root = useRef<HTMLElement>(null)
  const st = state?.status ?? null
  const name = basename(repo)

  const selected = useMemo(() => {
    const skip = new Set(excluded ?? [])
    return (st?.changes ?? []).slice(0, MAX_CHANGES).filter((c) => !skip.has(c.path))
  }, [st, excluded])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => root.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 220)
    return () => clearTimeout(t)
  }, [flash])

  const onBranch = !!st && st.branch !== '(detached)'
  const slug = state?.slug
  const conflicts = st?.changes.filter((c) => c.kind === 'conflict').length ?? 0
  const sections = [
    [
      { label: 'Fetch', onClick: () => void runOp(repo, () => api.fetch(repo)) },
      { label: 'Pull (fast-forward)', onClick: () => void runOp(repo, () => api.pull(repo)) },
      { label: 'Push', onClick: () => void runOp(repo, () => api.push(repo)) },
    ],
    [
      { label: 'Open on GitHub', disabled: !slug, onClick: () => slug && void host.openExternal(githubUrl(slug, st)) },
      { label: 'Create Pull Request', disabled: !(slug && st?.upstream && onBranch), onClick: () => slug && void host.openExternal(githubUrl(slug, st, true)) },
    ],
    [
      { label: 'Stash All Changes', disabled: !st?.changes.length, onClick: () => void runOp(repo, () => api.stash(repo)) },
      { label: 'Apply Latest Stash', disabled: !state?.stashes.length, onClick: () => void runOp(repo, () => api.stashPop(repo)) },
    ],
    [
      { label: 'Pinned to Top', checked: pinned, onClick: () => void api.togglePin(repo) },
      { label: 'Open in Files', onClick: () => void host.openPath(repo) },
      { label: 'Open in VS Code', hidden: !code, onClick: () => void host.openInEditor(repo) },
      { label: 'Remove from Deck', onClick: () => void api.removeRepo(repo) },
    ],
  ]

  return (
    <article ref={root} aria-label={name}
      className={`card flex h-[max(460px,min(calc(100vh-150px),780px))] min-w-0 flex-col pb-1.5 transition-shadow duration-500 ${flash ? 'flash' : ''}`}
      title={state?.error && !st ? state.error : undefined}>
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className={`ellipsis text-[14px] font-bold ${pinned ? 'text-busy' : ''}`}>{pinned ? '★ ' : ''}{name}</h2>
          <div className="ellipsis-start text-[11.5px] text-white/45" title={repo}><bdi>{repo}</bdi></div>
        </div>
        {state?.busy && <span className="spinner" title={state.busy} aria-label="Working" />}
        <BranchPicker repo={repo} status={st} error={state?.error ?? null} />
        {state && <SyncLabel state={state} />}
        {state?.pending && <span className="pending-pill" title={state.pending.why}>{state.pending.label}</span>}
        <MenuButton label="Repository actions" sections={sections} />
      </header>
      {st?.operation && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-busy/[0.14] px-3 py-1.5 text-[12.5px]" role="status">
          <AlertTriangle size={14} className="flex-none text-busy" />
          <span className="flex-1">
            {st.operation[0].toUpperCase() + st.operation.slice(1)} in progress
            {conflicts ? ` · ${plural(conflicts, 'conflict')}${code ? ' (opens in VS Code)' : ''}` : ''}
          </span>
          <button className="chip-btn danger" onClick={() => void confirmAbort(repo, state!)}>Abort…</button>
        </div>
      )}
      {state?.error && !st ? (
        <p className="m-3 rounded-lg bg-warn/10 p-3 text-[12.5px] text-white/75">{state.error}</p>
      ) : (
        <>
          <CommitBox repo={repo} state={state} selected={selected} />
          <Changes repo={repo} state={state} selected={selected} />
          <History repo={repo} />
        </>
      )}
    </article>
  )
}
