// Release body for a version: its CHANGELOG.md section, else the user-facing commits since the last
// release. Usage: node scripts/release-notes.mjs <version> [previous tag]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { changelogSection, notesFromCommits } from '../src/shared/release.ts'

const version = (process.argv[2] ?? '').replace(/^v/, '')
const since = process.argv[3]
const section = changelogSection(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version)
if (section) {
  console.log(section)
} else {
  const range = since ? [`${since}..HEAD`] : ['-n', '30']
  const subjects = execFileSync('git', ['log', '--no-merges', '--format=%s', ...range], { encoding: 'utf8' }).split('\n')
  console.log(notesFromCommits(subjects))
}
