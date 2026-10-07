// The desktop session a RepoDeck process draws on. A RepoDeck left running in an older remote-desktop
// (xrdp) session would answer a launch from a new one by showing its window where nobody can see it,
// so a launch passes its session along and the running copy moves over when they differ.

const KEYS = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_SESSION_ID', 'XDG_SESSION_TYPE', 'XRDP_SESSION'] as const
export type SessionEnv = Partial<Record<(typeof KEYS)[number], string>>

export function sessionEnv(env: NodeJS.ProcessEnv = process.env): SessionEnv {
  return Object.fromEntries(KEYS.filter((k) => typeof env[k] === 'string' && env[k]).map((k) => [k, env[k]]))
}

/** The launching session when it's on another display than ours (Linux; macOS and Windows have one desktop). */
export function otherSession(ours: SessionEnv, data: unknown): SessionEnv | null {
  const theirs = (data as { session?: unknown } | null)?.session
  if (!theirs || typeof theirs !== 'object') return null
  const env = sessionEnv(theirs as NodeJS.ProcessEnv)
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null
  return env.DISPLAY !== ours.DISPLAY || env.WAYLAND_DISPLAY !== ours.WAYLAND_DISPLAY ? env : null
}

/** Make this process (and what it starts next) belong to `env`'s session. */
export function adoptSession(env: SessionEnv, target: NodeJS.ProcessEnv = process.env): void {
  for (const k of KEYS) {
    if (env[k]) target[k] = env[k]
    else delete target[k]
  }
}
