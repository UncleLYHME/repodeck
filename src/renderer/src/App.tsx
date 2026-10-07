import { useEffect, useState } from 'react'
import { FolderPlus, ListCollapse, ListTree, Menu as MenuIcon, PanelLeft, RefreshCw } from 'lucide-react'
import { basename } from '@shared/time'
import { api, host, isMac, keys } from './bridge'
import { addFolders, chooseFolders, fetchAllNow, refreshNow, showPage, useStore } from './store'
import { useSpin } from './ui/motion'
import { Sidebar } from './Sidebar'
import { MenuButton } from './ui/menu'
import { AlertBox, ConfirmDialog, Toasts } from './ui/dialogs'
import { HomePage } from './home/HomePage'
import { ProjectsPage } from './deck/ProjectsPage'
import { ProjectPage } from './project/ProjectPage'
import { ActivityPage } from './activity/ActivityPage'
import { Preferences } from './prefs/Preferences'
import { UpdatePopup } from './UpdatePopup'
import { Sheets } from './sheets/Sheets'
import { IdentityDialog } from './deck/IdentityDialog'

const TITLES = { home: 'Home', projects: 'Projects', activity: 'Activity', project: '' }

function Header({ narrow }: { narrow: boolean }) {
  const page = useStore((s) => s.page)
  const projectPath = useStore((s) => s.projectPath)
  const anyOpen = useStore((s) => s.deck?.groups.some((g) => g.expanded) ?? false)
  const title = page === 'project' && projectPath ? basename(projectPath) : TITLES[page]
  const refreshing = useStore((s) => s.refreshing > 0)
  const spin = useSpin(refreshing)
  return (
    <header
      className={`drag flex h-[46px] flex-none items-center gap-2 border-b border-line ${narrow && isMac() ? 'pl-[78px]' : 'pl-3'}`}
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 10px)' }}
    >
      {narrow && (
        <button className="icon-btn" onClick={() => useStore.setState({ sideOpen: true })} title="Show the sidebar" aria-label="Show the sidebar">
          <PanelLeft size={17} />
        </button>
      )}
      <button className="btn btn-flat" onClick={() => void chooseFolders()} title={`Add a repository or a folder of repositories (${keys('Ctrl+O')})`}
        aria-label="Add Folder">
        <FolderPlus size={16} /> {!narrow && 'Add Folder'}
      </button>
      <div className="min-w-0 flex-1 text-center">
        <h1 className="ellipsis text-[14px] font-bold">{title}</h1>
        {page === 'project' && <div className="meta -mt-0.5">Project analytics</div>}
      </div>
      {page === 'projects' && (
        <button className="icon-btn" onClick={() => void api.toggleAll()} title={anyOpen ? 'Collapse all folders' : 'Expand all folders'}
          aria-label={anyOpen ? 'Collapse all folders' : 'Expand all folders'}>
          {anyOpen ? <ListCollapse size={17} /> : <ListTree size={17} />}
        </button>
      )}
      <MenuButton
        label="Main menu"
        icon={<MenuIcon size={17} />}
        sections={[
          [{ label: 'Fetch All Now', onClick: () => void fetchAllNow() }],
          [
            { label: 'Activity', onClick: () => showPage('activity') },
            { label: 'Preferences', onClick: () => useStore.setState({ prefsOpen: true }) },
          ],
        ]}
      />
      <button className="icon-btn" onClick={() => void refreshNow()} title={refreshing ? 'Refreshing…' : 'Refresh all (F5)'}
        aria-label="Refresh all" aria-busy={refreshing}>
        <RefreshCw size={16} {...spin} />
      </button>
    </header>
  )
}

function Page() {
  const page = useStore((s) => s.page)
  const project = useStore((s) => s.projectPath)
  const view = page === 'projects' ? <ProjectsPage /> : page === 'project' ? <ProjectPage /> : page === 'activity' ? <ActivityPage /> : <HomePage />
  return <div key={page === 'project' ? `project:${project}` : page} className="page-in h-full">{view}</div>
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void chooseFolders()
      } else if (e.key === 'F5' || (ctrl && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        void refreshNow()
      } else if (ctrl && e.key === ',') {
        e.preventDefault()
        useStore.setState({ prefsOpen: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Drop folders anywhere on the window to add them. */
function useDrop(): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setOver(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setOver(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => host.pathForFile(f)).filter(Boolean)
      void addFolders(paths)
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
  return over
}

/** True while the window is narrower than `px` (phones over RDP, split screens). */
function useNarrow(px: number): boolean {
  const query = `(max-width: ${px - 1}px)`
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return narrow
}

export function App() {
  const ready = useStore((s) => s.ready)
  const sideOpen = useStore((s) => s.sideOpen)
  const narrow = useNarrow(820)
  useShortcuts()
  const dropping = useDrop()
  return (
    <div className={`grid h-full ${narrow ? 'grid-cols-1' : 'grid-cols-[224px_minmax(0,1fr)]'}`}>
      {!narrow && <Sidebar />}
      {narrow && sideOpen && (
        <>
          <div className="modal-backdrop fade-in z-40" onClick={() => useStore.setState({ sideOpen: false })} />
          <div className="drawer fixed inset-y-0 left-0 z-50 flex w-[260px] shadow-2xl shadow-black/60"
            onKeyDown={(e) => e.key === 'Escape' && useStore.setState({ sideOpen: false })}>
            <div className="grid w-full"><Sidebar /></div>
          </div>
        </>
      )}
      <main className="flex min-h-0 min-w-0 flex-col">
        <Header narrow={narrow} />
        <div className="@container relative min-h-0 flex-1">{ready ? <Page /> : null}</div>
      </main>
      {dropping && (
        <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent/10">
          <p className="rounded-full bg-raised px-5 py-2.5 font-semibold">Drop folders to add them</p>
        </div>
      )}
      <Toasts />
      <UpdatePopup />
      <Sheets />
      <IdentityDialog />
      <Preferences />
      <ConfirmDialog />
      <AlertBox />
    </div>
  )
}
