// Commit message (multi-line), Commit / Commit & Push, and the identity the commit will use.

import { ChevronDown } from 'lucide-react'
import type { Change, RepoState } from '@shared/types'
import { api } from '../bridge'
import { runOp, setDraft, useStore } from '../store'
import { MenuButton } from '../ui/menu'

export async function commit(repo: string, picked: Change[], push: boolean): Promise<void> {
  const s = useStore.getState()
  const message = (s.drafts[repo] ?? '').trim()
  if (!picked.length || !message || s.repos[repo]?.busy) return
  const ok = await runOp(repo, () => api.commit(repo, message, picked.map((c) => c.path)))
  if (!ok) return
  setDraft(repo, '')
  if (push) await runOp(repo, () => api.push(repo)) // a separate step, so a failed push still reports the commit
}

export function CommitBox({ repo, state, selected }: { repo: string; state: RepoState | undefined; selected: Change[] }) {
  const draft = useStore((s) => s.drafts[repo] ?? '')
  const n = selected.length
  const ok = n > 0 && !!draft.trim() && !state?.busy
  const id = state?.identity
  const missing = id !== null && id !== undefined && !(id.name && id.email)

  return (
    <div className="flex flex-col gap-1 px-3 pb-2">
      <div className="flex items-start gap-1.5">
        <textarea
          className="field min-h-[38px] max-h-[150px] flex-1 resize-none py-2 leading-[1.35] [field-sizing:content]"
          placeholder="Message (Ctrl+Enter to commit)"
          aria-label="Commit message"
          value={draft}
          onChange={(e) => setDraft(repo, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void commit(repo, selected, e.shiftKey)
            }
          }}
        />
        <div className="flex">
          <button className="btn btn-primary h-[38px] rounded-r-none pr-2.5" disabled={!ok} onClick={() => void commit(repo, selected, false)}
            title="Commit the checked files (Ctrl+Enter)">
            {n ? `Commit ${n}` : 'Commit'}
          </button>
          <MenuButton
            label="More commit options"
            className="btn btn-primary h-[38px] rounded-l-none border-l border-black/25 px-1.5"
            icon={<ChevronDown size={15} />}
            sections={[[{ label: 'Commit & Push (Ctrl+Shift+Enter)', disabled: !ok, onClick: () => void commit(repo, selected, true) }]]}
          />
        </div>
      </div>
      {id && (
        <div className="flex items-center gap-1.5">
          <span className={`ellipsis flex-1 text-[11px] ${missing ? 'font-semibold text-busy' : 'text-white/45'}`}
            title={missing ? 'Git has no user.name/user.email for this repository.' : 'user.name / user.email from git config'}>
            {missing ? 'No git identity here: commits will fail' : `as ${id.name} <${id.email}>`}
          </span>
          {missing && (
            <button className="btn btn-flat h-[22px] px-2 text-[11.5px]" onClick={() => useStore.setState({ identityFor: repo })}>
              Set identity…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
