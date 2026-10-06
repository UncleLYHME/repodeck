"""Thin wrapper around the git CLI. Calls block; run them off the UI thread."""

import hashlib
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ENV = {
    **os.environ,
    "GIT_TERMINAL_PROMPT": "0",  # never hang waiting for credentials
    "GIT_OPTIONAL_LOCKS": "0",  # polling `status` must not fight VS Code for index.lock
    "GIT_LITERAL_PATHSPECS": "1",  # file names are paths, not globs
}
LOG_LIMIT = 300
NETWORK_TIMEOUT = 120
# Background fetches must fail rather than pop up a password, passphrase or host-key prompt.
# Credential helpers and a running ssh-agent still work.
QUIET_ENV = {"GIT_ASKPASS": "true", "SSH_ASKPASS_REQUIRE": "never"}
SEP = "\x1f"


OPERATION_MARKERS = [("merge", "MERGE_HEAD"), ("rebase", "rebase-merge"), ("rebase", "rebase-apply"),
                     ("cherry-pick", "CHERRY_PICK_HEAD"), ("revert", "REVERT_HEAD"), ("bisect", "BISECT_LOG")]


class GitError(Exception):
    pass


@dataclass
class Change:
    path: str
    x: str  # index status ("." when unchanged)
    y: str  # worktree status
    kind: str = "tracked"  # tracked | untracked | conflict
    orig: str | None = None  # rename/copy source

    @property
    def letter(self):
        if self.kind == "untracked":
            return "U"
        if self.kind == "conflict":
            return "!"
        return self.y if self.y != "." else self.x

    @property
    def staged(self):
        return self.kind == "tracked" and self.x != "."

    @property
    def partial(self):
        """Some changes staged, more on top in the working tree: committing takes only the staged part."""
        return self.staged and self.y != "."


@dataclass
class Status:
    branch: str = ""
    oid: str = ""
    upstream: str | None = None
    ahead: int = 0
    behind: int = 0
    operation: str | None = None  # merge, rebase, cherry-pick, revert, bisect in progress
    changes: list[Change] = field(default_factory=list)

    @property
    def has_commits(self):
        return self.oid not in ("", "(initial)")

    @property
    def merging(self):
        return self.operation == "merge"

    @property
    def can_fast_forward(self):
        return bool(self.upstream and self.behind and not self.ahead and not self.operation
                    and self.branch != "(detached)")


@dataclass
class LogRow:
    sha: str
    full_sha: str
    parents: list[str]
    refs: list[tuple[str, str]]  # (kind, name)
    subject: str
    author: str
    when: str


def run(repo, *args, check=True, timeout=None, env=None, input=None):
    p = subprocess.run(
        ["git", "-c", "core.quotepath=off", "-C", str(repo), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**ENV, **(env or {})}, timeout=timeout,
        **({"input": input} if input is not None else {"stdin": subprocess.DEVNULL}),
    )
    if check and p.returncode != 0:
        raise GitError((p.stderr or p.stdout).strip() or f"git {args[0]} failed")
    return p.stdout


def fingerprint(repo):
    """Changes whenever commits, branches, tags, remote-tracking refs, the stash or HEAD change.

    Data derived from history (logs, stats) stays valid while this is unchanged; working-tree
    edits don't affect it. Tool-private refs (e.g. refs/t3/*) are left out: they churn constantly."""
    refs = run(repo, "for-each-ref", "--format=%(objectname) %(HEAD) %(refname)",
               "refs/heads", "refs/remotes", "refs/tags", "refs/stash")
    head = run(repo, "rev-parse", "-q", "--verify", "HEAD", check=False)
    return hashlib.sha1((refs + head).encode()).hexdigest()


def toplevel(path):
    """Return the repository root containing `path`, or None."""
    try:
        return run(path, "rev-parse", "--show-toplevel").strip() or None
    except (GitError, OSError):
        return None


def child_repos(folder):
    """Repositories directly inside a folder of projects."""
    try:
        return sorted(str(d) for d in Path(folder).iterdir() if d.is_dir() and (d / ".git").exists())
    except OSError:
        return []


def find_repos(folder):
    """A repo itself, or the repos directly inside a folder of projects."""
    root = toplevel(folder)
    return [root] if root else child_repos(folder)


def status(repo):
    out = run(repo, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all")
    st = Status()
    recs = out.split("\0")
    i = 0
    while i < len(recs):
        r = recs[i]
        i += 1
        if not r:
            continue
        kind = r[0]
        if kind == "#":
            key, _, val = r[2:].partition(" ")
            if key == "branch.head":
                st.branch = val
            elif key == "branch.oid":
                st.oid = val
            elif key == "branch.upstream":
                st.upstream = val
            elif key == "branch.ab":
                a, b = val.split()
                st.ahead, st.behind = int(a), -int(b)
        elif kind == "1":
            p = r.split(" ", 8)
            st.changes.append(Change(p[8], p[1][0], p[1][1]))
        elif kind == "2":
            p = r.split(" ", 9)
            st.changes.append(Change(p[9], p[1][0], p[1][1], orig=recs[i]))
            i += 1
        elif kind == "u":
            p = r.split(" ", 10)
            st.changes.append(Change(p[10], p[1][0], p[1][1], kind="conflict"))
        elif kind == "?":
            st.changes.append(Change(r[2:], "?", "?", kind="untracked"))
    git_dir = run(repo, "rev-parse", "--absolute-git-dir").strip()
    st.operation = next((op for op, marker in OPERATION_MARKERS if (Path(git_dir) / marker).exists()), None)
    return st


def parse_refs(decoration, remotes):
    refs = []
    for part in (s.strip() for s in decoration.split(",")):
        if not part or part.endswith("/HEAD"):
            continue
        if part.startswith("HEAD -> "):
            refs.append(("head", part[8:]))
        elif part == "HEAD":
            refs.append(("head", "HEAD"))
        elif part.startswith("tag: "):
            refs.append(("tag", part[5:]))
        elif part.split("/", 1)[0] in remotes:
            refs.append(("remote", part))
        else:
            refs.append(("branch", part))
    return refs


def log(repo, st):
    if not st.has_commits:
        return []
    remotes = set(run(repo, "remote").split())
    fmt = SEP.join(["%h", "%H", "%P", "%D", "%an", "%ar", "%s"])
    # --date-order keeps every child above its parents, which the lane layout relies on.
    out = run(repo, "log", "--date-order", f"-n{LOG_LIMIT}",
              "--branches", "--remotes", "--tags", "HEAD", f"--format={fmt}")
    rows = []
    for line in out.splitlines():
        sha, full, parents, deco, author, when, subject = line.split(SEP, 6)
        rows.append(LogRow(sha, full, parents.split(), parse_refs(deco, remotes), subject, author, when))
    return rows


def show(repo, sha):
    return run(repo, "show", "--stat", "--patch", "--format=fuller", sha)


@dataclass(frozen=True)
class CommitFile:
    path: str
    letter: str  # M A D R C T
    orig: str | None = None  # rename/copy source


# Merges list what they brought in relative to the branch they were merged into.
COMMIT_DIFF = ["--format=", "-M", "--diff-merges=first-parent"]


def commit_files(repo, sha):
    recs = run(repo, "show", *COMMIT_DIFF, "--name-status", "-z", sha).split("\0")
    files, i = [], 0
    while i < len(recs):
        code = recs[i]
        i += 1
        if not code:
            continue
        if code[0] in "RC":
            files.append(CommitFile(recs[i + 1], code[0], orig=recs[i]))
            i += 2
        else:
            files.append(CommitFile(recs[i], code[0]))
            i += 1
    return files


def commit_file_diff(repo, sha, f):
    paths = [f.orig, f.path] if f.orig else [f.path]
    return run(repo, "show", *COMMIT_DIFF, sha, "--", *paths)


def commit(repo, st, message, changes):
    """Commit exactly the selected files, leaving everything else as it was."""
    if not message.strip():
        raise GitError("Write a commit message first.")
    if not changes:
        raise GitError("Select at least one file to commit.")
    paths = []
    for c in changes:
        if c.orig:
            paths.append(c.orig)
        paths.append(c.path)
    if st.merging:
        # Git refuses partial commits during a merge: stage the selection, commit the index.
        run(repo, "add", "-A", "--", *paths)
        return run(repo, "commit", "-m", message)
    return _commit_selection(repo, st, message, changes, paths)


def _commit_selection(repo, st, message, changes, paths):
    """Like `git commit --only`, but partially staged files contribute their staged version.

    A temporary index starts from HEAD and receives just the selection; after committing, the
    real index is reset for those paths only, so other staged work and unstaged remainders stay."""
    real_index = run(repo, "rev-parse", "--path-format=absolute", "--git-path", "index").strip()
    with tempfile.TemporaryDirectory(prefix="repodeck-") as tmp:
        env = {"GIT_INDEX_FILE": os.path.join(tmp, "index")}
        run(repo, "read-tree", "HEAD" if st.has_commits else "--empty", env=env)
        whole = []
        for c in changes:
            if not c.partial:
                whole += [c.orig, c.path] if c.orig else [c.path]
                continue
            if c.orig:
                run(repo, "rm", "--cached", "-q", "--ignore-unmatch", "--", c.orig, env=env)
            entry = run(repo, "ls-files", "-s", "--", c.path, env={"GIT_INDEX_FILE": real_index}).split()
            run(repo, "update-index", "--add", "--cacheinfo", f"{entry[0]},{entry[1]},{c.path}", env=env)
        if whole:
            run(repo, "add", "-A", "--", *whole, env=env)
        out = run(repo, "commit", "-m", message, env=env)
    run(repo, "reset", "-q", "--", *paths)
    return out


def fetch(repo, st):
    return run(repo, "fetch", "--all", "--prune", timeout=NETWORK_TIMEOUT)


def background_fetch(repo):
    """Fetch without any prompts. Returns False when the repo has no remotes."""
    if not run(repo, "remote").split():
        return False
    run(repo, "fetch", "--all", "--prune", "--quiet", timeout=60, env=QUIET_ENV)
    return True


def pull(repo, st):
    return run(repo, "pull", "--ff-only", timeout=NETWORK_TIMEOUT)


def fast_forward(repo):
    """Move the branch up to its already-fetched upstream. Local only; refuses anything but a fast-forward.

    Uncommitted changes are kept; git refuses (changing nothing) if incoming commits touch those files."""
    return run(repo, "merge", "--ff-only", "--quiet", "@{upstream}")


def _rebase_onto_upstream(repo):
    try:
        run(repo, "rebase", "--autostash", "@{upstream}")
    except GitError as e:
        if status(repo).operation == "rebase":
            run(repo, "rebase", "--abort", check=False)
        raise GitError("Your local commits conflict with new commits on the remote, so nothing was pushed "
                       f"and your branch was left as it was. Pull and resolve the conflict manually.\n\n{e}") from e


def push(repo, st):
    """Push, first bringing in any new remote commits so the push is never rejected for being behind."""
    if not st.upstream:
        return run(repo, "push", "-u", "origin", "HEAD", timeout=NETWORK_TIMEOUT)
    run(repo, "fetch", "--quiet", timeout=NETWORK_TIMEOUT)
    fresh = status(repo)
    if fresh.operation:
        raise GitError(f"A {fresh.operation} is in progress; finish or abort it before pushing.")
    if fresh.behind:
        if fresh.ahead:
            _rebase_onto_upstream(repo)  # replay unpushed commits on top of the remote's
        else:
            fast_forward(repo)
    return run(repo, "push", timeout=NETWORK_TIMEOUT)
