"""The activity log: what RepoDeck did, on its own and for you.

Entries live in memory (newest last) and are appended to a JSON-lines file so the log
survives restarts; the file is rewritten to the newest KEEP entries when it grows past twice that.
"""

import json
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path

from gi.repository import GLib

PATH = Path(GLib.get_user_state_dir()) / "repodeck" / "activity.jsonl"
KEEP = 500

AUTO, YOU = "auto", "you"  # who acted: RepoDeck by itself, or you through RepoDeck
INFO, WARN, ERROR = "info", "warn", "error"


@dataclass
class Entry:
    ts: float
    message: str
    repo: str | None = None
    who: str = YOU
    level: str = INFO


class ActivityLog:
    def __init__(self, path=PATH):
        self.path = Path(path)
        self.entries = deque(maxlen=KEEP)
        self.listeners = []
        self.lock = threading.Lock()
        self._lines = 0
        try:
            lines = self.path.read_text().splitlines()
        except OSError:
            lines = []
        self._lines = len(lines)
        for line in lines[-KEEP:]:
            try:
                self.entries.append(Entry(**json.loads(line)))
            except (ValueError, TypeError):
                continue

    def add(self, message, repo=None, who=YOU, level=INFO):
        entry = Entry(time.time(), message, repo, who, level)
        with self.lock:
            self.entries.append(entry)
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                if self._lines >= 2 * KEEP:
                    self.path.write_text("".join(json.dumps(asdict(e)) + "\n" for e in self.entries))
                    self._lines = len(self.entries)
                else:
                    with self.path.open("a") as f:
                        f.write(json.dumps(asdict(entry)) + "\n")
                    self._lines += 1
            except OSError:
                pass  # the log is a convenience; never let it break an action
        for fn in list(self.listeners):
            GLib.idle_add(fn, entry)
        return entry

    def clear(self):
        with self.lock:
            self.entries.clear()
            self._lines = 0
            try:
                self.path.write_text("")
            except OSError:
                pass
        for fn in list(self.listeners):
            GLib.idle_add(fn, None)

    def subscribe(self, fn):
        """fn(entry) on the main loop for each new entry; fn(None) after clear()."""
        self.listeners.append(fn)


_shared = None


def shared():
    global _shared
    if _shared is None:
        _shared = ActivityLog()
    return _shared


def log(message, repo=None, who=YOU, level=INFO):
    return shared().add(message, repo, who, level)
