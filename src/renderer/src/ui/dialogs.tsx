// App-wide feedback: confirm and alert dialogs, toasts.

import type { ReactNode } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useStore } from '../store'

export function ConfirmDialog() {
  const c = useStore((s) => s.confirm)
  const close = (ok: boolean) => {
    c?.resolve(ok)
    useStore.setState({ confirm: null })
  }
  return (
    <AlertDialog.Root open={c !== null} onOpenChange={(open) => !open && close(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="modal-backdrop z-40" />
        <AlertDialog.Popup className="modal z-50 w-[420px] p-5">
          <AlertDialog.Title className="text-[15px] font-bold">{c?.heading}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13.5px] whitespace-pre-wrap text-white/70">{c?.body}</AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn" onClick={() => close(false)}>{c?.cancel ?? 'Cancel'}</button>
            <button className={c?.destructive ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)} autoFocus>
              {c?.confirm}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export function AlertBox() {
  const a = useStore((s) => s.alert)
  const close = () => useStore.setState({ alert: null })
  return (
    <AlertDialog.Root open={a !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="modal-backdrop z-40" />
        <AlertDialog.Popup className="modal z-50 w-[480px] max-w-[90vw] p-5">
          <AlertDialog.Title className="text-[15px] font-bold">{a?.heading}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 max-h-[50vh] overflow-auto font-mono text-[12px] whitespace-pre-wrap text-white/75 select-text">
            {a?.body}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end">
            <button className="btn btn-primary" onClick={close} autoFocus>OK</button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="rounded-full border border-white/10 bg-raised px-4 py-2 text-[13px] shadow-xl shadow-black/40">
          {t.message}
        </div>
      ))}
    </div>
  )
}

/** A large modal window for compare, hunks and full commits. Escape closes it. */
export function Sheet({ open, onClose, title, subtitle, actions, children }: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop z-40" />
        <Dialog.Popup className="modal z-50 flex h-[calc(100vh-56px)] w-[calc(100vw-56px)] max-w-[1500px] flex-col overflow-hidden">
          <div className="flex h-12 flex-none items-center gap-3 border-b border-line px-3">
            {actions}
            <div className="min-w-0 flex-1 text-center">
              <Dialog.Title className="ellipsis text-[13.5px] font-bold">{title}</Dialog.Title>
              {subtitle && <div className="ellipsis meta">{subtitle}</div>}
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close (Escape)" title="Close (Escape)">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
