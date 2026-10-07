// Print the version the next automatic release gets: node scripts/next-version.mjs <latest release tag>
import { readFileSync } from 'node:fs'
import { nextVersion } from '../src/shared/release.ts'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
console.log(nextVersion(pkg, process.argv[2] ?? '0.0.0'))
