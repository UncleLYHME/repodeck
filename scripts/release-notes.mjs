// Print the CHANGELOG.md section for a version (the release body): node scripts/release-notes.mjs 2.1.0
import { readFileSync } from 'node:fs'

const version = (process.argv[2] ?? '').replace(/^v/, '')
const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split('\n')
const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}\\b`).test(l))
if (!version || start < 0) {
  console.error(`No "## ${version}" section in CHANGELOG.md`)
  process.exit(1)
}
const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
console.log(lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim())
