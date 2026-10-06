"""Analytics for one repository (the project page). Blocking; call off the UI thread."""

import re
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from . import cache, git
from .stats import GITHUB_TTL, _gh, github_slug

WINDOW = 90  # days of history read for activity, hot files, punchcard
BARS = 30  # days shown as bars
OTHER = "Other"
LANGUAGES = {
    ".py": "Python", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".css": "CSS", ".scss": "CSS", ".html": "HTML",
    ".htm": "HTML", ".md": "Markdown", ".mdx": "Markdown", ".json": "JSON", ".yml": "YAML", ".yaml": "YAML",
    ".sh": "Shell", ".bash": "Shell", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
    ".java": "Java", ".kt": "Kotlin", ".swift": "Swift", ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++",
    ".cs": "C#", ".sql": "SQL", ".vue": "Vue", ".svelte": "Svelte", ".toml": "TOML", ".svg": "SVG",
    ".lua": "Lua", ".dart": "Dart", ".ex": "Elixir", ".exs": "Elixir", ".tf": "Terraform",
}
SPECIAL_NAMES = {"Dockerfile": "Docker", "Makefile": "Make"}
SKIP_LANG = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".lock", ".woff", ".woff2", ".ttf", ".pdf", ".mp4"}


@dataclass
class ProjectStats:
    days: list = field(default_factory=list)  # [(date, commits)] last BARS days
    commits_30: int = 0
    commits_prev_30: int = 0
    added_30: int = 0
    deleted_30: int = 0
    streak: int = 0
    punchcard: Counter = field(default_factory=Counter)  # (weekday 0=Mon, hour) -> commits, last WINDOW days
    hot_files: list = field(default_factory=list)  # [(path, commits, churn)]
    authors: list = field(default_factory=list)  # [(name, commits)] all time
    total_commits: int = 0
    first_commit: float = 0
    languages: list = field(default_factory=list)  # [(language, bytes)] top 7 + Other
    branches: list = field(default_factory=list)  # [(name, last commit ts, track, is_current)]
    recent: list = field(default_factory=list)  # [(ts, subject, author, short sha)]


def _windowed(repo, st, today):
    s = ProjectStats()
    start = today - timedelta(days=WINDOW - 1)
    out = git.run(repo, "log", "--branches", "--remotes", "--tags", "--no-merges",
                  f"--since={start.isoformat()} 00:00", "--format=\x1e%H\x1f%at\x1f%an\x1f%s", "--numstat")
    per_day, files, churn, seen = Counter(), Counter(), Counter(), set()
    for block in out.split("\x1e")[1:]:
        head, _, numstat = block.partition("\n")
        sha, ts, author, subject = head.split("\x1f", 3)
        if sha in seen:
            continue
        seen.add(sha)
        when = datetime.fromtimestamp(int(ts))
        age = (today - when.date()).days
        per_day[when.date()] += 1
        s.punchcard[(when.weekday(), when.hour)] += 1
        if len(s.recent) < 8:
            s.recent.append((int(ts), subject, author, sha[:7]))
        for line in numstat.splitlines():
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            path = parts[2]
            if " => " in path:  # renames: count the new name
                path = path.split(" => ")[-1].rstrip("}")
            files[path] += 1
            if parts[0].isdigit():
                lines = int(parts[0]) + int(parts[1])
                churn[path] += lines
                if age < 30:
                    s.added_30 += int(parts[0])
                    s.deleted_30 += int(parts[1])
        if age < 30:
            s.commits_30 += 1
        elif age < 60:
            s.commits_prev_30 += 1
    s.days = [(today - timedelta(days=BARS - 1 - i), per_day[today - timedelta(days=BARS - 1 - i)]) for i in range(BARS)]
    day = today if per_day[today] else today - timedelta(days=1)  # a streak survives until today ends
    while per_day[day]:
        s.streak += 1
        day -= timedelta(days=1)
    s.hot_files = [(p, n, churn[p]) for p, n in files.most_common(8)]
    s.recent.sort(reverse=True)
    return s


def languages(sizes_by_path):
    """[(language, bytes)] top 7 + Other, from {path: size}."""
    sizes = Counter()
    for rel, size in sizes_by_path.items():
        p = Path(rel)
        if p.suffix.lower() in SKIP_LANG:
            continue
        lang = SPECIAL_NAMES.get(p.name) or LANGUAGES.get(p.suffix.lower())
        if lang:
            sizes[lang] += size
    top = sizes.most_common(7)
    rest = sum(sizes.values()) - sum(n for _, n in top)
    return top + ([(OTHER, rest)] if rest > 0 else [])


def tree_sizes(repo):
    """{path: size} of every file in HEAD's tree (committed sizes; no disk access)."""
    sizes = {}
    for line in git.run(repo, "ls-tree", "-r", "-l", "-z", "HEAD").split("\0"):
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) == 4 and parts[1] == "blob" and parts[3].isdigit():
            sizes[path] = int(parts[3])
    return sizes


NOREPLY = re.compile(r"^(?:\d+\+)?(?P<login>[^@]+)@users\.noreply\.github\.com$")


def _norm_name(name):
    return re.sub(r"\(.*?\)|[^a-z0-9]", "", name.lower())


def merge_authors(shortlog):
    """`git shortlog -sne` -> [(name, commits)], merging one person's spellings and addresses.

    Entries are linked when they share an email, a normalized name (case, spacing and "(notes)"
    ignored), or a GitHub login (from noreply addresses, matched against names too)."""
    entries = []
    for line in shortlog.splitlines():
        count, _, who = line.strip().partition("\t")
        name, _, email = who.rpartition(" <")
        if count.isdigit():
            entries.append((name, email.rstrip(">").lower(), int(count)))
    parent = list(range(len(entries)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    for i, (name, email, _n) in enumerate(entries):
        keys = {f"e:{email}", f"n:{_norm_name(name)}"}
        m = NOREPLY.match(email)
        if m:
            keys.add(f"n:{_norm_name(m['login'])}")
        for key in keys:
            if key in ("e:", "n:"):
                continue
            if key in owner:
                parent[find(i)] = find(owner[key])
            else:
                owner[key] = i
    totals, spellings = Counter(), {}
    for i, (name, _email, n) in enumerate(entries):
        root = find(i)
        totals[root] += n
        spellings.setdefault(root, Counter())[name] += n
    return [(spellings[r].most_common(1)[0][0], n) for r, n in totals.most_common()]


def to_data(s):
    """ProjectStats -> JSON-safe dict (for the cache)."""
    d = {k: getattr(s, k) for k in s.__dataclass_fields__}
    d["days"] = [[day.isoformat(), n] for day, n in s.days]
    d["punchcard"] = [[wd, hour, n] for (wd, hour), n in s.punchcard.items()]
    return d


def from_data(d):
    s = ProjectStats(**{k: v for k, v in d.items() if k not in ("days", "punchcard")})
    s.days = [(date.fromisoformat(day), n) for day, n in d["days"]]
    s.punchcard = Counter({(wd, hour): n for wd, hour, n in d["punchcard"]})
    for name in ("hot_files", "authors", "languages", "branches", "recent"):
        setattr(s, name, [tuple(x) for x in getattr(s, name)])
    return s


def project(repo, today=None):
    """Analytics for one repo, cached until its commits/branches/HEAD change (or the day rolls over)."""
    today = today or date.today()
    key, version = f"project:{repo}", f"{git.fingerprint(repo)}:{today.isoformat()}"
    cached, _ = cache.shared().get(key, version=version)
    if cached is not None:
        return from_data(cached)
    s = _compute(repo, today)
    cache.shared().put(key, to_data(s), version=version)
    return s


def _compute(repo, today):
    st = git.status(repo)
    if not st.has_commits:
        return ProjectStats(days=[(today - timedelta(days=BARS - 1 - i), 0) for i in range(BARS)])
    s = _windowed(repo, st, today)
    s.total_commits = int(git.run(repo, "rev-list", "--count", "HEAD").strip() or 0)
    roots = git.run(repo, "log", "--max-parents=0", "--format=%at", "HEAD").split()
    s.first_commit = min(map(float, roots)) if roots else 0
    s.authors = merge_authors(git.run(repo, "shortlog", "-sne", "--no-merges", "HEAD"))
    s.languages = languages(tree_sizes(repo))
    refs = git.run(repo, "for-each-ref", "--sort=-committerdate", "refs/heads",
                   "--format=%(refname:short)\x1f%(committerdate:unix)\x1f%(upstream:track)")
    for line in refs.splitlines():
        name, ts, track = line.split("\x1f")
        s.branches.append((name, int(ts or 0), track.strip("[]"), name == st.branch))
    return s


def project_github(repo, force=False):
    """Open PRs and the latest workflow runs for one repo: {prs, runs, error}, or error=None if not on GitHub."""
    slug = github_slug(repo)
    if not slug:
        return {"prs": [], "runs": [], "error": None, "slug": None}
    key = f"github:{repo}"
    cached, fresh = cache.shared().get(key, ttl=GITHUB_TTL)
    if cached is not None and fresh and not force:
        return cached
    try:
        prs = _gh("pr", "list", "-R", slug, "--state", "open", "--limit", "10",
                  "--json", "number,title,url,isDraft,author,headRefName")
        runs = _gh("run", "list", "-R", slug, "-L", "6",
                   "--json", "workflowName,headBranch,status,conclusion,url,createdAt,displayTitle")
        result = {"prs": prs, "runs": runs, "error": None, "slug": slug, "fetched_at": time.time()}
        cache.shared().put(key, result)
        return result
    except Exception as e:  # gh missing, logged out, offline
        error = str(e) or type(e).__name__
        if cached is not None:
            return {**cached, "stale": error}
        return {"prs": [], "runs": [], "error": error, "slug": slug}


def project_github_cached(repo):
    return cache.shared().get(f"github:{repo}", ttl=GITHUB_TTL)[0], cache.shared().age(f"github:{repo}")
