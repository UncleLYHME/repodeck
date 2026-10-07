// The big modal views: compare a file, stage hunks, read a full commit.

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { Hunk, HunkSet } from '@shared/types'
import { hunkPatch, hunkTitle } from '@shared/changes'
import { basename } from '@shared/time'
import { api } from '../bridge'
import { confirm, openSheet, showAlert, useStore, type Sheet as SheetSpec } from '../store'
import { Sheet } from '../ui/dialogs'
// CodeMirror loads only when a comparison is first opened.
const CompareSheet = lazy(() => import('./CompareSheet').then((m) => ({ default: m.CompareSheet })))

/** Colour a unified diff line. */
function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) return 'text-white/45'
  if (line.startsWith('+')) return 'bg-[rgb(63_185_80/0.13)] text-[#9be9a8]'
  if (line.startsWith('-')) return 'bg-[rgb(248_81_73/0.13)] text-[#ffaba8]'
  if (line.startsWith('@@')) return 'text-accent-fg'
  if (/^(commit|Author|AuthorDate|Commit|CommitDate|Merge):?/.test(line)) return 'text-white/80 font-semibold'
  return ''
}

const MAX_LINES = 20000

function DiffText({ text, skipFirst }: { text: string; skipFirst?: boolean }) {
  const all = text.split('\n')
  const shown = all.slice(skipFirst ? 1 : 0, MAX_LINES)
  return (
    <pre className="m-0 overflow-x-auto py-1 font-mono text-[12.5px] leading-[1.55] select-text">
      {shown.map((line, i) => <div key={i} className={`min-h-[1.55em] px-3 ${lineClass(line)}`}>{line}</div>)}
      {all.length > MAX_LINES && <div className="px-3 py-2 text-white/45">… {all.length - MAX_LINES} more lines</div>}
    </pre>
  )
}

function CommitSheet({ spec }: { spec: Extract<SheetSpec, { kind: 'commit' }> }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    void api.showCommit(spec.repo, spec.sha).then(setText, (e) => setText(`Could not load diff:\n${(e as Error).message}`))
  }, [spec])
  return (
    <Sheet open onClose={() => openSheet(null)} title={spec.title} subtitle={spec.subtitle}>
      <div className="h-full overflow-auto">{text === null ? <div className="grid h-full place-items-center"><span className="spinner h-7 w-7" /></div> : <DiffText text={text} />}</div>
    </Sheet>
  )
}

function HunkCard({ hunk, staged, onAct }: { hunk: Hunk; staged: boolean; onAct: (mode: 'stage' | 'unstage' | 'discard') => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-line py-1.5 pr-2 pl-3">
        <span className="ellipsis flex-1 font-mono text-[12px] text-accent-fg">{hunkTitle(hunk)}</span>
        {staged ? (
          <button className="chip-btn" onClick={() => onAct('unstage')}>Unstage</button>
        ) : (
          <>
            <button className="chip-btn danger" onClick={() => onAct('discard')}>Discard</button>
            <button className="chip-btn" onClick={() => onAct('stage')}>Stage</button>
          </>
        )}
      </div>
      <DiffText text={hunk.body} skipFirst />
    </div>
  )
}

function HunkSheet({ spec }: { spec: Extract<SheetSpec, { kind: 'hunks' }> }) {
  const [set, setSet] = useState<HunkSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = basename(spec.file)
  const load = useCallback(() => {
    api.hunks(spec.repo, spec.file).then((h) => {
      setSet(h)
      setError(null)
    }, (e) => setError((e as Error).message))
  }, [spec])
  useEffect(load, [load])

  const act = async (hunk: Hunk, mode: 'stage' | 'unstage' | 'discard') => {
    if (mode === 'discard') {
      const ok = await confirm({
        heading: 'Discard this change?', confirm: 'Discard', destructive: true,
        body: "These lines go back to their last committed or staged version. This can't be undone.",
      })
      if (!ok) return
    }
    try {
      await api.applyHunk(spec.repo, hunkPatch(hunk), mode)
    } catch (e) {
      showAlert("That didn't apply", (e as Error).message)
    }
    load()
  }

  const compare = () => openSheet({
    kind: 'compare', title: name, subtitle: `${basename(spec.repo)} · ${spec.file} · working tree vs last commit`,
    filename: spec.file, repo: spec.repo, source: { file: spec.file },
  })

  return (
    <Sheet open onClose={() => openSheet(null)} title={name} subtitle={`${basename(spec.repo)} · ${spec.file}`}
      actions={<button className="btn" onClick={compare} title="Compare the whole file with its last commit">Side by Side</button>}>
      <div className="h-full overflow-y-auto px-4 pt-3 pb-5">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-2.5">
          {error && <p className="text-white/55">Could not read the diff: {error}</p>}
          {!set && !error && <div className="grid h-40 place-items-center"><span className="spinner h-7 w-7" /></div>}
          {set && !set.unstaged.length && !set.staged.length && <p className="py-2 text-white/45">No text changes left in this file.</p>}
          {set && ([['Unstaged', set.unstaged, false], ['Staged', set.staged, true]] as const).map(([title, hunks, staged]) => hunks.length > 0 && (
            <div key={title} className="flex flex-col gap-2.5">
              <h3 className="section-title mt-1">{title} · {hunks.length}</h3>
              {hunks.map((h, i) => <HunkCard key={`${title}${i}${hunkTitle(h)}`} hunk={h} staged={staged} onAct={(mode) => void act(h, mode)} />)}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

export function Sheets() {
  const sheet = useStore((s) => s.sheet)
  if (!sheet) return null
  if (sheet.kind === 'compare') return <Suspense fallback={null}><CompareSheet key={JSON.stringify(sheet)} spec={sheet} /></Suspense>
  if (sheet.kind === 'hunks') return <HunkSheet key={sheet.repo + sheet.file} spec={sheet} />
  return <CommitSheet key={sheet.sha} spec={sheet} />
}
