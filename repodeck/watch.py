"""Turn filesystem events (inotify via Gio.FileMonitor) into throttled callbacks.

inotify is not recursive, so a repository watcher keeps one monitor per non-ignored directory in
the working tree, plus the parts of .git that change on commit, checkout, staging and fetch.
"""

import os
import threading

from gi.repository import Gio, GLib

from . import git

MAX_DIRS = 4000  # per repository; GLib shares one inotify instance, the limit is watches
APPEARED = {Gio.FileMonitorEvent.CREATED, Gio.FileMonitorEvent.MOVED_IN}
GONE = {Gio.FileMonitorEvent.DELETED, Gio.FileMonitorEvent.MOVED_OUT}


class Throttle:
    """Run `fn` once, `delay_ms` after the first of a burst of calls."""

    def __init__(self, delay_ms, fn):
        self.delay_ms, self.fn, self.source = delay_ms, fn, 0

    def __call__(self):
        if not self.source:
            self.source = GLib.timeout_add(self.delay_ms, self._fire)

    def _fire(self):
        self.source = 0
        self.fn()
        return GLib.SOURCE_REMOVE

    def cancel(self):
        if self.source:
            GLib.source_remove(self.source)
            self.source = 0


class DirWatcher:
    """A set of non-recursive directory monitors reporting (path, appeared|gone|changed)."""

    def __init__(self, on_event):
        self.on_event = on_event
        self.monitors = {}

    def add(self, path):
        if path in self.monitors or len(self.monitors) >= MAX_DIRS:
            return
        try:
            monitor = Gio.File.new_for_path(path).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, None)
        except GLib.Error:
            return  # vanished or unreadable
        monitor.connect("changed", self._changed)
        self.monitors[path] = monitor

    def remove(self, path):
        monitor = self.monitors.pop(path, None)
        if monitor:
            monitor.cancel()

    def sync(self, paths):
        for path in set(self.monitors) - set(paths):
            self.remove(path)
        for path in paths:
            self.add(path)

    def close(self):
        for path in list(self.monitors):
            self.remove(path)

    def _changed(self, _monitor, file, other, event):
        if event == Gio.FileMonitorEvent.RENAMED:
            self.on_event(file.get_path(), "gone")
            self.on_event(other.get_path(), "appeared")
        elif event in APPEARED:
            self.on_event(file.get_path(), "appeared")
        elif event in GONE:
            self.on_event(file.get_path(), "gone")
        elif event != Gio.FileMonitorEvent.CHANGES_DONE_HINT:
            self.on_event(file.get_path(), "changed")


def _repo_dirs(repo):
    """Directories worth watching: .git state plus every non-ignored working-tree directory."""
    git_dir = git.run(repo, "rev-parse", "--absolute-git-dir").strip()
    common = git.run(repo, "rev-parse", "--path-format=absolute", "--git-common-dir").strip()
    meta = [git_dir, os.path.join(git_dir, "logs"), common]
    for root, _dirs, _files in os.walk(os.path.join(common, "refs")):
        meta.append(root)

    files = git.run(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0")
    # --directory also reports new, still-empty folders ("dir/") so files created in them are seen.
    files += git.run(repo, "ls-files", "-z", "--others", "--exclude-standard", "--directory").split("\0")
    tree = {repo}
    for f in files:
        parent = os.path.dirname(f.rstrip("/")) if not f.endswith("/") else f.rstrip("/")
        while parent and (full := os.path.join(repo, parent)) not in tree:
            tree.add(full)
            parent = os.path.dirname(parent)
    return list(dict.fromkeys(meta)), sorted(tree, key=len)  # shallow directories first


class RepoWatcher:
    """Calls `on_change` shortly after anything git would notice changes in a repository."""

    def __init__(self, repo, on_change):
        self.repo = repo
        self.on_change = Throttle(150, on_change)
        self.rescan = Throttle(400, self._start_scan)  # new folders need new monitors
        self.dirs = DirWatcher(self._event)
        self.closed = False
        self._start_scan()

    def _start_scan(self):
        def work():
            try:
                meta, tree = _repo_dirs(self.repo)
            except (git.GitError, OSError):
                return
            GLib.idle_add(self._install, meta + tree)

        threading.Thread(target=work, daemon=True).start()

    def _install(self, paths):
        if not self.closed:
            self.dirs.sync(paths)
            self.on_change()  # catch anything written while monitors were being set up

    def _event(self, path, kind):
        if path.endswith(".lock"):
            return  # git's temporary files; the rename that follows is the real change
        if kind == "appeared" and os.path.isdir(path) and not os.path.islink(path):
            self.rescan()
        elif kind == "gone":
            self.dirs.remove(path)
        self.on_change()

    def close(self):
        self.closed = True
        self.on_change.cancel()
        self.rescan.cancel()
        self.dirs.close()


class FolderWatcher:
    """Calls `on_change` when projects appear in, or vanish from, a folder of repositories."""

    def __init__(self, folder, on_change):
        self.folder = folder
        self.on_change = Throttle(400, on_change)
        self.dirs = DirWatcher(self._event)
        self.dirs.add(folder)
        try:
            children = [e.path for e in os.scandir(folder) if e.is_dir(follow_symlinks=False)]
        except OSError:
            children = []
        for child in children:  # to notice `git init` or a clone finishing inside a new project
            self.dirs.add(child)

    def _event(self, path, kind):
        if os.path.dirname(path) == self.folder:
            if kind == "appeared" and os.path.isdir(path):
                self.dirs.add(path)
            elif kind == "gone":
                self.dirs.remove(path)
            self.on_change()
        elif os.path.basename(path) == ".git":
            self.on_change()

    def close(self):
        self.on_change.cancel()
        self.dirs.close()
