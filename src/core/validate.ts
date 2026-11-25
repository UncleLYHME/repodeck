// Checks for everything the page sends to the core. The page is RepoDeck's own, but what it passes
// is treated as untrusted: a wrong type, an unknown setting or an unexpected value is refused here,
// before it reaches git, the file system or the settings file.

import type { Settings } from '../shared/types'
import { commitHash } from './git/run'

/** What the page sent doesn't have the shape this call takes. */
export class Invalid extends Error {}

/** Returns the value with its type known, or throws `Invalid` naming the argument. */
export type Check<T> = (value: unknown, name: string) => T

type Spec = Record<string, Check<unknown>>
type Parsed<S extends Spec> = { [K in keyof S]: ReturnType<S[K]> }

export const text: Check<string> = (v, name) => {
  if (typeof v !== 'string') throw new Invalid(`${name} must be text.`)
  return v
}

export const flag: Check<boolean> = (v, name) => {
  if (typeof v !== 'boolean') throw new Invalid(`${name} must be true or false.`)
  return v
}

export const anything: Check<unknown> = (v) => v

/** A commit hash: hexadecimal only (see `commitHash`). */
export const hash: Check<string> = (v, name) => commitHash(text(v, name))

export const optional = <T>(check: Check<T>): Check<T | undefined> =>
  (v, name) => (v === undefined || v === null ? undefined : check(v, name))

export const list = <T>(check: Check<T>): Check<T[]> => (v, name) => {
  if (!Array.isArray(v)) throw new Invalid(`${name} must be a list.`)
  return v.map((item) => check(item, name))
}

export const oneOf = <T extends string>(...allowed: T[]): Check<T> => (v, name) => {
  if (typeof v !== 'string' || !(allowed as string[]).includes(v)) throw new Invalid(`${name} must be one of: ${allowed.join(', ')}.`)
  return v as T
}

/** A whole number from `min` to `max`. */
export const wholeNumber = (min: number, max: number): Check<number> => (v, name) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Invalid(`${name} must be a whole number from ${min} to ${max}.`)
  return v
}

export const record = <S extends Spec>(spec: S): Check<Parsed<S>> => (v, name) => parse(spec, v, name)

/**
 * The arguments of one call: only the named fields, each checked. A field that was left out stays
 * left out (a partial change must not read as "set to nothing"); no arguments at all reads as `{}`.
 */
export function parse<S extends Spec>(spec: S, raw: unknown, name = 'The request'): Parsed<S> {
  const given = raw ?? {}
  if (typeof given !== 'object' || Array.isArray(given)) throw new Invalid(`${name} must be an object.`)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(spec)) {
    const value = spec[key]((given as Record<string, unknown>)[key], key)
    if (value !== undefined) out[key] = value
  }
  return out as Parsed<S>
}

/** A handler whose arguments are checked against `spec` before it runs. */
export const checked = <S extends Spec, R>(spec: S, fn: (args: Parsed<S>) => R) => (raw: unknown): R => fn(parse(spec, raw))

// Every setting the page may change, with the values it may take. Background fetch can't be set to
// run more often than once a minute.
const SETTINGS: { [K in keyof Settings]: Check<Settings[K]> } = {
  autoFetch: flag,
  autoPull: flag,
  notify: flag,
  fetchMinutes: wholeNumber(1, 24 * 60),
  updateChecks: flag,
  autoUpdate: flag,
  bannerMotion: flag,
  diffLayout: oneOf('side', 'unified'),
  clock: oneOf('system', '12h', '24h'),
  autostart: flag,
}

/** A known setting and a value of its type, or `Invalid`. */
export function setting(key: unknown, value: unknown): { key: keyof Settings; value: Settings[keyof Settings] } {
  if (typeof key !== 'string' || !Object.hasOwn(SETTINGS, key)) throw new Invalid(`Unknown setting: ${String(key)}`)
  const known = key as keyof Settings
  return { key: known, value: SETTINGS[known](value, known) }
}
