// The Changes list: checkboxes choose what to commit; per-file discard and ignore; stash count.

import { useEffect, useRef } from 'react'
import { Undo2 } from 'lucide-react'
import type { Change, RepoState } from '@shared/types'
import { isNewFile, isPartial, isStaged, letter, statusClass } from '@shared/changes'
import { ignoreChoices } from '@shared/ignore'
import { basename, dirname, plural } from '@shared/time'
import { api, host } from '../bridge'
import { confirm, openSheet, runOp, setExcluded, useStore } from '../store'
import { ContextArea } from '../ui/menu'
import { FileIcon } from '../ui/icons'
import { SkeletonRows } from '../ui/bits'

export const MAX_CHANGES = 1000

export async function confirmDiscard(repo: string, picked: Change[]): Promise<void> {
  const changes = picked.filter((c) => c.kind !== 'conflict')
  if (!changes.length) return
  const fresh = changes.filter(isNewFile).length
  const what = changes.length === 1 ? basename(changes[0].path) : plural(changes.length, 'file')
  let body = "Edits go back to the last commit and can't be recovered."
  if (fresh) body += ` ${plural(fresh, 'new file')} will be moved to the Trash.`
  if (await confirm({ heading: `Discard changes to ${what}?`, body, confirm: 'Discard', destructive: true })) {
    await runOp(repo, () => api.discard(repo, changes.map((c) => c.path)))
  }
}

/** Conflicts open in VS Code, tracked edits in the hunk view, anything else as a comparison. */
export function openChange(repo: string, state: RepoState, change: Change): void {
  const code = useStore.getState().capabilities.code
  if (change.kind === 'conflict' && code) void host.openInEditor(repo, change.path)
  else if (change.kind === 'tracked' && !state.status?.operation) openSheet({ kind: 'hunks', repo, file: change.path })
  else openSheet({
    kind: 'compare', title: basename(change.path), subtitle: `${basename(repo)} · ${change.path}`, filename: change.path,
    repo, source: { file: change.path },
  })
}

function Row({ repo, state, change, checked, onToggle }: {
  repo: string
  state: RepoState
  change: Change
  checked: boolean
  onToggle: (on: boolean) => void
}) {
  const l = letter(change)
  // A file git already tracks keeps being tracked after it's ignored, so "this file" untracks it too.
  const tracked = change.kind === 'tracked' && !'A?'.includes(change.x)
  const ignore = change.kind === 'conflict' ? [] : ignoreChoices(change).map(([text, pattern], i) => {
    const untrack = i === 0 && tracked ? [change.path] : []
    return {
      label: `${untrack.length ? 'Stop Tracking & Ignore' : 'Ignore'} ${text}`,
      onClick: () => void runOp(repo, () => api.ignore(repo, pattern, untrack)),
    }
  })
  const sections = [
    [{ label: 'Open Changes', onClick: () => openChange(repo, state, change) }],
    ignore,
    change.kind === 'conflict' ? [] : [{ label: 'Discard Changes…', danger: true, onClick: () => void confirmDiscard(repo, [change]) }],
  ]
  const dir = dirname(change.path)
  return (
    <ContextArea
      sections={sections}
      role="listitem"
      tabIndex={0}
      className="group flex h-[30px] items-center gap-2 rounded-md px-2 hover:bg-white/[0.04] focus-visible:bg-white/[0.06]"
      title={`${change.orig ? `${change.orig} → ${change.path}` : change.path}\nRight-click for more`}
      onClick={() => openChange(repo, state, change)}
      onKeyDown={(e) => e.key === 'Enter' && openChange(repo, state, change)}
    >
      <input type="checkbox" className="check" checked={checked} aria-label={`Commit ${change.path}`}
        onClick={(e) => e.stopPropagation()} onChange={(e) => onToggle(e.target.checked)} />
      <FileIcon path={change.path} />
      <span className="ellipsis flex-none max-w-[55%] text-[13px]">{basename(change.path)}</span>
      <span className="ellipsis-start flex-1 text-[11.5px] text-white/45"><bdi>{dir}</bdi></span>
      {isPartial(change) ? (
        <span className="text-[11px] text-accent-fg/80" title="Part of this file is staged: Commit takes only the staged part. Open it to stage or unstage hunks.">partial</span>
      ) : isStaged(change) ? <span className="text-[11px] text-accent-fg/80">staged</span> : null}
      {change.kind !== 'conflict' && (
        <button className="icon-btn sm opacity-0 group-hover:opacity-80 group-focus-within:opacity-80" title="Discard changes…" aria-label={`Discard changes to ${change.path}`}
          onClick={(e) => {
            e.stopPropagation()
            void confirmDiscard(repo, [change])
          }}>
          <Undo2 size={13} />
        </button>
      )}
      <span className={`status ${statusClass(l)}`} title={change.kind === 'conflict' ? 'Conflict' : undefined}>{l}</span>
    </ContextArea>
  )
}

export function Changes({ repo, state, selected }: { repo: string; state: RepoState | undefined; selected: Change[] }) {
  const changes = state?.status?.changes
  const excluded = useStore((s) => s.excluded[repo]) ?? []
  const all = useRef<HTMLInputElement>(null)
  const total = changes?.length ?? 0
  const n = selected.length

  useEffect(() => {
    if (!changes || !excluded.length) return
    const present = new Set(changes.map((c) => c.path))
    const kept = excluded.filter((p) => present.has(p))
    if (kept.length !== excluded.length) setExcluded(repo, kept)
  }, [changes, excluded, repo])

  useEffect(() => {
    if (all.current) all.current.indeterminate = n > 0 && n < total
  }, [n, total])

  const toggle = (path: string, on: boolean) => setExcluded(repo, on ? excluded.filter((p) => p !== path) : [...excluded, path])
  const stashes = state?.stashes ?? []

  return (
    <section className="flex flex-none flex-col" aria-label="Changes">
      <header className="flex items-center gap-2 border-t border-line px-3.5 pt-2 pb-1">
        <h3 className="section-title">Changes</h3>
        <span className="count">{total}</span>
        {!!stashes.length && (
          <span className="rounded-full bg-[#c061cb]/20 px-[7px] text-[10.5px] font-bold text-[#dc8add]"
            title={stashes.slice(0, 10).map((s) => s.split('\x1f').pop()).join('\n')}>
            {stashes.length} stashed
          </span>
        )}
        <span className="flex-1" />
        <button className="icon-btn sm" disabled={!selected.some((c) => c.kind !== 'conflict')} title="Discard checked changes…"
          aria-label="Discard checked changes" onClick={() => void confirmDiscard(repo, selected)}>
          <Undo2 size={14} />
        </button>
        <input ref={all} type="checkbox" className="check mr-[3px]" checked={total > 0 && n === total} disabled={!total}
          aria-label="Select all" title="Select all"
          onChange={(e) => setExcluded(repo, e.target.checked ? [] : (changes ?? []).map((c) => c.path))} />
      </header>
      <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1" role="list">
        {!changes ? <div className="px-2"><SkeletonRows n={2} lead="check" /></div> : !total ? (
          <p className="p-4 text-center text-[13px] text-white/45">Working tree clean</p>
        ) : (
          changes.slice(0, MAX_CHANGES).map((c) => (
            <Row key={c.path} repo={repo} state={state!} change={c} checked={!excluded.includes(c.path)} onToggle={(on) => toggle(c.path, on)} />
          ))
        )}
      </div>
    </section>
  )
}
