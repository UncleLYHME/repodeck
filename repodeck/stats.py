"""Numbers for the Home dashboard. Everything here blocks; call it off the UI thread."""

import json
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import git

DAYS = 14
FAILED = {"failure", "timed_out", "startup_failure"}


def ago(ts, now=None):
    """Compact relative time: now, 12m, 3h, 5d, 2w."""
    s = max(0, (now or time.time()) - ts)
    for unit, size in (("w", 604800), ("d", 86400), ("h", 3600), ("m", 60)):
        if s >= size:
            return f"{int(s // size)}{unit}"
    return "now"


# -- local git activity ---------------------------------------------------------

@dataclass
class Activity:
    days: list  # [(date, commits)] oldest first, DAYS long
    total: int = 0
    added: int = 0
    deleted: int = 0
    per_repo: dict = field(default_factory=dict)  # repo path -> commits
    recent: list = field(default_factory=list)  # [(timestamp, repo, subject, author, short sha)] newest first


def activity(repos, today=None):
    today = today or date.today()
    start = today - timedelta(days=DAYS - 1)
    counts = {start + timedelta(days=i): 0 for i in range(DAYS)}
    act = Activity(days=[])
    seen = set()  # forks and clones share commits; count each once
    for repo in repos:
        try:
            # Branches, remotes and tags only: tools keep private refs (e.g. refs/t3/*) that aren't real work.
            out = git.run(repo, "log", "--branches", "--remotes", "--tags", "--no-merges", f"--since={start.isoformat()} 00:00",
                          "--format=\x1e%H\x1f%at\x1f%an\x1f%s", "--numstat")
        except (git.GitError, OSError):
            continue
        for block in out.split("\x1e")[1:]:
            head, _, numstat = block.partition("\n")
            sha, ts, author, subject = head.split("\x1f", 3)
            if sha in seen:
                continue
            seen.add(sha)
            day = datetime.fromtimestamp(int(ts)).date()
            if day not in counts:
                continue
            counts[day] += 1
            act.total += 1
            act.per_repo[repo] = act.per_repo.get(repo, 0) + 1
            act.recent.append((int(ts), repo, subject, author, sha[:7]))
            for line in numstat.splitlines():
                parts = line.split("\t")
                if len(parts) == 3 and parts[0].isdigit():  # binary files show "-"
                    act.added += int(parts[0])
                    act.deleted += int(parts[1])
    act.days = sorted(counts.items())
    act.recent.sort(reverse=True)
    del act.recent[8:]
    return act


# -- dev servers ----------------------------------------------------------------

SS_LINE = re.compile(r"^\S+\s+\d+\s+\d+\s+(?P<addr>\S+):(?P<port>\d+)\s+\S+.*?users:\(\((?P<users>.*)\)\)")
SS_USER = re.compile(r'"(?P<name>[^"]+)",pid=(?P<pid>\d+)')


def parse_ss(text):
    """`ss -ltnpH` lines -> [(port, process name, pid)], one entry per port."""
    seen, out = set(), []
    for line in text.splitlines():
        m = SS_LINE.match(line.strip())
        if not m:
            continue
        port = int(m["port"])
        user = SS_USER.search(m["users"])
        if user and port not in seen:
            seen.add(port)
            out.append((port, user["name"], int(user["pid"])))
    return sorted(out)


def services(repos):
    """Listening TCP ports whose process runs inside one of the repos: [(port, repo, process)], others count."""
    try:
        text = subprocess.run(["ss", "-ltnpH"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return [], 0
    roots = sorted(repos, key=len, reverse=True)  # deepest match wins
    found, others = [], 0
    for port, name, pid in parse_ss(text):
        try:
            cwd = os.readlink(f"/proc/{pid}/cwd")
        except OSError:
            cwd = ""
        repo = next((r for r in roots if cwd == r or cwd.startswith(r + os.sep)), None)
        if repo:
            found.append((port, repo, name))
        else:
            others += 1
    return found, others


# -- GitHub (through the gh CLI, which already holds the login) --------------------

GITHUB_URL = re.compile(r"github\.com[:/](?P<slug>[^/\s]+/[^/\s]+?)(?:\.git)?/?$")


def github_slug(repo):
    try:
        url = git.run(repo, "remote", "get-url", "origin").strip()
    except (git.GitError, OSError):
        return None
    m = GITHUB_URL.search(url)
    return m["slug"] if m else None


def _gh(*args):
    p = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=30,
                       env={**os.environ, "GH_PROMPT_DISABLED": "1", "NO_COLOR": "1"})
    if p.returncode:
        raise RuntimeError((p.stderr or p.stdout).strip().splitlines()[-1] if (p.stderr or p.stdout).strip()
                           else "gh failed")
    return json.loads(p.stdout or "[]")


PR_FIELDS = "repository,number,title,url,isDraft,updatedAt"


def pull_requests():
    """({review: [...], mine: [...]}) of open PRs, each {repo, number, title, url, draft}."""
    def norm(items):
        return [{"repo": i["repository"]["nameWithOwner"], "number": i["number"], "title": i["title"],
                 "url": i["url"], "draft": i.get("isDraft", False)} for i in items]
    return {
        "review": norm(_gh("search", "prs", "--review-requested=@me", "--state=open", "--json", PR_FIELDS, "--limit", "20")),
        "mine": norm(_gh("search", "prs", "--author=@me", "--state=open", "--json", PR_FIELDS, "--limit", "20")),
    }


def ci_failures_from_runs(runs, since):
    """Latest run per (workflow, branch); keep the ones that failed after `since` (ISO time)."""
    latest = {}
    for run in sorted(runs, key=lambda r: r["createdAt"], reverse=True):
        latest.setdefault((run["workflowName"], run["headBranch"]), run)
    return [r for r in latest.values() if r.get("conclusion") in FAILED and r["createdAt"] >= since]


def ci_failures(repos):
    since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")

    def one(repo):
        slug = github_slug(repo)
        if not slug:
            return []
        runs = _gh("run", "list", "-R", slug, "-L", "30", "--json",
                   "workflowName,headBranch,conclusion,url,createdAt,displayTitle")
        return [{**r, "repo": repo} for r in ci_failures_from_runs(runs, since)]

    with ThreadPoolExecutor(max_workers=6) as pool:
        out = [r for found in pool.map(one, repos) for r in found]
    return sorted(out, key=lambda r: r["createdAt"], reverse=True)


def github(repos):
    """PRs and CI failures, or an error string when gh is missing, logged out or offline."""
    try:
        return {"prs": pull_requests(), "ci": ci_failures(repos), "error": None}
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as e:
        return {"prs": {"review": [], "mine": []}, "ci": [], "error": str(e) or type(e).__name__}


def iso_ts(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() if text else 0


def repo_name(path):
    return Path(path).name
