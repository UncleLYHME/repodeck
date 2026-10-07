// Bottom-right card when a new RepoDeck is ready: version, a few changelog lines, Later / Restart.

import { useState } from 'react'
import { Download } from 'lucide-react'
import { basename } from '@shared/time'
import { api } from './bridge'
import { confirm, useStore } from './store'

export function UpdatePopup() {
  const update = useStore((s) => s.update)
  const dismissed = useStore((s) => s.dismissed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!update || dismissed.includes(update.version)) return null
  const ready = update.source === 'disk'

  const restart = async () => {
    const drafts = Object.entries(useStore.getState().drafts).filter(([, text]) => text.trim()).map(([repo]) => basename(repo))
    if (drafts.length) {
      const ok = await confirm({
        heading: 'Restart with unsent commit messages?', confirm: 'Restart Anyway', destructive: true,
        body: `Commit messages you've typed in ${drafts.sort().join(', ')} will be lost.`,
      })
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      await api.applyUpdate() // the app quits and starts again from here
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  return (
    <aside className="pop-in fixed right-[18px] bottom-[18px] z-30 flex w-[340px] flex-col gap-2 rounded-[14px] border border-accent/55 bg-pop px-4 pt-3.5 pb-3 shadow-[0_14px_40px_rgb(0_0_0/0.5)]"
      role="status" aria-label="Update available">
      <div className="flex items-center gap-2">
        <Download size={16} className="flex-none text-accent-fg" />
        <h2 className="flex-1 font-bold">RepoDeck {update.version} is {ready ? 'ready' : 'available'}</h2>
      </div>
      <ul className="flex flex-col gap-1">
        {(update.notes.length ? update.notes.slice(0, 4) : ['Bug fixes and improvements.']).map((n) => (
          <li key={n} className="text-[12.5px] text-white/75">• {n}</li>
        ))}
      </ul>
      {error && <p className="text-[12px] whitespace-pre-wrap text-danger">{error}</p>}
      <div className="mt-1 flex justify-end gap-1.5">
        <button className="btn btn-flat" onClick={() => useStore.setState((s) => ({ dismissed: [...s.dismissed, update.version] }))}>Later</button>
        <button className="btn btn-primary pill" disabled={busy} onClick={() => void restart()}>
          {busy && <span className="spinner" />} {ready ? 'Restart Now' : 'Restart to Update'}
        </button>
      </div>
    </aside>
  )
}
