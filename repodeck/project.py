"""Project page: analytics for one repository, opened from the sidebar.

Re-reads whenever that repo's panel sees a change (file events), so it stays live;
GitHub data loads when the page opens and every few minutes while it's shown.
"""

import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

from gi.repository import Adw, Gio, GLib, Gtk, Pango

from . import projectstats, stats
from .cards import Bars, Card, dot, icon, row, text
from .charts import Heatmap, StackedBar, heatmap_block, language_parts, legend_grid
from .watch import Throttle
from .widgets import label

GITHUB_SECONDS = 5 * 60


def short(n):
    return f"{n / 1000:.1f}k".replace(".0k", "k") if n >= 1000 else str(n)


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def date_ticks(days, every=7):
    box = Gtk.Box(homogeneous=True)
    for i, (day, _) in enumerate(days):
        mark = (len(days) - 1 - i) % every == 0
        box.append(label(f"{day:%b} {day.day}" if mark else "", "day-letter", xalign=0.5))
    return box


class Tile(Gtk.Box):
    def __init__(self, caption):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=2, hexpand=True)
        self.add_css_class("dash-card")
        self.add_css_class("stat-tile")
        self.append(label(caption, "card-title"))
        self.value = label("–", "dash-big")
        self.append(self.value)
        self.sub = label("", "card-meta", ellipsize=Pango.EllipsizeMode.END)
        self.append(self.sub)

    def set(self, value, sub):
        self.value.set_label(value)
        self.sub.set_label(sub)


class ProjectPage(Gtk.ScrolledWindow):
    def __init__(self, window):
        super().__init__(hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.window = window  # panes(), open_project(path), announce()
        self.path = None
        self.github = None
        self._busy = False
        self.schedule = Throttle(600, self._load)

        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_top=24, margin_bottom=32)
        page.add_css_class("dashboard")
        page.append(self._build_header())

        tiles = Gtk.Box(spacing=12, homogeneous=True)
        self.t_commits = Tile("Commits · 30 days")
        self.t_lines = Tile("Lines changed · 30 days")
        self.t_streak = Tile("Streak")
        self.t_total = Tile("All time")
        for t in (self.t_commits, self.t_lines, self.t_streak, self.t_total):
            tiles.append(t)
        page.append(tiles)

        self.activity = Card("Activity · last 30 days", "rd-activity-symbolic")
        self.bars = Bars(height=96)
        page.append(self.activity)

        grid = Gtk.Grid(column_spacing=12, row_spacing=12, column_homogeneous=True)
        self.when = Card("When commits happen · last 90 days", "preferences-system-time-symbolic")
        self.heatmap = Heatmap()
        self.when.body.append(heatmap_block(self.heatmap))
        self.langs = Card("Languages", "rd-commit-symbolic")
        self.hot = Card("Most changed files · 90 days", "document-edit-symbolic")
        self.people = Card("Contributors", "system-users-symbolic")
        self.branches = Card("Branches", "rd-branch-symbolic")
        self.gh = Card("GitHub", "rd-pull-request-symbolic")
        for i, card in enumerate([self.when, self.langs, self.hot, self.people, self.branches, self.gh]):
            grid.attach(card, i % 2, i // 2, 1, 1)
        page.append(grid)
        self.recent = Card("Recent commits", "rd-commit-symbolic")
        page.append(self.recent)

        self.set_child(Adw.Clamp(child=page, maximum_size=1040, tightening_threshold=760,
                                 margin_start=16, margin_end=16))
        GLib.timeout_add_seconds(GITHUB_SECONDS, self._poll_github)

    # -- header -------------------------------------------------------------------

    def _build_header(self):
        head = Gtk.Box(spacing=12)
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, hexpand=True)
        self.name = label("", "project-title", ellipsize=Pango.EllipsizeMode.END)
        left.append(self.name)
        self.where = label("", "mono", ellipsize=Pango.EllipsizeMode.START)
        left.append(self.where)
        self.chips = Gtk.Box(spacing=8, margin_top=4)
        left.append(self.chips)
        head.append(left)
        actions = Gtk.Box(spacing=6, valign=Gtk.Align.START)
        open_panel = Gtk.Button(label="Open Panel", tooltip_text="Commit, branches and history on the Projects page")
        open_panel.add_css_class("suggested-action")
        open_panel.add_css_class("pill")
        open_panel.connect("clicked", lambda *_: self.window.open_project(self.path))
        actions.append(open_panel)
        if shutil.which("code"):
            code = Gtk.Button(label="VS Code")
            code.add_css_class("pill")
            code.connect("clicked", lambda *_: subprocess.Popen(["code", self.path], start_new_session=True))
            actions.append(code)
        self.github_btn = Gtk.Button(label="GitHub", visible=False)
        self.github_btn.add_css_class("pill")
        self.github_btn.connect("clicked", lambda *_: self._launch(f"https://github.com/{self.github['slug']}"))
        actions.append(self.github_btn)
        head.append(actions)
        return head

    def _render_header(self):
        pane = self._pane()
        self.name.set_label(("★ " if pane and pane.pinned else "") + Path(self.path).name)
        self.where.set_label(self.path)
        while child := self.chips.get_first_child():
            self.chips.remove(child)
        st = pane.status if pane else None
        if not st:
            return
        self.chips.append(label(st.branch, "branch"))
        self.chips.append(label(f"↑{st.ahead} ↓{st.behind}" if st.upstream else "no upstream", "card-meta"))
        if st.changes:
            self.chips.append(dot("dot-busy"))
            self.chips.append(label(plural(len(st.changes), "uncommitted change"), "card-meta"))
        else:
            self.chips.append(dot("dot-ok"))
            self.chips.append(label("clean", "card-meta"))
        if pane.pending.get_visible():
            self.chips.append(label(pane.pending.get_label(), "pending"))

    # -- loading ------------------------------------------------------------------

    def show(self, path):
        changed = path != self.path
        self.path = path
        if changed:
            self.github = None
            self.github_btn.set_visible(False)
            self.gh.clear()
            self.gh.empty("Loading…")
            self.get_vadjustment().set_value(0)
        self._render_header()
        self.schedule()
        if changed:
            self._load_github()

    def _pane(self):
        return next((p for p in self.window.panes() if p.path == self.path), None)

    def _load(self):
        if not self.path:
            return
        if self._busy:
            self.schedule()
            return
        self._busy = True
        path = self.path

        def work():
            try:
                result, err = projectstats.project(path), None
            except Exception as e:
                result, err = None, e
            GLib.idle_add(done, result, err)

        def done(result, err):
            self._busy = False
            if path != self.path:
                self.schedule()
                return
            self._render_header()
            if result:
                self._render(result)

        threading.Thread(target=work, daemon=True).start()

    def _poll_github(self):
        if self.path and self.get_mapped():
            self._load_github()
        return GLib.SOURCE_CONTINUE

    def _load_github(self):
        path = self.path

        def work():
            result = projectstats.project_github(path)
            GLib.idle_add(lambda: (self._render_github(result) if path == self.path else None, False)[1])

        threading.Thread(target=work, daemon=True).start()

    # -- rendering ------------------------------------------------------------------

    def _render(self, s):
        delta = s.commits_30 - s.commits_prev_30
        trend = "same as" if not delta else (f"↑{delta} vs" if delta > 0 else f"↓{-delta} vs")
        self.t_commits.set(str(s.commits_30), f"{trend} the previous 30 days")
        self.t_lines.set(short(s.added_30 + s.deleted_30), f"+{short(s.added_30)} added · −{short(s.deleted_30)} removed")
        self.t_streak.set(plural(s.streak, "day"), "in a row with commits" if s.streak else "no commits today or yesterday")
        since = datetime.fromtimestamp(s.first_commit).strftime("%b %Y") if s.first_commit else "—"
        self.t_total.set(f"{s.total_commits:,}", f"commits since {since} · {plural(len(s.authors), 'contributor')}")

        self.activity.clear()
        if self.bars.get_parent():
            self.bars.get_parent().remove(self.bars)
        self.activity.body.append(self.bars)
        self.bars.set_days(s.days)
        self.activity.body.append(date_ticks(s.days))

        self.heatmap.set_counts(s.punchcard)

        self.langs.clear()
        if not s.languages:
            self.langs.empty("No recognised source files.")
        else:
            parts = language_parts(s.languages)
            bar = StackedBar()
            bar.set_parts(parts)
            self.langs.body.append(bar)
            spacer = Gtk.Box(height_request=6)
            self.langs.body.append(spacer)
            self.langs.body.append(legend_grid(parts))
        self.langs.set_note("By file size of tracked files")

        self.hot.clear()
        if not s.hot_files:
            self.hot.empty("No changes in the last 90 days.")
        for path, commits, churn in s.hot_files:
            p = Path(path)
            folder = "" if str(p.parent) == "." else str(p.parent)
            self.hot.body.append(row(text(p.name, chars=24), text(folder, "mono", expand=True),
                                     text(f"{plural(commits, 'commit')} · {short(churn)} lines", "card-meta"),
                                     on_click=(lambda f=path: self._open_file(f)) if shutil.which("code") else None,
                                     tooltip=path))

        self.people.clear()
        top = s.authors[0][1] if s.authors else 1
        for name, count in s.authors[:6]:
            meter = Gtk.LevelBar(min_value=0, max_value=top, value=count, hexpand=True, valign=Gtk.Align.CENTER)
            meter.add_css_class("activity-meter")
            who = text(name, chars=18)
            who.set_size_request(140, -1)
            self.people.body.append(row(who, meter, text(f"{count:,}", "card-meta")))
        if not s.authors:
            self.people.empty("No commits yet.")
        self.people.set_note(f"+{len(s.authors) - 6} more" if len(s.authors) > 6 else "")

        self.branches.clear()
        self.branches.set_count(len(s.branches))
        now = time.time()
        for name, ts, track, current in s.branches[:6]:
            stale = now - ts > 30 * 86400
            cells = [dot("dot-ok" if current else ("dot-idle" if stale else "dot-sync")), text(name, expand=True)]
            if track:
                cells.append(text(track, "mono"))
            cells.append(text(("current · " if current else "") + stats.ago(ts, now), "card-meta"))
            self.branches.body.append(row(*cells, tooltip="No commits for 30+ days" if stale else None))
        self.branches.set_note(f"+{len(s.branches) - 6} more" if len(s.branches) > 6 else "")

        self.recent.clear()
        for ts, subject, author, sha in s.recent:
            self.recent.body.append(row(icon("rd-commit-symbolic", "dim-label"), text(subject, expand=True),
                                        text(author, "card-meta", chars=18), text(sha, "mono"),
                                        text(stats.ago(ts, now), "card-meta"),
                                        on_click=lambda: self.window.open_project(self.path)))
        if not s.recent:
            self.recent.empty("No commits in the last 90 days.")

    def _render_github(self, gh):
        self.github = gh
        self.gh.clear()
        self.github_btn.set_visible(bool(gh["slug"]))
        if not gh["slug"]:
            self.gh.empty("Not hosted on GitHub.")
            return
        if gh["error"]:
            self.gh.empty(f"GitHub unavailable: {gh['error']}")
            return
        self.gh.subhead(f"Open pull requests · {len(gh['prs'])}")
        if not gh["prs"]:
            self.gh.body.append(label("None open.", "card-empty"))
        for pr in gh["prs"][:4]:
            self.gh.body.append(row(icon("rd-pull-request-symbolic", "pr-icon"), text(pr["title"], expand=True),
                                    text(f"#{pr['number']}", "mono"), text("Draft" if pr["isDraft"] else "Open", "card-meta"),
                                    on_click=lambda u=pr["url"]: self._launch(u)))
        self.gh.subhead("Latest workflow runs")
        if not gh["runs"]:
            self.gh.body.append(label("No workflow runs.", "card-empty"))
        now = time.time()
        for run in gh["runs"][:4]:
            state, css, word = run.get("conclusion") or run.get("status"), "dot-idle", "running"
            if state == "success":
                css, word = "dot-ok", "passed"
            elif state in stats.FAILED:
                css, word = "dot-warn", "failed"
            elif state in ("cancelled", "skipped", "neutral"):
                word = state
            self.gh.body.append(row(dot(css), text(run["workflowName"], expand=True), text(run["headBranch"], "mono"),
                                    text(f"{word} · {stats.ago(stats.iso_ts(run['createdAt']), now)}", "card-meta"),
                                    on_click=lambda u=run["url"]: self._launch(u), tooltip=run.get("displayTitle")))

    def _open_file(self, rel):
        subprocess.Popen(["code", "-g", str(Path(self.path, rel))], start_new_session=True)

    def _launch(self, uri):
        Gio.AppInfo.launch_default_for_uri(uri, None)
