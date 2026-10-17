# Restore: repodeck

- **What it is:** RepoDeck: Electron desktop app that gives a bird's-eye view of several git repositories. It is a desktop tool, not a deployed service.
- **Where it runs:** Nowhere as a service. Installers are built by GitHub Actions (self-hosted runner on Foundry) and published as GitHub Releases. A working checkout lives on Harbor and can run via `./install.sh`.
- **URL:** https://github.com/UncleLYHME/repodeck/releases/latest

## Depends on
- GitHub (releases, the `gh` CLI for some features). No database, no server, no env vars, no secrets.
- User settings (added folders, preferences) live in `~/.config/RepoDeck` on Linux. They are **not** in any state stream; re-add folders with **Add Folder** after a rebuild.

## Backups
- Code: GitHub `UncleLYHME/repodeck`; BufferDaddy nightly git mirror `/volume1/backups/git-mirrors/repodeck` (being set up; confirm it exists before relying on it). Released installers stay in GitHub Releases.
- Env: none.
- Data: no state stream (nothing to restore beyond optional local preferences).

## Restore steps (fresh host)
1. Easiest: download the installer for your OS from the latest GitHub Release (`.AppImage` or `.deb` on Linux, `.dmg` on macOS, installer on Windows). On macOS right-click and choose **Open** (the app is unsigned).
2. From source on Linux (what Harbor uses):
```sh
gh repo clone UncleLYHME/repodeck /root/Documents/projects/Personal/repodeck
cd /root/Documents/projects/Personal/repodeck
./install.sh            # installs deps, first build, `repodeck` command and menu entry; safe to re-run
```
3. Click **Add Folder** and re-add your repositories.
4. CI/releases: the workflows run on a self-hosted Foundry runner. If Foundry is rebuilt, re-register the `foundry`-labelled runner before expecting new releases.

## Verify
```sh
ls ~/.local/bin/repodeck      # command exists
gh release view -R UncleLYHME/repodeck --json tagName -q .tagName
```
Launch it and confirm it lists your repositories.

## Gotchas
- Every push to `main` that passes CI **and changes the app** (`src`, `data`, `build`, `package.json`, `pnpm-lock.yaml`, builder config) cuts a release. Docs-only pushes like this guide do not.
- The checkout rebuilds itself when files change and keeps the last good build if a build fails.
- No telemetry; it only touches repositories you add.
