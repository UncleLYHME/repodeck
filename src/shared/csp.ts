// The built page's content security policy, added to it as a <meta> tag at build time (see
// electron.vite.config.ts), ahead of everything the page loads.
//
// The page runs its own script files and nothing else (no inline script, no eval) and loads nothing
// over the network: all it shows comes from the core and main through the preload bridge. "Its own"
// is the address main serves the built page at (repodeck://app), which leads to no other file.
// Styles may be inline: CodeMirror and the UI components style elements while the page runs.
// data: images are the banner art and CodeMirror's markers, which are bundled into the scripts.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
