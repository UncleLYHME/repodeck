"""Background `git fetch`, so new remote commits show up without pressing Fetch.

Fetching only updates remote-tracking refs; the file watchers then refresh the affected panels.
"""

import threading
import time

from gi.repository import GLib

from . import git

INTERVAL_SECONDS = 5 * 60
CHECK_SECONDS = 30
FIRST_CHECK_SECONDS = 5
PARALLEL = 2


class AutoFetcher:
    def __init__(self, panes, enabled):
        self.panes = panes  # callable returning the current panes
        self.enabled = enabled
        self.slots = threading.Semaphore(PARALLEL)
        GLib.timeout_add_seconds(FIRST_CHECK_SECONDS, self._first_tick)
        GLib.timeout_add_seconds(CHECK_SECONDS, self._tick)

    def _first_tick(self):
        self._tick()
        return GLib.SOURCE_REMOVE

    def _tick(self):
        if self.enabled:
            self.fetch(due_only=True)
        return GLib.SOURCE_CONTINUE

    def fetch(self, due_only=False):
        now = time.monotonic()
        for pane in self.panes():
            if pane.fetching or (due_only and now - pane.last_fetch < INTERVAL_SECONDS):
                continue
            pane.fetching = True
            behind = pane.status.behind if pane.status else 0
            threading.Thread(target=self._work, args=(pane, behind), daemon=True).start()

    def _work(self, pane, behind_before):
        with self.slots:
            error, fresh = None, None
            try:
                if git.background_fetch(pane.path):
                    fresh = git.status(pane.path)
            except Exception as e:  # offline, auth needed, timeout
                error = e
        GLib.idle_add(pane.fetch_finished, error, behind_before, fresh)
