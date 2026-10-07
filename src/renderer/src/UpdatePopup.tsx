// Bottom-right card for RepoDeck's own updates:
//   available    "RepoDeck x is available"  Later | Update (or Download where it can't install itself)
//   downloading  progress bar               Hide
//   ready        "installs when you quit"   Later | Restart Now

import { useState } from 'react'
import { Download, RotateCw } from 'lucide-react'
import { basename } from '@shared/time'
import { host } from './bridge'
import { confirm, updateAction, useStore } from './store'

export function UpdatePopup() {
  const update = useStore((s) => s.update)
  const dismissed = useStore((s) => s.dismissed)
  const [busy, setBusy] = useState(false)
  if (!update?.version || !['available', 'downloading', 'ready'].includes(update.phase)) return null
  const key = `${update.phase}:${update.version}`
  if (dismissed.includes(key)) return null
  const later = () => useStore.setState((s) => ({ dismissed: [...s.dismissed, key] }))
  const checkout = update.source === 'checkout'

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
    await updateAction('restart') // RepoDeck quits here and starts the new version
    setBusy(false)
  }

  const title = update.phase === 'available' ? `RepoDeck ${update.version} is available`
    : update.phase === 'downloading' ? `Downloading RepoDeck ${update.version}…` : `RepoDeck ${update.version} is ready`

  return (
    <aside className="pop-in fixed right-[18px] bottom-[18px] z-30 flex w-[340px] flex-col gap-2 rounded-[14px] border border-accent/55 bg-pop px-4 pt-3.5 pb-3 shadow-[0_14px_40px_rgb(0_0_0/0.5)]"
      role="status" aria-label="RepoDeck update">
      <div className="flex items-center gap-2">
        {update.phase === 'ready' ? <RotateCw size={16} className="flex-none text-accent-fg" /> : <Download size={16} className="flex-none text-accent-fg" />}
        <h2 className="flex-1 font-bold">{title}</h2>
      </div>
      {update.phase === 'downloading' ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuenow={update.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${update.progress}%` }} />
          </div>
          <span className="meta w-9 text-right">{update.progress}%</span>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {(update.notes.length ? update.notes.slice(0, 3) : ['Bug fixes and improvements.']).map((n) => (
              <li key={n} className="line-clamp-2 text-[12.5px] text-white/75" title={n}>• {n}</li>
            ))}
          </ul>
          {!checkout && (
            <button className="self-start text-[12px] font-semibold text-accent-fg hover:underline"
              onClick={() => void host.openExternal(`https://github.com/UncleLYHME/repodeck/releases/tag/v${update.version}`)}>
              See everything new
            </button>
          )}
        </>
      )}
      {update.phase === 'ready' && (
        <p className="text-[12px] text-white/55">{checkout ? 'It starts the next time you open RepoDeck.' : 'It installs when you quit RepoDeck.'}</p>
      )}
      {update.error && update.phase === 'available' && <p className="text-[12px] whitespace-pre-wrap text-danger">{update.error}</p>}
      <div className="mt-1 flex justify-end gap-1.5">
        <button className="btn btn-flat" onClick={later}>{update.phase === 'downloading' ? 'Hide' : 'Later'}</button>
        {update.phase === 'available' && (
          <button className="btn btn-primary pill" onClick={() => void updateAction('download')}>{update.manual ? 'Download' : 'Update'}</button>
        )}
        {update.phase === 'ready' && (
          <button className="btn btn-primary pill" disabled={busy} onClick={() => void restart()}>
            {busy && <span className="spinner" />} Restart Now
          </button>
        )}
      </div>
    </aside>
  )
}
