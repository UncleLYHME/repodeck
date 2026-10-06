"""Side-by-side comparison model: two versions of a file aligned row by row (no GTK here).

`align(old, new)` returns rows of (kind, left, right) where each side is (line_no, text,
changed_spans) or None for a filler row; kind is equal | delete | insert | replace.
Replaced line pairs carry character spans of what actually changed, for word-level highlights.
"""

import difflib
import re
from dataclasses import dataclass
from pathlib import Path

from . import git

MAX_BYTES = 1_500_000
TOKEN = re.compile(r"\w+|\s+|[^\w\s]")


@dataclass
class Row:
    kind: str
    left: tuple | None  # (line_no, text, [(start, end), ...]) or None
    right: tuple | None


def _spans(a, b):
    """Character spans that differ between two lines, compared token by token."""
    ta, tb = TOKEN.findall(a), TOKEN.findall(b)
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    sa, sb = [], []
    pos_a = [0]
    for t in ta:
        pos_a.append(pos_a[-1] + len(t))
    pos_b = [0]
    for t in tb:
        pos_b.append(pos_b[-1] + len(t))
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        if i2 > i1:
            sa.append((pos_a[i1], pos_a[i2]))
        if j2 > j1:
            sb.append((pos_b[j1], pos_b[j2]))
    return sa, sb


def align(old, new):
    a, b = old.splitlines(), new.splitlines()
    rows = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            rows += [Row("equal", (i + 1, a[i], []), (j + 1, b[j], [])) for i, j in zip(range(i1, i2), range(j1, j2))]
        elif op == "delete":
            rows += [Row("delete", (i + 1, a[i], []), None) for i in range(i1, i2)]
        elif op == "insert":
            rows += [Row("insert", None, (j + 1, b[j], [])) for j in range(j1, j2)]
        else:  # replace: pair lines in order, then pad the longer side
            for k in range(max(i2 - i1, j2 - j1)):
                i, j = i1 + k, j1 + k
                left = (i + 1, a[i], []) if i < i2 else None
                right = (j + 1, b[j], []) if j < j2 else None
                if left and right:
                    sa, sb = _spans(left[1], right[1])
                    left, right = (left[0], left[1], sa), (right[0], right[1], sb)
                rows.append(Row("replace", left, right))
    return rows


def change_starts(rows):
    """Row indexes where a run of changes begins (for next/previous change navigation)."""
    starts, prev = [], "equal"
    for i, r in enumerate(rows):
        if r.kind != "equal" and prev == "equal":
            starts.append(i)
        prev = r.kind
    return starts


# -- getting the two versions -------------------------------------------------------

class Unreadable(Exception):
    """Binary or too large to compare as text."""


def _check(text):
    if len(text) > MAX_BYTES:
        raise Unreadable("This file is too large to compare here.")
    if "\0" in text[:8000]:
        raise Unreadable("This is a binary file.")
    return text


def _show(repo, spec):
    return _check(git.run(repo, "show", spec, check=False))


def working_versions(repo, st, change):
    """(old, new) for a working-tree change: last commit vs the file on disk."""
    old = ""
    if st.has_commits and change.kind == "tracked" and change.x not in "A":
        old = _show(repo, f"HEAD:{change.orig or change.path}")
    path = Path(repo, change.path)
    try:
        new = _check(path.read_text(encoding="utf-8", errors="replace")) if path.is_file() else ""
    except OSError:
        new = ""
    return old, new


def commit_versions(repo, sha, f):
    """(old, new) for one file of a commit, against its first parent."""
    old = "" if f.letter == "A" else _show(repo, f"{sha}^:{f.orig or f.path}")
    new = "" if f.letter == "D" else _show(repo, f"{sha}:{f.path}")
    return old, new
