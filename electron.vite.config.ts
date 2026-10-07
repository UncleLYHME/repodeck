import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { releaseOf } from './src/shared/release'

// bin/repodeck builds into out.next and swaps it in, so a failed build never replaces a working one.
const out = process.env.REPODECK_OUT || 'out'

const git = (...args: string[]): string => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}
// A checkout compares this with its HEAD to know when an update is waiting for a restart.
const commit = () => git('rev-parse', 'HEAD')
// The release this checkout is (package.json only says which minor it's on; releases stamp the patch).
const version = () => releaseOf(
  JSON.parse(readFileSync('package.json', 'utf8')).version,
  git('tag', '--points-at', 'HEAD', '--list', 'v[0-9]*').split('\n'),
  git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD'),
)

export default defineConfig({
  main: {
    define: { __BUILD_COMMIT__: JSON.stringify(commit()), __BUILD_VERSION__: JSON.stringify(version()) },
    build: {
      outDir: `${out}/main`,
      rollupOptions: {
        // The core (git, watchers, stats) runs in its own utility process, bundled next to main.
        input: { index: resolve('src/main/index.ts'), core: resolve('src/core/index.ts') },
      },
    },
  },
  preload: {
    build: { outDir: `${out}/preload` },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared'), '@data': resolve('data') } },
    build: { outDir: `${out}/renderer`, minify: true, chunkSizeWarningLimit: 1000, sourcemap: process.env.REPODECK_SOURCEMAP === '1' },
    plugins: [react(), tailwindcss()],
  },
})
