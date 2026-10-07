// "Set identity…": pick a profile from ~/.gitconfig and its include files, or type one.

import { useEffect, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import type { Profile } from '@shared/types'
import { basename } from '@shared/time'
import { api } from '../bridge'
import { runOp, useStore } from '../store'

export function IdentityDialog() {
  const repo = useStore((s) => s.identityFor)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [choice, setChoice] = useState(-1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (!repo) return
    setName('')
    setEmail('')
    void api.profiles().then((found) => {
      setProfiles(found)
      // Preselect the profile named after a folder on this repo's path (e.g. …/Personal/app -> Personal).
      const parts = repo.toLowerCase().split('/')
      const i = Math.max(0, found.findIndex((p) => parts.includes(p.label.toLowerCase())))
      if (found.length) {
        setChoice(i)
        setName(found[i].name)
        setEmail(found[i].email)
      }
    })
  }, [repo])

  const close = () => useStore.setState({ identityFor: null })
  const save = async () => {
    if (!repo) return
    close()
    await runOp(repo, () => api.setIdentity(repo, name, email))
  }

  return (
    <Dialog.Root open={repo !== null} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop z-40" />
        <Dialog.Popup className="modal z-50 w-[440px] p-5">
          <Dialog.Title className="text-[15px] font-bold">Commit identity for {repo ? basename(repo) : ''}</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-[13px] text-white/65">
            Saved in this repository's own git config (user.name / user.email).
          </Dialog.Description>
          <form className="mt-4 flex flex-col gap-2" onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}>
            {profiles.length > 0 && (
              <select className="field" value={choice} aria-label="Profile" onChange={(e) => {
                const i = Number(e.target.value)
                setChoice(i)
                if (i >= 0) {
                  setName(profiles[i].name)
                  setEmail(profiles[i].email)
                }
              }}>
                {profiles.map((p, i) => <option key={i} value={i}>{p.label}: {p.email}</option>)}
                <option value={-1}>Custom</option>
              </select>
            )}
            <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <input className="field" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
