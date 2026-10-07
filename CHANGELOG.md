# Changelog

## 2.1.0 — 2026-10-06

- RepoDeck now comes as an installer for Linux (AppImage and .deb), macOS (Apple Silicon and Intel) and Windows, published on GitHub Releases.
- Installed copies keep themselves up to date: Windows and the AppImage download new versions in the background and restart into them with one click; the macOS app and the .deb offer the download.
- Motion that tells you what's happening: the refresh button spins until everything has been re-read, new changes and notifications slide in, counts pulse when they change, folders animate open and closed, and charts grow in. Reduced-motion settings are respected.
- Works with the paths, PATH and login items of macOS and Windows, and Home lists running dev servers on macOS too.
- Clearer message when the GitHub CLI isn't signed in.
- The old GTK version has been removed.

## 2.0.0 — 2026-10-06

- RepoDeck is now an Electron app (React and TypeScript), the first step to running on macOS and Windows too. Everything from 1.x is here: Home, project analytics, the Projects deck, Activity, Preferences, background fetch and auto-pull, compare, hunks, branches, stash and ignore.
- Your folders, settings and activity log carry over; `repodeck`, the app-menu entry and Start on Login now open the new app.
- Much lighter while it sits open: near-zero CPU when idle and less memory than the GTK version.
- Works on small screens too (say, over RDP from a phone): the window opens inside the visible desktop, and in narrow windows the sidebar becomes a drawer and cards stack.
- History draws only the rows on screen, so long histories scroll smoothly; Home's running services show the program (node, python3) instead of a thread name.
- The first start after this update builds the app, which takes a few seconds. The GTK version is still available with `REPODECK_LEGACY=1 python3 -m repodeck`.

## 1.1.0 — 2026-10-06

- Side-by-side compare with syntax highlighting, aligned lines and changed words highlighted; a Unified view is one click away.
- Right-click a changed file to ignore it, all files with its extension, or its folder.
- New Activity page: what RepoDeck did automatically and for you, with filters, search and a problems badge.
- New Preferences window (Ctrl+,): fetch interval, auto-pull per folder, update checks, banner motion, compare layout, and clearing the cache or activity log.
- Menus no longer crash under screen readers or automation (works around a GTK 4.14 bug), and sidebar rows have accessible names.

## 1.0.1 — 2026-10-06

- The Home greeting and headline sit on a translucent strip, readable over any sky.

## 1.0.0 — 2026-10-06

- First versioned release: Home dashboard with a time-of-day banner, per-project analytics, the Projects deck of repository panels, background fetch and auto-pull, caching, and lazy-loaded history.
- RepoDeck now tells you when a new version is available and restarts into it with one click.
