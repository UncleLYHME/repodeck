"""Self-update: notice a newer RepoDeck, apply it, relaunch.

RepoDeck runs from its git checkout, so a release is a commit that raises `__version__`
(with notes in CHANGELOG.md). A newer version can arrive two ways:
  disk    the checkout already has it (pulled in a terminal, or RepoDeck auto-pulled itself):
          only a restart is needed. Watched with a file monitor, so it shows up at once.
  remote  the upstream branch has it (checked by a quiet fetch every CHECK_SECONDS):
          applying fast-forwards the checkout first; anything else is refused, nothing changes.
"""

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from . import __version__, git

APP_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = "repodeck/__init__.py"
CHANGELOG = "CHANGELOG.md"
CHECK_SECONDS = int(os.environ.get("REPODECK_UPDATE_INTERVAL", 30 * 60))
VERSION_RE = re.compile(r'__version__\s*=\s*"([^"]+)"')


@dataclass
class Update:
    version: str
    source: str  # "disk" or "remote"
    notes: list  # changelog bullets for versions newer than the running one


def parse_version(text):
    m = VERSION_RE.search(text or "")
    return m.group(1) if m else None


def key(version):
    """'1.10.2' -> (1, 10, 2); anything unparsable sorts lowest."""
    try:
        return tuple(int(p) for p in version.split("."))
    except (AttributeError, ValueError):
        return ()


def newer(candidate, current):
    return bool(candidate) and key(candidate) > key(current)


def notes_since(changelog, current, limit=6):
    """Bullets from CHANGELOG sections ("## 1.2.0 — date") newer than `current`."""
    bullets, take = [], False
    for line in (changelog or "").splitlines():
        heading = re.match(r"^##\s+v?(\d+(?:\.\d+)*)", line)
        if heading:
            take = newer(heading.group(1), current)
        elif take and line.lstrip().startswith(("- ", "* ")):
            bullets.append(line.lstrip()[2:].strip())
    return bullets[:limit]


def _read_disk(name):
    try:
        return (APP_DIR / name).read_text()
    except OSError:
        return ""


def check(current=__version__, fetch=True):
    """The newest available Update, or None. Blocking (may fetch); run off the UI thread."""
    on_disk = parse_version(_read_disk(VERSION_FILE))
    if newer(on_disk, current):
        return Update(on_disk, "disk", notes_since(_read_disk(CHANGELOG), current))
    if not git.toplevel(APP_DIR):
        return None
    try:
        if fetch:
            git.background_fetch(APP_DIR)
        upstream = git.run(APP_DIR, "show", f"@{{upstream}}:{VERSION_FILE}", check=False)
    except (git.GitError, OSError, subprocess.SubprocessError):
        return None
    remote = parse_version(upstream)
    if newer(remote, current):
        notes = git.run(APP_DIR, "show", f"@{{upstream}}:{CHANGELOG}", check=False)
        return Update(remote, "remote", notes_since(notes, current))
    return None


def apply(update):
    """Bring the checkout to `update.version`. Raises GitError with a readable reason if it can't."""
    if update.source == "remote":
        try:
            git.fast_forward(APP_DIR)
        except git.GitError as e:
            raise git.GitError(
                "RepoDeck's own checkout couldn't be fast-forwarded (local commits, or uncommitted edits "
                f"to files the update changes). Nothing was changed.\n\n{e}") from e
    on_disk = parse_version(_read_disk(VERSION_FILE))
    if not newer(on_disk, __version__):
        raise git.GitError(f"Expected version {update.version} in the checkout but found {on_disk}.")


def relaunch_command():
    """How to start the app again from the same checkout, with the same interpreter."""
    return [sys.executable, "-m", "repodeck"]


def spawn_relaunch():
    """Start a helper that waits for this process to exit, then launches RepoDeck again.

    The new process can't start first: as a single-instance app it would just hand over to
    this one and quit."""
    env = dict(os.environ)
    rest = [p for p in env.get("PYTHONPATH", "").split(os.pathsep) if p and p != str(APP_DIR)]
    env["PYTHONPATH"] = os.pathsep.join([str(APP_DIR), *rest])  # no growth across repeated relaunches
    script = 'while kill -0 "$0" 2>/dev/null; do sleep 0.1; done; exec "$@"'
    subprocess.Popen(["sh", "-c", script, str(os.getpid()), *relaunch_command()], env=env, cwd=str(Path.home()),
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)
