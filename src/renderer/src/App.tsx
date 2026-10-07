import { useEffect, useState } from 'react'
import { FolderPlus, ListCollapse, ListTree, Menu as MenuIcon, RefreshCw } from 'lucide-react'
import { basename } from '@shared/time'
import { api, host } from './bridge'
import { addFolders, chooseFolders, refreshNow, showPage, useStore } from './store'
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

function Header() {
  const page = useStore((s) => s.page)
  const projectPath = useStore((s) => s.projectPath)
  const anyOpen = useStore((s) => s.deck?.groups.some((g) => g.expanded) ?? false)
  const title = page === 'project' && projectPath ? basename(projectPath) : TITLES[page]
  return (
    <header
      className="drag flex h-[46px] flex-none items-center gap-2 border-b border-line pl-3"
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 10px)' }}
    >
      <button className="btn btn-flat" onClick={() => void chooseFolders()} title="Add a repository or a folder of repositories (Ctrl+O)">
        <FolderPlus size={16} /> Add Folder
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
          [{ label: 'Fetch All Now', onClick: () => void api.fetchAll() }],
          [
            { label: 'Activity', onClick: () => showPage('activity') },
            { label: 'Preferences', onClick: () => useStore.setState({ prefsOpen: true }) },
          ],
        ]}
      />
      <button className="icon-btn" onClick={refreshNow} title="Refresh all (F5)" aria-label="Refresh all">
        <RefreshCw size={16} />
      </button>
    </header>
  )
}

function Page() {
  const page = useStore((s) => s.page)
  if (page === 'projects') return <ProjectsPage />
  if (page === 'project') return <ProjectPage />
  if (page === 'activity') return <ActivityPage />
  return <HomePage />
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
        refreshNow()
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

export function App() {
  const ready = useStore((s) => s.ready)
  useShortcuts()
  const dropping = useDrop()
  return (
    <div className="grid h-full grid-cols-[224px_minmax(0,1fr)]">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-col">
        <Header />
        <div className="relative min-h-0 flex-1">{ready ? <Page /> : null}</div>
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
