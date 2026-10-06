"""Home: a bird's-eye dashboard across every repository in the deck.

Local cards (working now, sync, activity, recent commits) follow the repo panes' file events;
running services are re-checked every few seconds while Home is visible (ports emit no events);
GitHub cards (pull requests, CI) refresh every few minutes through the gh CLI.
"""

import threading
import time
from datetime import datetime
from pathlib import Path

from gi.repository import Adw, Gio, GLib, Gtk

from . import stats
from .hero import HeroScene, greeting
from .cards import Bars, Card, day_letters, dot, icon, row, text
from .watch import Throttle
from .widgets import label

SERVICES_SECONDS = 8
GITHUB_SECONDS = 5 * 60
SHOW = 5  # rows per card before "+N more"


def short(n):
    return f"{n / 1000:.1f}k".replace(".0k", "k") if n >= 1000 else str(n)


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


class Dashboard(Gtk.ScrolledWindow):
    def __init__(self, window):
        super().__init__(hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.window = window  # panes(), open_project(path), toast()
        self.activity = None
        self.services = ([], 0)
        self.github = None
        self._local_busy = self._github_busy = False
        self.schedule = Throttle(800, self._refresh)

        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        page.add_css_class("dashboard")
        page.append(self._build_hero())
        grid = Gtk.Grid(column_spacing=12, row_spacing=12, column_homogeneous=True, margin_top=28, margin_bottom=32)
        self.working = Card("Working now", "document-edit-symbolic")
        self.prs = Card("Pull requests", "rd-pull-request-symbolic")
        self.git = Card("Git activity", "rd-activity-symbolic")
        self.sync = Card("Sync", "emblem-synchronizing-symbolic")
        self.recent = Card("Recent commits", "rd-commit-symbolic")
        self.running = Card("Running services", "network-server-symbolic")
        self.active = Card("Most active", "starred-symbolic")
        self.ci = Card("CI failures", "dialog-error-symbolic")
        cards = [self.working, self.prs, self.git, self.sync, self.recent, self.running, self.active, self.ci]
        for i, card in enumerate(cards):
            grid.attach(card, i % 2, i // 2, 1, 1)
        page.append(Adw.Clamp(child=grid, maximum_size=980, tightening_threshold=700,
                              margin_start=16, margin_end=16))
        self.set_child(page)

        self.bars = Bars()
        GLib.timeout_add_seconds(SERVICES_SECONDS, self._poll_services)
        GLib.timeout_add_seconds(GITHUB_SECONDS, self._poll_github)
        GLib.timeout_add_seconds(2, self._first_github)

    # -- hero -------------------------------------------------------------------

    def _build_hero(self):
        overlay = Gtk.Overlay()
        self.hero = HeroScene(on_phase=lambda _phase: self._update_greeting())
        overlay.set_child(self.hero)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, valign=Gtk.Align.END,
                      halign=Gtk.Align.CENTER, margin_bottom=6)
        # A translucent strip keeps the text readable over any sky, day or night.
        strip = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, halign=Gtk.Align.CENTER)
        strip.add_css_class("hero-strip")
        self.greeting = label("", "hero-greeting", xalign=0.5)
        strip.append(self.greeting)
        self._update_greeting()
        strip.append(label("What's happening across your projects?", "hero-title", xalign=0.5))
        self.hero_sub = label("", "hero-sub", xalign=0.5)
        strip.append(self.hero_sub)
        box.append(strip)

        composer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, width_request=460)
        composer.add_css_class("hero-input")
        self.search = Gtk.SearchEntry(placeholder_text="Jump to a project…", hexpand=True)
        self.search.connect("search-changed", lambda *_: self._render_matches())
        self.search.connect("activate", lambda *_: self._open_first_match())
        composer.append(self.search)
        self.matches = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, visible=False)
        composer.append(self.matches)
        box.append(composer)
        overlay.add_overlay(box)
        return overlay

    def _update_greeting(self):
        self.greeting.set_label(greeting(datetime.now().hour))

    def _matching(self):
        q = self.search.get_text().strip().lower()
        if not q:
            return []
        panes = self.window.panes()
        return [p for p in panes if q in Path(p.path).name.lower()][:6]

    def _render_matches(self):
        while child := self.matches.get_first_child():
            self.matches.remove(child)
        found = self._matching()
        for pane in found:
            st = pane.status
            branch = st.branch if st else ""
            self.matches.append(row(icon("folder-symbolic", "dim-label"), text(Path(pane.path).name, expand=True),
                                    text(branch, "mono"), on_click=lambda p=pane: self._open(p.path)))
        if self.search.get_text().strip() and not found:
            self.matches.append(label("No matching project", "card-empty"))
        self.matches.set_visible(bool(self.search.get_text().strip()))

    def _open_first_match(self):
        found = self._matching()
        if found:
            self._open(found[0].path)

    def _open(self, path):
        self.search.set_text("")
        self.window.open_project(path)

    # -- refresh ----------------------------------------------------------------

    def _refresh(self):
        """Cheap cards straight from pane state, then the git-log based ones in the background."""
        panes = self.window.panes()
        self._render_working(panes)
        self._render_sync(panes)
        self._render_hero(panes)
        if self._local_busy:
            self.schedule()  # run again once the current scan finishes
            return
        self._local_busy = True
        repos = [p.path for p in panes]

        def work():
            act = stats.activity(repos)
            svc = stats.services(repos)
            GLib.idle_add(done, act, svc)

        def done(act, svc):
            self._local_busy = False
            self.activity, self.services = act, svc
            self._render_activity()
            self._render_services()

        threading.Thread(target=work, daemon=True).start()

    def _poll_services(self):
        if self.get_mapped():
            repos = [p.path for p in self.window.panes()]

            def work():
                svc = stats.services(repos)
                GLib.idle_add(lambda: (setattr(self, "services", svc), self._render_services(), False)[-1])

            threading.Thread(target=work, daemon=True).start()
        return GLib.SOURCE_CONTINUE

    def _first_github(self):
        cached, _age = stats.github_cached([p.path for p in self.window.panes()])
        if cached:  # show the last known answer at once; refresh_github revalidates if it's old
            self.github = cached
            self._render_github()
        self.refresh_github()
        return GLib.SOURCE_REMOVE

    def _poll_github(self):
        self.refresh_github()
        return GLib.SOURCE_CONTINUE

    def refresh_github(self, force=False):
        if self._github_busy:
            return
        self._github_busy = True
        repos = [p.path for p in self.window.panes()]

        def work():
            result = stats.github(repos, force=force)
            GLib.idle_add(done, result)

        def done(result):
            self._github_busy = False
            previous, self.github = self.github, result
            self._render_github()
            if previous and not previous["error"] and not result["error"]:
                self._announce_new(previous, result)

        threading.Thread(target=work, daemon=True).start()

    def _announce_new(self, before, after):
        """Desktop notifications for CI failures and review requests that weren't there last time."""
        seen = {r["url"] for r in before["ci"]}
        for run in after["ci"]:
            if run["url"] not in seen:
                self.window.announce(f"CI failed: {run['workflowName']}",
                                     f"{Path(run['repo']).name} / {run['headBranch']}", key=run["url"], uri=run["url"])
        seen = {pr["url"] for pr in before["prs"]["review"]}
        for pr in after["prs"]["review"]:
            if pr["url"] not in seen:
                self.window.announce(f"Review requested: {pr['title']}", f"{pr['repo']}#{pr['number']}",
                                     key=pr["url"], uri=pr["url"])

    # -- cards ------------------------------------------------------------------

    def _render_hero(self, panes):
        loaded = [p.status for p in panes if p.status]
        dirty = sum(1 for st in loaded if st.changes)
        ahead = sum(st.ahead for st in loaded)
        behind = sum(st.behind for st in loaded)
        parts = [plural(len(panes), "project")]
        parts.append(f"{dirty} with changes" if dirty else "all committed")
        if ahead:
            parts.append(f"↑{ahead} to push")
        if behind:
            parts.append(f"↓{behind} to pull")
        self.hero_sub.set_label(" · ".join(parts))

    def _render_working(self, panes):
        card = self.working
        card.clear()
        dirty = [p for p in panes if p.status and p.status.changes]
        dirty.sort(key=lambda p: len(p.status.changes), reverse=True)
        card.set_count(len(dirty))
        if not dirty:
            card.empty("Nothing uncommitted. Every project is clean.")
        for pane in dirty[:SHOW]:
            st = pane.status
            staged = sum(1 for c in st.changes if c.staged)
            files = plural(len(st.changes), "file") + (f" · {staged} staged" if staged else "")
            card.body.append(row(dot("dot-busy"), text(Path(pane.path).name, expand=True), text(st.branch, "mono", chars=18),
                                 text(files, "card-meta"), on_click=lambda p=pane: self._open(p.path)))
        card.set_note(f"+{len(dirty) - SHOW} more" if len(dirty) > SHOW else "")

    def _render_sync(self, panes):
        card = self.sync
        card.clear()
        items = []
        for pane in panes:
            st = pane.status
            if not st:
                continue
            state = []
            if st.ahead:
                state.append(f"↑{st.ahead} to push")
            if st.behind:
                state.append(f"↓{st.behind} to pull")
            if pane.pending.get_visible():
                state.append(pane.pending.get_label())
            if pane.fetch_error:
                state.append("fetch failed")
            if state:
                items.append((pane, " · ".join(state)))
        card.set_count(len(items))
        if not items:
            card.empty("Everything is in sync with its remote.")
        for pane, state in items[:SHOW]:
            cells = [dot("dot-warn" if pane.fetch_error else "dot-sync"), text(Path(pane.path).name, expand=True),
                     text(state, "card-meta")]
            st = pane.status
            if st.ahead and not pane._busy:
                push = Gtk.Button(label="Push", valign=Gtk.Align.CENTER, tooltip_text="Push (brings in remote commits first)")
                push.add_css_class("pill-button")
                push.connect("clicked", lambda _b, p=pane: p.activate_action("pane.push", None))
                cells.append(push)
            card.body.append(row(*cells, tooltip=pane.fetch_error))
        card.set_note(f"+{len(items) - SHOW} more" if len(items) > SHOW else "")

    def _render_activity(self):
        act = self.activity
        card = self.git
        card.clear()
        head = Gtk.Box(spacing=8)
        head.append(label(str(act.total), "dash-big", valign=Gtk.Align.BASELINE))
        head.append(label(f"commits · {stats.DAYS} days", "card-meta", valign=Gtk.Align.BASELINE, hexpand=True))
        head.append(label(f"+{short(act.added)}", "lines-add", valign=Gtk.Align.BASELINE))
        head.append(label(f"−{short(act.deleted)}", "lines-del", valign=Gtk.Align.BASELINE))
        card.body.append(head)
        if self.bars.get_parent():
            self.bars.get_parent().remove(self.bars)
        card.body.append(self.bars)
        self.bars.set_days(act.days)
        card.body.append(day_letters(act.days))

        # Recent commits and most active repos come from the same scan.
        self.recent.clear()
        if not act.recent:
            self.recent.empty(f"No commits in the last {stats.DAYS} days.")
        now = time.time()
        for ts, repo, subject, author, sha in act.recent[:6]:
            self.recent.body.append(row(icon("rd-commit-symbolic", "dim-label"), text(subject, expand=True),
                                        text(f"{Path(repo).name} · {sha}", "mono", chars=28),
                                        text(stats.ago(ts, now), "card-meta"),
                                        on_click=lambda r=repo: self._open(r), tooltip=f"{author} · {subject}"))

        self.active.clear()
        ranked = sorted(act.per_repo.items(), key=lambda kv: kv[1], reverse=True)
        if not ranked:
            self.active.empty("No activity yet.")
        top = ranked[0][1] if ranked else 1
        for repo, count in ranked[:SHOW]:
            meter = Gtk.LevelBar(min_value=0, max_value=top, value=count, hexpand=True, valign=Gtk.Align.CENTER)
            meter.add_css_class("activity-meter")
            name = text(Path(repo).name, chars=16)
            name.set_size_request(130, -1)
            self.active.body.append(row(name, meter, text(str(count), "card-meta"), on_click=lambda r=repo: self._open(r)))
        self.active.set_note(f"+{len(ranked) - SHOW} more" if len(ranked) > SHOW else "")

    def _render_services(self):
        found, others = self.services
        card = self.running
        card.clear()
        card.set_count(len(found))
        if not found:
            card.empty("No dev servers running from your projects.")
        for port, repo, proc in found[:SHOW]:
            url = f"http://localhost:{port}"
            card.body.append(row(dot("dot-ok"), text(f":{port}", "mono"), text(Path(repo).name, expand=True),
                                 text(proc, "card-meta"), on_click=lambda u=url: self._launch(u), tooltip=f"Open {url}"))
        extra = len(found) - SHOW if len(found) > SHOW else 0
        notes = [f"+{extra} more"] if extra else []
        if others:
            notes.append(f"{others} other ports listening")
        card.set_note(" · ".join(notes))

    def _render_github(self):
        gh = self.github
        for card in (self.prs, self.ci):
            card.clear()
            card.set_note(stats.freshness(gh))
        if gh["error"]:
            for card in (self.prs, self.ci):
                card.empty(f"GitHub unavailable: {gh['error']}")
            return
        review, mine = gh["prs"]["review"], gh["prs"]["mine"]
        self.prs.set_count(len(review) + len(mine))
        if not review and not mine:
            self.prs.empty("No open pull requests.")
        for title, items, css in (("Waiting on your review", review, "subhead-warn"), ("Yours", mine, "")):
            if not items:
                continue
            self.prs.subhead(f"{title} · {len(items)}", css)
            for pr in items[:SHOW]:
                state = "Draft" if pr["draft"] else "Open"
                self.prs.body.append(row(icon("rd-pull-request-symbolic", "pr-icon"), text(pr["title"], expand=True),
                                         text(f"{pr['repo'].split('/')[-1]}#{pr['number']}", "mono", chars=22),
                                         text(state, "card-meta"), on_click=lambda u=pr["url"]: self._launch(u)))

        failures = gh["ci"]
        self.ci.set_count(len(failures))
        if not failures:
            self.ci.empty("No failing workflows.")
        now = time.time()
        for run in failures[:SHOW]:
            where = f"{Path(run['repo']).name} / {run['headBranch']}"
            self.ci.body.append(row(icon("dialog-error-symbolic", "ci-fail"), text(run["workflowName"]),
                                    text(where, "card-meta", expand=True),
                                    text(stats.ago(stats.iso_ts(run["createdAt"]), now), "card-meta"),
                                    on_click=lambda u=run["url"]: self._launch(u), tooltip=run.get("displayTitle")))

    def _launch(self, uri):
        Gio.AppInfo.launch_default_for_uri(uri, None)
