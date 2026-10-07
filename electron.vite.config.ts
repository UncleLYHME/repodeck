import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// bin/repodeck builds into out.next and swaps it in, so a failed build never replaces a working one.
const out = process.env.REPODECK_OUT || 'out'

// A checkout compares this with its HEAD to know when an update is waiting for a restart.
function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export default defineConfig({
  main: {
    define: { __BUILD_COMMIT__: JSON.stringify(commit()) },
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
