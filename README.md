# RepoDeck

A small GTK4/libadwaita desktop app for Linux that shows source control for several git repositories side by side, like a grid of VS Code Source Control panels.

The window has a sidebar with **Home** and **Projects**, plus every project with a status dot (orange: uncommitted changes, blue: commits to push or pull).

Click a project in the sidebar for its **analytics page**: commits and lines changed over 30 days (with the change against the previous 30), current commit streak, all-time commits and contributors (one person's different names and emails merged), a 30-day activity chart, a weekday × hour heatmap of when commits happen, languages by size, most changed files (click to open in VS Code), branches with age and ahead/behind, open pull requests and the latest workflow runs, and recent commits. **Open Panel** jumps to the project's panel for committing; the page refreshes itself as the repository changes.

**Home** is a dashboard across all projects, under a pixel-art coast whose light follows the time of day: dawn (5–8), day (8–17), dusk (17–20) and night, cross-fading as the hour changes, with a matching greeting. Clouds drift, stars twinkle and the lighthouse beam pulses at dusk and night; the motion pauses while Home is hidden and stops entirely if the desktop asks for reduced animation. The layers live in `data/hero/<phase>/` (regenerate with `python3 tools/make_hero.py`).

- **Jump to a project…**: type part of a name, Enter opens it
- **Working now**: projects with uncommitted changes, branch and file counts
- **Git activity**: commits over the last 14 days across all projects (branches, remotes and tags; each commit counted once), lines added/removed, a daily bar chart (hover for the date)
- **Sync**: what needs pushing or pulling, pending pulls and failed fetches, with a Push button
- **Recent commits** and **Most active** projects
- **Pull requests** awaiting your review and your own open PRs, and **CI failures** (latest run per workflow and branch), through the `gh` CLI's existing login; refreshed every 5 minutes
- **Running services**: listening ports whose process runs inside a project (click to open in the browser), re-checked every 8 seconds while Home is shown

**Projects**: repositories are grouped into collapsible sections, one per folder. Click a folder header to open or close it; the header always shows a summary (repo count, which repos have changes, commits to push/pull). The list icon in the title bar collapses or expands every folder.

Each repository panel shows:

- the branch pill (click it to switch branch, check out a remote branch, or type a new name to create one) and ahead/behind counts against the upstream
- a multi-line commit message: **Commit N** (Ctrl+Enter) commits exactly the checked files and leaves everything else (including other staged work) untouched; its dropdown has **Commit & Push** (Ctrl+Shift+Enter)
- the identity the commit will use (`as Name <email>`); if git has none for the repo, a warning and **Set identity…**, which saves `user.name`/`user.email` in that repo's config (preselecting the `~/.gitconfig-*` profile named after a folder on the repo's path)
- changed files with checkboxes and a discard button (↶) per file or for all checked files; edits go back to the last commit, new files go to the Trash
- click a changed file to stage, unstage or discard it hunk by hunk; a file with only part staged shows **partial**, and Commit then takes only its staged part
- a banner while a merge, rebase, cherry-pick or revert is in progress, with **Abort…**; conflicted files open in VS Code
- a history graph of all local branches, remotes and tags, with branch/tag pills
- click a commit to open it in place: its files are listed under it with icons and status letters (M modified, A added, D deleted, R renamed); click a file for its diff in that commit, or the page button on the commit for the full patch. Merge commits list what they brought in. Click again to close.
- search history (🔍) by message, author, hash or the name of a file a commit touched
- history rows are built 40 at a time as you scroll (the graph is laid out for all 300 up front, so lanes stay consistent); shimmering skeleton rows mark what's still loading, here and in every card and panel before its first data arrives
- ⋮ menu: Fetch, Pull (fast-forward only), Push · Open on GitHub, Create Pull Request (opens GitHub's compare page) · Stash All Changes (including new files), Apply Latest Stash · Pin to Top, Open in Files, Open in VS Code, Remove
- pinned projects (★) sort first in their folder and in the sidebar

Everything is event-driven (inotify through `Gio.FileMonitor`); there is nothing to refresh by hand:

- editing, creating or deleting files, staging, committing, switching branches or fetching (from VS Code, a terminal, anywhere) updates the panel within a fraction of a second
- creating a project in a watched folder (`mkdir` + `git init`, or `git clone`) adds it to that folder's section; deleting or moving a project away removes it
- dropping folders onto the window adds them
- every 5 minutes (and shortly after launch) each repo with a remote is fetched in the background, two at a time; new upstream commits show as ↓N, in the graph, in the folder summary and as a toast
- the branch you are on is pulled automatically when its upstream has new commits (see below)

Background fetches only update remote-tracking branches, never your branches or files. They never prompt: credential helpers and a running ssh-agent work, anything that would need a password or host-key confirmation fails quietly and shows ⚠ next to the ahead/behind counts (hover for the reason). Turn it off, or fetch everything immediately, from the main menu (☰).

A quiet refresh every 60 seconds keeps relative dates current and catches anything missed. Very large repositories watch their first 4,000 directories.

## Run

Requires Python 3.10+, GTK 4.12+, libadwaita 1.5+ and PyGObject. On Ubuntu 24.04:

```sh
sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-adw-1   # already present on most desktops
./install.sh            # adds `repodeck` to ~/.local/bin and an app-menu entry
repodeck                # or launch "RepoDeck" from the app grid
repodeck ~/Documents/projects/Personal   # add a repo, or every repo inside a folder
```

Without installing: `python3 -m repodeck [FOLDER...]` from this directory.

**Add Folder** (Ctrl+O), or drag folders onto the window. A folder of projects becomes its own section and shows new projects automatically; a single repository joins the section for its parent folder without watching for siblings. A folder's ⋮ menu toggles **Show New Projects Automatically** or removes the whole section. Projects you remove by hand are remembered and not re-added. Refresh all with F5 or Ctrl+R. Folders, repos and open/closed state are saved in `~/.config/repodeck/repos.json`.

## Staying up to date

**Auto-pull** only ever touches the branch that is checked out. When its upstream has new commits and you have no unpushed commits on it, RepoDeck fast-forwards it. Other branches are never touched; switch to one and it is pulled then. Branches without an upstream, a detached HEAD, or a merge/rebase in progress are left alone.

- Uncommitted changes are kept. If incoming commits change a file you have edited, git refuses and nothing changes: the panel shows **pull pending** and retries by itself as soon as that file is committed or reverted.
- If you have unpushed commits *and* the remote has new ones, nothing happens in the background. The panel shows **syncs on push**.

**Push** (⋮ menu or Commit & Push) first fetches; if the remote has moved on it fast-forwards, or replays your unpushed commits on top of the remote's (`rebase --autostash`), then pushes. If that replay conflicts it is aborted, your branch is left exactly as it was, nothing is pushed, and you get an explanation.

Auto-pull can be switched off from the main menu (☰).

When the window is in the background, auto-pulls, newly fetched commits, new CI failures and new review requests arrive as desktop notifications (switch off in ☰). ☰ → **Start on Login** adds an XDG autostart entry.

## Caching

Results are cached in memory and in `~/.cache/repodeck/cache.json`, so the app starts with data on screen:

- History-derived data (the Home activity scan, project analytics, a panel's history graph and stash list) is keyed on a fingerprint of the repo's branches, tags, remote-tracking refs, stash and HEAD. Editing files doesn't touch it; a commit, fetch, checkout, branch or tag change recomputes just that repository. Tool-private refs (such as `refs/t3/*`) are ignored.
- A panel's identity and GitHub remote are re-read only when a git config file changes.
- GitHub answers (pull requests, CI, workflow runs) are reused for 2 minutes. Older data is still shown, with "Updated 3m ago" or "GitHub unreachable · showing data from …", while a fresh copy loads. F5 or the refresh button always asks GitHub again.
- Entries unused for 30 days are dropped. Deleting the file is always safe.

## Notes

- Git runs with `GIT_OPTIONAL_LOCKS=0`, so background polling doesn't contend with VS Code for `index.lock`.
- Fetch/Pull/Push from a panel's ⋮ menu can use your desktop's password prompt; background fetches never do. Manual network actions time out after 2 minutes, background fetches after 1.
- During a merge, Commit stages the checked files and commits the whole index, since git refuses partial merge commits.

## Tests

```sh
python3 -m unittest discover -s tests -t .
```
