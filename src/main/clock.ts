// The 12- or 24-hour clock picked in the system's settings, for the "System" clock preference.

import { execFile } from 'node:child_process'

const read = (cmd: string, args: string[]) => new Promise<string>((resolve) =>
  execFile(cmd, args, { encoding: 'utf8', timeout: 2000, windowsHide: true }, (err, out) => resolve(err ? '' : out)))

/**
 * What a platform's clock setting says: true for 12-hour, false for 24-hour, undefined when it
 * doesn't say. `out` is `gsettings get … clock-format`, `defaults read -g`, or `reg query … sShortTime`.
 */
export function parseClock(platform: NodeJS.Platform, out: string): boolean | undefined {
  if (platform === 'darwin') {
    if (/AppleICUForce24HourTime = 1;/.test(out)) return false
    if (/AppleICUForce12HourTime = 1;/.test(out)) return true
    return undefined
  }
  if (platform === 'win32') {
    const format = /sShortTime\s+REG_SZ\s+(.+)/.exec(out)?.[1]
    return format ? /h|t/.test(format) : undefined // "h:mm tt" vs "HH:mm"
  }
  return /'12h'/.test(out) ? true : /'24h'/.test(out) ? false : undefined
}

/** Whether a locale ("en_US.UTF-8", "en-GB") writes times with AM/PM. */
export function localeHour12(locale: string): boolean {
  const opts = { hour: 'numeric' } as const
  try {
    return new Intl.DateTimeFormat(locale.replace(/[.@].*$/, '').replace('_', '-'), opts).resolvedOptions().hour12 ?? false
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).resolvedOptions().hour12 ?? false
  }
}

/** The system's clock setting, else what its region (`systemLocale` from Electron) uses. */
export async function systemHour12(systemLocale: string): Promise<boolean> {
  const p = process.platform
  let said: boolean | undefined
  if (p === 'darwin') said = parseClock(p, await read('defaults', ['read', '-g']))
  else if (p === 'win32') said = parseClock(p, await read('reg', ['query', 'HKCU\\Control Panel\\International', '/v', 'sShortTime']))
  // Other desktops can have the GNOME schema installed too, reporting its default rather than a choice.
  else if (/GNOME|Unity|Pantheon|Budgie/i.test(process.env.XDG_CURRENT_DESKTOP ?? '')) {
    said = parseClock(p, await read('gsettings', ['get', 'org.gnome.desktop.interface', 'clock-format']))
  }
  const env = process.env
  const posixLocale = p === 'linux' ? env.LC_ALL || env.LC_TIME || env.LANG : undefined
  return said ?? localeHour12(posixLocale || systemLocale)
}
