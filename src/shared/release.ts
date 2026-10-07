// Release versions and notes: the automatic release on every push (.github/workflows/release.yml),
// and a checkout's own update notes. Plain, erasable TypeScript so the release scripts run it with Node.

/** "2.1.3" -> [2, 1, 3]; anything unparsable -> [0, 0, 0]. */
export function parse(version: string | null | undefined): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/**
 * The next release: package.json's version when it's ahead of the latest release (you bumped it
 * on purpose), otherwise the latest release's next patch.
 */
export function nextVersion(packageVersion: string, latestRelease: string | null | undefined): string {
  const pkg = parse(packageVersion)
  const latest = parse(latestRelease)
  if (cmp(pkg, latest) > 0) return pkg.join('.')
  return [latest[0], latest[1], latest[2] + 1].join('.')
}

/**
 * The release a commit is (or will be): its own release tag, or else the version the release
 * workflow gives it after the latest release before it. Checkouts use this to name themselves.
 */
export function releaseOf(packageVersion: string, tagsAtCommit: string[], latestBefore: string | null | undefined): string {
  const own = tagsAtCommit.map(parse).filter((v) => cmp(v, [0, 0, 0]) > 0).sort(cmp).pop()
  return own ? own.join('.') : nextVersion(packageVersion, latestBefore)
}

const SKIP = /^(ci|test|tests|docs|chore|build|style)(\(.*\))?!?:/i
const KIND = /^(\w+)(\(.*\))?!?:\s*/

/** Commit subjects -> release notes: user-facing kinds only, prefixes dropped, capitalised. */
export function noteLines(subjects: string[]): string[] {
  const bullets: string[] = []
  for (const raw of subjects) {
    const s = raw.trim()
    if (!s || SKIP.test(s) || /^Merge /.test(s)) continue
    const text = s.replace(KIND, '')
    const line = text.charAt(0).toUpperCase() + text.slice(1)
    if (!bullets.includes(line)) bullets.push(line)
  }
  return bullets
}

/** The same as a Markdown list for a release body. */
export function notesFromCommits(subjects: string[]): string {
  const lines = noteLines(subjects)
  return lines.length ? lines.map((b) => `- ${b}`).join('\n') : '- Small fixes and improvements.'
}

/** The CHANGELOG.md section for a version, or null. */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}\\b`).test(l))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim() || null
}
