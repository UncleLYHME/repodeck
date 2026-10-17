# Restore: repodeck

- **What it is:** RepoDeck, an Electron desktop app giving a bird's-eye view of several git repositories. A desktop tool, **not a deployed service** (no Coolify app, no container, no domain).
- **Where it exists:**
  - GitHub `UncleLYHME/repodeck` (public). Installers are built by GitHub Actions and published as Releases (latest verified: v2.2.6, with AppImage, `.deb`, `.dmg`, `.exe`).
  - Harbor: source checkout `/root/Documents/projects/Personal/repodeck`, installed with `./install.sh` (`~/.local/bin/repodeck`, menu entry `dev.foundry.RepoDeck.desktop`).
  - Foundry: `repodeck` 2.2.6 `.deb` installed (`/opt/RepoDeck`).
  - CI: `ci.yml` and `release.yml` use the self-hosted runner `actions-runner@repodeck.service` on Foundry (account `ghrunner`, `/srv/ghrunner/runners/repodeck`), except fork PRs, which use GitHub-hosted runners.
- **URL:** https://github.com/UncleLYHME/repodeck/releases/latest

## Depends on
- GitHub (Releases; `gh` CLI for some features). No database, server, env vars or secrets; no `services/apps/repodeck` SOPS file (none needed).
- User settings (added folders, preferences) are in `~/.config/RepoDeck` on Linux (present on Harbor). They are **not** in any state stream; re-add folders with **Add Folder** after a rebuild.

## Backups
- Code: GitHub plus BufferDaddy bare mirror `/volume1/backups/git-mirrors/repodeck.git` (nightly 2:30 AM, verified present 2026-10-17). Released installers stay in GitHub Releases.
- Env/data: none to restore beyond optional local preferences.

## Restore steps
1. Easiest: download the installer for your OS from the latest Release (`.AppImage` or `.deb` on Linux, `.dmg` on macOS, `.exe` on Windows). macOS: right-click, **Open** (unsigned).
2. From source on Linux (Harbor):
```sh
gh repo clone UncleLYHME/repodeck /root/Documents/projects/Personal/repodeck
cd /root/Documents/projects/Personal/repodeck && ./install.sh   # deps, first build, `repodeck` command and menu entry; safe to re-run
```
3. Click **Add Folder** and re-add your repositories.
4. CI runner (only if Foundry is rebuilt): re-create `actions-runner@repodeck` per homelab `services/github-runner/README.md`. Unverified: that README says `register.sh` refuses public repos, yet a `repodeck` runner exists, so it was registered by hand; until it is back, jobs that target `[self-hosted, foundry]` queue and releases stall.

## Verify
```sh
ls ~/.local/bin/repodeck
gh release view -R UncleLYHME/repodeck --json tagName -q .tagName
```
Launch it and confirm it lists your repositories.

## Gotchas
- Every push to `main` that passes CI **and changes the app** (`src`, `data`, `build`, `package.json`, `pnpm-lock.yaml`, builder config) cuts a release. Docs-only pushes such as this guide do not.
- The checkout rebuilds itself when files change and keeps the last good build if a build fails.
- No telemetry; it only touches repositories you add.
