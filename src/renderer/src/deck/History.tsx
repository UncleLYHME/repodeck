// Commit history: graph rows (virtualized) that expand in place to list the files each commit changed.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileText, Search } from 'lucide-react'
import type { CommitFile, LogRow } from '@shared/types'
import { continuation, laneCount, layout, type GraphRow } from '@shared/graph'
import { statusClass } from '@shared/changes'
import { basename, dirname } from '@shared/time'
import { api } from '../bridge'
import { openSheet, useStore } from '../store'
import { FileIcon } from '../ui/icons'
import { SkeletonRows } from '../ui/bits'
import { GraphCell } from './GraphCell'

const COMMIT_H = 28
const FILE_H = 26
const MAX_FILES = 500

// Commits never change, so their file lists are cached for the whole session.
const fileCache = new Map<string, CommitFile[]>()

type Item =
  | { kind: 'commit'; row: LogRow; graph: GraphRow }
  | { kind: 'file'; row: LogRow; file: CommitFile; graph: GraphRow }
  | { kind: 'note'; row: LogRow; text: string; graph: GraphRow }

export function History({ repo }: { repo: string }) {
  const rows = useStore((s) => s.histories[repo])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<{ sha: string; files?: CommitFile[]; error?: string } | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [fileHits, setFileHits] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()

  const graph = useMemo(() => layout((rows ?? []).map((r) => [r.fullSha, r.parents])), [rows])
  const lanes = useMemo(() => laneCount(graph), [graph])

  // File-name matches come from git (a pathspec search over the same commits).
  useEffect(() => {
    setFileHits(new Set())
    if (q.length < 2) return
    const timer = setTimeout(() => {
      void api.historySearch(repo, q).then((shas) => setFileHits(new Set(shas)), () => {})
    }, 200)
    return () => clearTimeout(timer)
  }, [repo, q])

  useEffect(() => {
    if (!expanded) return
    const cached = fileCache.get(`${repo}:${expanded}`)
    if (cached) {
      setFiles({ sha: expanded, files: cached })
      return
    }
    setFiles({ sha: expanded })
    let live = true
    api.commitFiles(repo, expanded).then(
      (found) => {
        fileCache.set(`${repo}:${expanded}`, found)
        if (live) setFiles({ sha: expanded, files: found })
      },
      (e) => live && setFiles({ sha: expanded, error: (e as Error).message }),
    )
    return () => {
      live = false
    }
  }, [repo, expanded])

  const items = useMemo(() => {
    const out: Item[] = []
    ;(rows ?? []).forEach((row, i) => {
      if (q && !(row.subject.toLowerCase().includes(q) || row.author.toLowerCase().includes(q) || row.fullSha.startsWith(q) || fileHits.has(row.fullSha))) return
      out.push({ kind: 'commit', row, graph: graph[i] })
      if (row.fullSha !== expanded) return
      const cont = continuation(graph[i])
      if (!files || files.sha !== row.fullSha || (!files.files && !files.error)) out.push({ kind: 'note', row, text: 'Loading files…', graph: cont })
      else if (files.error) out.push({ kind: 'note', row, text: `Could not list files: ${files.error}`, graph: cont })
      else if (!files.files!.length) out.push({ kind: 'note', row, text: 'No file changes', graph: cont })
      else {
        for (const file of files.files!.slice(0, MAX_FILES)) out.push({ kind: 'file', row, file, graph: cont })
        if (files.files!.length > MAX_FILES) out.push({ kind: 'note', row, text: `… and ${files.files!.length - MAX_FILES} more files`, graph: cont })
      }
    })
    return out
  }, [rows, graph, q, fileHits, expanded, files])

  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (items[i].kind === 'commit' ? COMMIT_H : FILE_H),
    overscan: 12,
  })

  const name = basename(repo)
  const openFile = (row: LogRow, file: CommitFile) => openSheet({
    kind: 'compare', title: basename(file.path), subtitle: `${name} · ${row.sha} · ${file.path}`, filename: file.path,
    repo, source: { sha: row.fullSha, file },
  })
  const showCommit = (row: LogRow) => openSheet({ kind: 'commit', repo, sha: row.fullSha, title: row.subject, subtitle: `${name} · ${row.sha} · ${row.author}` })

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="History">
      <header className="flex items-center gap-2 border-t border-line px-3.5 pt-2 pb-1">
        <h3 className="section-title">History</h3>
        <span className="count">{rows?.length ?? 0}</span>
        <button className="icon-btn sm ml-auto" data-active={searching || undefined} aria-pressed={searching}
          onClick={() => {
            setSearching(!searching)
            setQuery('')
          }} title="Search history" aria-label="Search history">
          <Search size={14} />
        </button>
      </header>
      {searching && (
        <div className="px-3 pb-1.5">
          <input className="field h-[30px]" placeholder="Message, author, hash or file name…" value={query} autoFocus
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setSearching(false), setQuery(''))}
            aria-label="Search history" />
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-1.5" role="list">
        {!rows ? <div className="px-1"><SkeletonRows n={6} /></div> : !items.length ? (
          <p className="p-4 text-center text-[13px] text-white/45">{rows.length ? 'No matching commits' : 'No commits yet'}</p>
        ) : (
          <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((v) => {
              const item = items[v.index]
              const style = { transform: `translateY(${v.start}px)`, height: v.size }
              const graphCell = !q && <GraphCell row={item.graph} lanes={lanes} height={v.size} />
              if (item.kind === 'commit') {
                const open = item.row.fullSha === expanded
                return (
                  <div key={v.key} role="listitem" style={style}
                    className={`absolute top-0 left-0 flex w-full items-center gap-1.5 rounded-md pr-1.5 ${open ? 'bg-accent/[0.14] shadow-[inset_0_0_0_1px_rgb(59_111_224/0.55)]' : 'hover:bg-white/[0.04]'}`}
                    title={`${item.row.sha}  ${item.row.subject}`}>
                    <button className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left" aria-expanded={open}
                      onClick={() => setExpanded(open ? null : item.row.fullSha)}>
                      {graphCell}
                      {item.row.refs.map(([kind, ref]) => <span key={kind + ref} className={`ref ref-${kind}`}>{ref}</span>)}
                      <span className="ellipsis flex-1 text-[13px]">{item.row.subject}</span>
                      <span className="ellipsis max-w-[40%] flex-none text-[11.5px] text-white/50">{item.row.author} · {item.row.when}</span>
                    </button>
                    {open && (
                      <button className="icon-btn sm" onClick={() => showCommit(item.row)} title="Show full commit" aria-label="Show full commit">
                        <FileText size={14} />
                      </button>
                    )}
                  </div>
                )
              }
              if (item.kind === 'file') {
                const dir = dirname(item.file.path)
                return (
                  <button key={v.key} role="listitem" style={style} onClick={() => openFile(item.row, item.file)}
                    className="absolute top-0 left-0 flex w-full items-center gap-1.5 rounded-md pr-1.5 text-left hover:bg-white/[0.04]"
                    title={item.file.orig ? `${item.file.orig} → ${item.file.path}` : item.file.path}>
                    {graphCell}
                    <span className="ml-2.5 flex min-w-0 flex-1 items-center gap-2">
                      <FileIcon path={item.file.path} size={14} />
                      <span className="ellipsis flex-none max-w-[55%] text-[12.5px]">{basename(item.file.path)}</span>
                      <span className="ellipsis-start flex-1 text-[11.5px] text-white/45"><bdi>{dir}</bdi></span>
                      <span className={`status ${statusClass(item.file.letter)}`}>{item.file.letter}</span>
                    </span>
                  </button>
                )
              }
              return (
                <div key={v.key} role="listitem" style={style} className="absolute top-0 left-0 flex w-full items-center gap-1.5">
                  {graphCell}
                  <span className="ml-2.5 text-[12px] text-white/45">{item.text}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
