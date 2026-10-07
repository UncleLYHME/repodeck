// Preferences (Ctrl+,): every setting in one place. Changes apply and save immediately.

import { useEffect, useState, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Database, RefreshCw, Settings2, X } from 'lucide-react'
import type { DataInfo, Settings, UpdateStatus } from '@shared/types'
import { ago, basename, plural } from '@shared/time'
import { api, host } from '../bridge'
import { showAlert, toast, updateAction, useStore } from '../store'
import { Switch } from '../ui/bits'
import { Picker } from '../ui/select'

const FETCH_MINUTES = [2, 5, 10, 15, 30, 60]
const DIFF_LAYOUTS = [['side', 'Side by Side'], ['unified', 'Unified']] as const
const PAGES = [['general', 'General', Settings2], ['sync', 'Sync', RefreshCw], ['data', 'Data', Database]] as const
type PageKey = (typeof PAGES)[number][0]

/** One line on where RepoDeck's own update stands. */
export function updateText(u: UpdateStatus | null): string {
  if (!u) return 'Not checked yet'
  const checked = u.checkedAt ? (ago(u.checkedAt / 1000) === 'now' ? 'checked just now' : `checked ${ago(u.checkedAt / 1000)} ago`) : ''
  switch (u.phase) {
    case 'checking': return 'Checking for updates…'
    case 'up-to-date': return `Up to date${checked ? ` · ${checked}` : ''}`
    case 'available': return `${u.version} is available`
    case 'downloading': return `Downloading ${u.version} · ${u.progress}%`
    case 'ready': return u.source === 'checkout' ? `${u.version} starts the next time you open RepoDeck` : `${u.version} installs when you quit RepoDeck`
    case 'error': return `Couldn't check for updates: ${u.error ?? 'unknown error'}`
    default: return 'Not checked yet'
  }
}

function UpdateButton({ update }: { update: UpdateStatus | null }) {
  const phase = update?.phase
  if (phase === 'available') return <button className="btn btn-primary" onClick={() => void updateAction('download')}>{update!.manual ? 'Download' : 'Update'}</button>
  if (phase === 'ready') return <button className="btn btn-primary" onClick={() => void updateAction('restart')}>Restart Now</button>
  return (
    <button className="btn" disabled={phase === 'checking' || phase === 'downloading'} onClick={() => void updateAction('check', true)}>
      {phase === 'checking' && <span className="spinner" />} Check Now
    </button>
  )
}

const size = (n: number) => (!n ? 'empty' : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-[13px] font-bold">{title}</h3>
        {description && <p className="meta mt-0.5">{description}</p>}
      </div>
      <div className="card divide-y divide-white/[0.06] overflow-hidden">{children}</div>
    </section>
  )
}

function Row({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[54px] items-center gap-3 px-3.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px]">{title}</div>
        {subtitle && <div className="meta ellipsis">{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

export function Preferences() {
  const open = useStore((s) => s.prefsOpen)
  const deck = useStore((s) => s.deck)
  const update = useStore((s) => s.update)
  const version = useStore((s) => s.version)
  const packaged = useStore((s) => s.packaged)
  const [page, setPage] = useState<PageKey>('general')
  const [info, setInfo] = useState<DataInfo | null>(null)

  useEffect(() => {
    if (open) void api.dataInfo().then(setInfo, () => {})
  }, [open, page])

  if (!deck) return null
  const s = deck.settings
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    void api.setSetting(key, value).catch((e) => showAlert(`Couldn't change ${key === 'autostart' ? 'Start on Login' : 'that setting'}`, (e as Error).message))
  const close = () => useStore.setState({ prefsOpen: false })

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop z-40" />
        <Dialog.Popup className="modal z-50 flex h-[min(640px,calc(100vh-80px))] w-[720px] max-w-[calc(100vw-60px)] flex-col overflow-hidden">
          <div className="flex h-12 flex-none items-center gap-2 border-b border-line px-3">
            <Dialog.Title className="flex-1 pl-1 text-[14px] font-bold">Preferences</Dialog.Title>
            <div className="flex rounded-lg bg-white/[0.06] p-0.5" role="tablist">
              {PAGES.map(([key, label, Icon]) => (
                <button key={key} role="tab" aria-selected={page === key} onClick={() => setPage(key)}
                  className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold ${page === key ? 'bg-white/[0.12]' : 'text-white/60'}`}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <div className="flex flex-1 justify-end">
              <Dialog.Close className="icon-btn" aria-label="Close"><X size={16} /></Dialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-5">
              {page === 'general' && (
                <>
                  <Group title="App">
                    <Row title="Start on Login" subtitle="Open RepoDeck when you sign in">
                      <Switch label="Start on Login" checked={s.autostart} onChange={(v) => set('autostart', v)} />
                    </Row>
                    <Row title="Desktop Notifications" subtitle="When RepoDeck is in the background: pulls, CI failures, reviews">
                      <Switch label="Desktop Notifications" checked={s.notify} onChange={(v) => set('notify', v)} />
                    </Row>
                  </Group>
                  <Group title="Updates">
                    <Row title={`RepoDeck ${version}`} subtitle={updateText(update)}>
                      <UpdateButton update={update} />
                    </Row>
                    <Row title="Check for Updates Automatically" subtitle="Every 15 minutes, and shortly after RepoDeck starts">
                      <Switch label="Check for Updates Automatically" checked={s.updateChecks} onChange={(v) => set('updateChecks', v)} />
                    </Row>
                    <Row title="Install Updates Automatically"
                      subtitle={update?.manual ? 'Not available for this install: updates open the download page'
                        : packaged ? 'Download new versions in the background and install them when you quit'
                        : 'Pull new versions in the background; they start the next time you open RepoDeck'}>
                      <Switch label="Install Updates Automatically" checked={s.autoUpdate && !update?.manual} disabled={update?.manual}
                        onChange={(v) => set('autoUpdate', v)} />
                    </Row>
                  </Group>
                  <Group title="Appearance">
                    <Row title="Animated Banner" subtitle="Drifting clouds, twinkling stars and the lighthouse beam on Home">
                      <Switch label="Animated Banner" checked={s.bannerMotion} onChange={(v) => set('bannerMotion', v)} />
                    </Row>
                    <Row title="Comparing Files" subtitle="How a file's changes open">
                      <Picker label="Comparing Files" value={s.diffLayout} options={DIFF_LAYOUTS} onChange={(v) => set('diffLayout', v)} />
                    </Row>
                  </Group>
                </>
              )}
              {page === 'sync' && (
                <>
                  <Group title="In the Background" description="Fetching only updates what RepoDeck knows about the remote. Pulling fast-forwards the branch you're on, never other branches.">
                    <Row title="Fetch Automatically">
                      <Switch label="Fetch Automatically" checked={s.autoFetch} onChange={(v) => set('autoFetch', v)} />
                    </Row>
                    <Row title="Fetch Every">
                      <Picker label="Fetch Every" value={FETCH_MINUTES.includes(s.fetchMinutes) ? s.fetchMinutes : 5}
                        options={FETCH_MINUTES.map((m) => [m, `${m} minutes`] as const)} onChange={(v) => set('fetchMinutes', v)} />
                    </Row>
                    <Row title="Pull Automatically" subtitle="Fast-forward only; your uncommitted changes are always kept">
                      <Switch label="Pull Automatically" checked={s.autoPull} onChange={(v) => set('autoPull', v)} />
                    </Row>
                  </Group>
                  <Group title="Pull Automatically In" description="Turn off for folders you'd rather pull by hand, such as work repositories.">
                    {!deck.groups.length && <Row title="No folders yet" subtitle="Add a folder from the Projects page."><span /></Row>}
                    {deck.groups.map((g) => (
                      <Row key={g.folder} title={basename(g.folder)} subtitle={`${g.folder} · ${plural(g.repos.length, 'repository')}`}>
                        <Switch label={`Pull automatically in ${basename(g.folder)}`} checked={g.autoPull} disabled={!s.autoPull}
                          onChange={(v) => void api.setGroup(g.folder, { autoPull: v })} />
                      </Row>
                    ))}
                  </Group>
                </>
              )}
              {page === 'data' && (
                <Group title="Stored on This Computer">
                  <Row title="Cache" subtitle={`Git and GitHub results · ${size(info?.cacheBytes ?? 0)}`}>
                    <button className="btn" onClick={() => void api.clearCache().then(() => {
                      toast('Cache cleared; it refills as you use RepoDeck')
                      void api.dataInfo().then(setInfo)
                    })}>Clear</button>
                  </Row>
                  <Row title="Activity Log" subtitle={`${plural(info?.activityEntries ?? 0, 'entry')} · ${size(info?.activityBytes ?? 0)}`}>
                    <button className="btn" onClick={() => void api.clearActivity().then(() => {
                      toast('Activity log cleared')
                      void api.dataInfo().then(setInfo)
                    })}>Clear</button>
                  </Row>
                  <Row title="Settings Folder" subtitle={info?.configDir}>
                    <button className="btn" onClick={() => info && void host.openPath(info.configDir)}>Open</button>
                  </Row>
                </Group>
              )}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
