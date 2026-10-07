import { describe, expect, it } from 'vitest'
import { adoptSession, otherSession, sessionEnv } from '../src/main/session'

describe('desktop sessions', () => {
  const old = { DISPLAY: ':10.0', XRDP_SESSION: '1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/old' }
  const fresh = { DISPLAY: ':11.0', XRDP_SESSION: '2', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/new' }

  it('reports a launch from another remote-desktop display', () => {
    expect(otherSession(old, { session: fresh })).toEqual(fresh)
  })

  it('treats a launch from the same display, or without one (macOS, Windows, older copies), as ours', () => {
    expect(otherSession(old, { session: { ...old, XDG_SESSION_ID: '7' } })).toBeNull()
    expect(otherSession({}, { session: {} })).toBeNull()
    expect(otherSession(old, undefined)).toBeNull()
    expect(otherSession(old, { session: { DISPLAY: 10 } })).toBeNull()
  })

  it('switches to the new session, dropping what only the old one had', () => {
    const env: NodeJS.ProcessEnv = { ...old, WAYLAND_DISPLAY: 'wayland-0', HOME: '/root' }
    adoptSession(sessionEnv(fresh), env)
    expect(env).toEqual({ ...fresh, HOME: '/root' })
  })
})
