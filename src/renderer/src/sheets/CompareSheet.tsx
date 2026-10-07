// Compare two versions of a file: side by side (aligned, highlighted) or unified.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Chunk, MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { CompareTexts } from '@shared/types'
import { api } from '../bridge'
import { openSheet, useStore, type Sheet as SheetSpec } from '../store'
import { Sheet } from '../ui/dialogs'
import { languageFor, readOnly } from './codemirror'

type Spec = Extract<SheetSpec, { kind: 'compare' }>

function lines(text: string, from: number, to: number): number {
  if (to <= from) return 0
  const slice = text.slice(from, to)
  return slice.split('\n').length - (slice.endsWith('\n') ? 1 : 0)
}

function summarize(old: string, neu: string): { changes: number; added: number; removed: number } {
  const chunks = Chunk.build(Text.of(old.split('\n')), Text.of(neu.split('\n')))
  let added = 0
  let removed = 0
  for (const c of chunks) {
    added += lines(neu, c.fromB, c.toB)
    removed += lines(old, c.fromA, c.toA)
  }
  return { changes: chunks.length, added, removed }
}

export function CompareSheet({ spec }: { spec: Spec }) {
  const layout = useStore((s) => s.deck?.settings.diffLayout ?? 'side')
  const [texts, setTexts] = useState<CompareTexts | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const target = useRef<EditorView | null>(null)

  useEffect(() => {
    let live = true
    const src = spec.source
    const load = 'sha' in src ? api.compareCommit(spec.repo, src.sha, src.file) : api.compareWorking(spec.repo, src.file)
    load.then((t) => live && setTexts(t), (e) => live && setTexts({ old: '', new: '', error: `Could not read this file: ${(e as Error).message}` }))
    return () => {
      live = false
    }
  }, [spec])

  const identical = texts && !texts.error && texts.old === texts.new
  const stats = texts && !texts.error && !identical ? summarize(texts.old, texts.new) : null

  useEffect(() => {
    if (!texts || texts.error || identical || !host.current) return
    let destroyed = false
    let destroy = () => {}
    void languageFor(spec.filename).then((language) => {
      if (destroyed || !host.current) return
      const extensions = [readOnly, language]
      if (layout === 'side') {
        const view = new MergeView({
          a: { doc: texts.old, extensions },
          b: { doc: texts.new, extensions },
          parent: host.current,
          highlightChanges: true,
          gutter: true,
        })
        view.dom.style.height = '100%'
        target.current = view.b
        destroy = () => view.destroy()
      } else {
        const view = new EditorView({
          doc: texts.new,
          extensions: [extensions, unifiedMergeView({ original: texts.old, mergeControls: false, highlightChanges: true, gutter: true })],
          parent: host.current,
        })
        target.current = view
        destroy = () => view.destroy()
      }
      requestAnimationFrame(() => target.current && goToNextChunk(target.current))
    })
    return () => {
      destroyed = true
      target.current = null
      destroy()
    }
  }, [texts, identical, layout, spec.filename])

  const jump = (step: number) => {
    const view = target.current
    if (view) (step > 0 ? goToNextChunk : goToPreviousChunk)(view)
  }

  const setLayout = (value: 'side' | 'unified') => void api.setSetting('diffLayout', value)
  const ready = !!stats

  const actions = (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg bg-white/[0.06] p-0.5" role="group" aria-label="Layout">
        {(['side', 'unified'] as const).map((v) => (
          <button key={v} className={`h-7 rounded-md px-3 text-[12.5px] font-semibold ${layout === v ? 'bg-white/[0.12]' : 'text-white/60'}`}
            aria-pressed={layout === v} disabled={!ready} onClick={() => setLayout(v)}>
            {v === 'side' ? 'Side by Side' : 'Unified'}
          </button>
        ))}
      </div>
      {stats && <span className="meta">{stats.changes} change{stats.changes === 1 ? '' : 's'} · +{stats.added} −{stats.removed}</span>}
      <div className="flex">
        <button className="icon-btn" onClick={() => jump(-1)} disabled={!ready} title="Previous change (Alt+Up)" aria-label="Previous change"><ChevronUp size={16} /></button>
        <button className="icon-btn" onClick={() => jump(1)} disabled={!ready} title="Next change (Alt+Down)" aria-label="Next change"><ChevronDown size={16} /></button>
      </div>
    </div>
  )

  return (
    <Sheet open onClose={() => openSheet(null)} title={spec.title} subtitle={spec.subtitle} actions={actions}>
      <div className="h-full" onKeyDown={(e) => {
        if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault()
          jump(e.key === 'ArrowDown' ? 1 : -1)
        }
      }}>
        {!texts ? (
          <div className="grid h-full place-items-center"><span className="spinner h-7 w-7" /></div>
        ) : texts.error || identical ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-[17px] font-bold">{texts.error ?? 'No differences'}</p>
              {!texts.error && <p className="mt-1 text-white/55">Both versions are identical.</p>}
            </div>
          </div>
        ) : (
          <div ref={host} className="h-full overflow-hidden [&_.cm-mergeView]:h-full [&_.cm-editor]:h-full" />
        )}
      </div>
    </Sheet>
  )
}
