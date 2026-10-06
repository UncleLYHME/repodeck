"""A small shared cache: in memory, persisted as JSON so the app starts with data on screen.

Two kinds of entry:
- versioned: valid while a version string matches (e.g. a repo's ref fingerprint), so derived
  git data is reused until a commit, fetch, checkout or branch change makes it stale;
- timed: valid for a TTL (network data such as GitHub), still returned past its TTL as
  "stale" so the UI can show the last known value while it revalidates.

Values must be JSON-serialisable. Entries unused for PRUNE_DAYS are dropped on load.
"""

import json
import os
import threading
import time
from pathlib import Path

from gi.repository import GLib

PATH = Path(GLib.get_user_cache_dir()) / "repodeck" / "cache.json"
FORMAT = 1  # bump when a cached value's shape changes
PRUNE_DAYS = 30
SAVE_DELAY = 2.0


class Cache:
    def __init__(self, path=PATH):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.entries = {}  # key -> {"v": version, "t": stored at, "used": last read, "data": value}
        self._save_timer = None
        self._load()

    def _load(self):
        try:
            raw = json.loads(self.path.read_text())
        except (OSError, ValueError):
            return
        if raw.get("format") != FORMAT:
            return
        cutoff = time.time() - PRUNE_DAYS * 86400
        self.entries = {k: e for k, e in raw.get("entries", {}).items() if e.get("used", 0) >= cutoff}

    def get(self, key, version=None, ttl=None):
        """(value, fresh) for a matching entry, else (None, False).

        With `version`, only an entry stored under that version matches. With `ttl`, an older
        entry still comes back, with fresh=False."""
        with self.lock:
            e = self.entries.get(key)
            if not e or (version is not None and e.get("v") != version):
                return None, False
            e["used"] = time.time()
            fresh = ttl is None or time.time() - e["t"] < ttl
            return e["data"], fresh

    def age(self, key):
        with self.lock:
            e = self.entries.get(key)
            return time.time() - e["t"] if e else None

    def put(self, key, value, version=None):
        now = time.time()
        with self.lock:
            self.entries[key] = {"v": version, "t": now, "used": now, "data": value}
        self._schedule_save()

    def drop(self, key):
        with self.lock:
            self.entries.pop(key, None)

    def _schedule_save(self):
        with self.lock:
            if self._save_timer:
                return
            self._save_timer = threading.Timer(SAVE_DELAY, self.save)
            self._save_timer.daemon = True
            self._save_timer.start()

    def save(self):
        with self.lock:
            self._save_timer = None
            payload = json.dumps({"format": FORMAT, "entries": self.entries}, separators=(",", ":"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(payload)
        os.replace(tmp, self.path)  # atomic: a crash never leaves a half-written cache


_shared = None


def shared():
    global _shared
    if _shared is None:
        _shared = Cache()
    return _shared
