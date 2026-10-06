"""Working-tree operations beyond commit/sync: discard, hunks, branches, stash, abort, identity."""

import glob
import os
import time
from dataclasses import dataclass
from pathlib import Path

from gi.repository import Gio

from .git import GitError, run

DIFF = ["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"]


def trash(path):
    """Move a file to the desktop Trash (never deletes outright)."""
    Gio.File.new_for_path(path).trash(None)


# -- discard ----------------------------------------------------------------------

def discard(repo, st, changes, trash=trash):
    """Throw away changes: tracked files go back to HEAD, new files go to the Trash."""
    if any(c.kind == "conflict" for c in changes):
        raise GitError("Conflicted files can't be discarded here; abort the merge or resolve them first.")

    def bin_(path):
        full = os.path.join(repo, path)
        if os.path.lexists(full):
            trash(full)

    for c in changes:
        if c.kind == "untracked":
            bin_(c.path)
        elif not st.has_commits or c.x in "AC":  # new in the index: unstage, then bin the file
            run(repo, "rm", "--cached", "-q", "--ignore-unmatch", "--", c.path)
            bin_(c.path)
        elif c.orig and c.x == "R":
            run(repo, "restore", "--source=HEAD", "--staged", "--worktree", "--", c.orig)
            run(repo, "rm", "--cached", "-q", "--ignore-unmatch", "--", c.path)
            bin_(c.path)
        else:
            run(repo, "restore", "--source=HEAD", "--staged", "--worktree", "--", c.path)


# -- hunks ------------------------------------------------------------------------

@dataclass
class Hunk:
    header: str  # the file's diff header lines
    body: str  # "@@ ... @@" and its lines

    @property
    def patch(self):
        return self.header + self.body

    @property
    def title(self):
        return self.body.splitlines()[0]


def split_hunks(diff):
    lines = diff.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines) if line.startswith("@@")), len(lines))
    header, hunks, current = "".join(lines[:start]), [], []
    for line in lines[start:]:
        if line.startswith("@@") and current:
            hunks.append(Hunk(header, "".join(current)))
            current = []
        current.append(line)
    if current:
        hunks.append(Hunk(header, "".join(current)))
    return hunks


def hunks(repo, path, staged):
    return split_hunks(run(repo, *DIFF, *(["--cached"] if staged else []), "--", path))


def stage_hunk(repo, hunk):
    run(repo, "apply", "--cached", "--whitespace=nowarn", "-", input=hunk.patch)


def unstage_hunk(repo, hunk):
    run(repo, "apply", "--cached", "-R", "--whitespace=nowarn", "-", input=hunk.patch)


def discard_hunk(repo, hunk):
    run(repo, "apply", "-R", "--whitespace=nowarn", "-", input=hunk.patch)


# -- branches -----------------------------------------------------------------------

@dataclass
class Branches:
    current: str
    local: list  # [(name, upstream)] most recent first
    remote: list  # ["origin/feature"] with no local branch yet


def branches(repo):
    out = run(repo, "for-each-ref", "--sort=-committerdate",
              "--format=%(refname)\x1f%(refname:short)\x1f%(upstream:short)", "refs/heads", "refs/remotes")
    local, remote = [], []
    for line in out.splitlines():
        ref, short, upstream = line.split("\x1f")
        if ref.startswith("refs/heads/"):
            local.append((short, upstream))
        elif not ref.endswith("/HEAD") and "/" in short:
            remote.append(short)
    tracked = {u for _, u in local if u} | {n for n, _ in local}
    remote = [r for r in remote if r not in tracked and r.split("/", 1)[1] not in tracked]
    current = run(repo, "branch", "--show-current").strip()
    return Branches(current, local, remote)


def switch(repo, name):
    run(repo, "switch", "--no-guess", name)


def switch_remote(repo, remote_ref):
    run(repo, "switch", "-c", remote_ref.split("/", 1)[1], "--track", remote_ref)


def create_branch(repo, name):
    name = name.strip()
    if run(repo, "check-ref-format", "--branch", name, check=False).strip() != name:
        raise GitError(f"'{name}' isn't a valid branch name.")
    run(repo, "switch", "-c", name)


# -- ignore ---------------------------------------------------------------------------

def gitignore_escape(path):
    """A literal path as a .gitignore pattern (glob characters, leading #/!, trailing spaces escaped)."""
    out = "".join("\\" + ch if ch in "*?[\\" else ch for ch in path)
    if out[:1] in ("#", "!"):
        out = "\\" + out
    stripped = out.rstrip(" ")
    return stripped + "\\ " * (len(out) - len(stripped)) if stripped != out else out


def ignore_choices(change):
    """[(label, pattern)] offered for a changed file: the file, its extension, its folder."""
    p = Path(change.path)
    choices = [("This File", "/" + gitignore_escape(change.path))]
    if p.suffix:
        choices.append((f"All {p.suffix} Files", "*" + gitignore_escape(p.suffix)))
    if str(p.parent) != ".":
        choices.append((f"Folder {p.parent}/", "/" + gitignore_escape(str(p.parent)) + "/"))
    return choices


def ignore(repo, pattern, untrack=()):
    """Add `pattern` to the repo's .gitignore (once). Paths in `untrack` stop being tracked but stay on disk."""
    path = Path(repo, ".gitignore")
    text = path.read_text() if path.exists() else ""
    if pattern not in text.splitlines():
        if text and not text.endswith("\n"):
            text += "\n"
        path.write_text(text + pattern + "\n")
    if untrack:
        run(repo, "rm", "--cached", "-q", "-r", "--ignore-unmatch", "--", *untrack)


# -- stash, abort ---------------------------------------------------------------------

def stashes(repo):
    return [line for line in run(repo, "stash", "list", "--format=%gd\x1f%s").splitlines() if line]


# `stash -u` silently skips untracked files under GIT_LITERAL_PATHSPECS (git 2.43).
STASH_ENV = {"GIT_LITERAL_PATHSPECS": "0"}


def stash(repo):
    run(repo, "stash", "push", "--include-untracked", "-m", f"RepoDeck {time.strftime('%Y-%m-%d %H:%M')}",
        env=STASH_ENV)


def stash_pop(repo):
    run(repo, "stash", "pop", env=STASH_ENV)


ABORT = {"merge": ["merge", "--abort"], "rebase": ["rebase", "--abort"], "cherry-pick": ["cherry-pick", "--abort"],
         "revert": ["revert", "--abort"], "bisect": ["bisect", "reset"]}


def abort(repo, operation):
    run(repo, *ABORT[operation])


# -- identity ---------------------------------------------------------------------------

def identity(repo):
    """(name, email) git would commit with here; either may be empty."""
    def get(key):
        return run(repo, "config", "--get", key, check=False).strip()
    return get("user.name"), get("user.email")


def profiles():
    """Identities defined in the global config and ~/.gitconfig-* include files: [(label, name, email)]."""
    found = []
    for path in [os.path.expanduser("~/.gitconfig")] + sorted(glob.glob(os.path.expanduser("~/.gitconfig-*"))):
        name = run("/", "config", "-f", path, "--get", "user.name", check=False).strip()
        email = run("/", "config", "-f", path, "--get", "user.email", check=False).strip()
        if name and email and (name, email) not in [(n, e) for _, n, e in found]:
            label = Path(path).name.removeprefix(".gitconfig-").removeprefix(".") or "global"
            found.append((label.capitalize(), name, email))
    return found


def set_identity(repo, name, email):
    if not name.strip() or "@" not in email:
        raise GitError("Enter a name and an email address.")
    run(repo, "config", "--local", "user.name", name.strip())
    run(repo, "config", "--local", "user.email", email.strip())
