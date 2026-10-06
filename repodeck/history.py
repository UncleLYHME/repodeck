"""Commit history: graph rows that expand in place to list the files each commit changed."""

import threading
from pathlib import Path

from gi.repository import GLib, Gtk, Pango

from . import compare, git, graph, skeleton
from .diffwindow import CompareWindow
from .widgets import file_icon, label, section_header, status_class

MAX_FILES = 500
BATCH = 40  # commit rows built at a time; more are built as you scroll toward the end
AHEAD = 400  # px before the end at which the next batch starts building
SKELETONS = 3


class HistoryView(Gtk.Box):
    def __init__(self, repo, show_diff):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, vexpand=True)
        self.repo = repo
        self.show_diff = show_diff  # (title, subtitle, fn returning diff text)
        self.rows, self.lanes, self.lane_count = [], [], 1
        self.expanded = None  # full sha of the open commit
        self.file_rows = []  # rows inserted under it
        self.files = {}  # sha -> [CommitFile]; commits never change, so this cache never goes stale

        header, self.count = section_header("History")
        header.append(Gtk.Box(hexpand=True))
        toggle = Gtk.ToggleButton(icon_name="system-search-symbolic", tooltip_text="Search history",
                                  valign=Gtk.Align.CENTER)
        toggle.add_css_class("flat")
        toggle.add_css_class("row-action")
        header.append(toggle)
        self.append(header)
        self.search = Gtk.SearchEntry(placeholder_text="Message, author, hash or file name…", margin_start=12,
                                      margin_end=12, margin_bottom=4)
        self.search.connect("search-changed", lambda *_: self._on_search())
        self.search.connect("stop-search", lambda *_: toggle.set_active(False))
        self.search_bar = Gtk.Revealer(child=self.search, reveal_child=False)
        toggle.connect("toggled", self._on_search_toggled)
        self.append(self.search_bar)
        self.query, self.file_hits = "", set()
        self.list = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        self.list.set_filter_func(self._filter)
        self.list.add_css_class("history")
        self.list.set_placeholder(label("No commits yet", "dim-label", "placeholder", xalign=0.5))
        self.list.connect("row-activated", self._on_activated)
        self.scroller = Gtk.ScrolledWindow(child=self.list, vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER)
        adj = self.scroller.get_vadjustment()
        adj.connect("value-changed", lambda *_: self._maybe_more())
        adj.connect("changed", lambda *_: self._maybe_more())  # also fills a tall panel that can't scroll yet
        self.append(self.scroller)
        self.built = 0  # commit rows created so far (rows[:built])
        self.skeletons = []
        self._more_pending = False
        self._show_skeletons(6)  # until the first history arrives

    def set_rows(self, rows):
        keep = max(BATCH, self.built)  # don't make the user scroll for rows they'd already loaded
        self.rows = rows
        self.file_rows = []
        self.skeletons = []
        self.list.remove_all()
        self.built = 0
        # Layout is cheap and needs every commit for consistent lanes; widgets are the costly part.
        self.lanes = graph.layout([(r.full_sha, r.parents) for r in rows])
        self.lane_count = graph.lane_count(self.lanes)
        self._build(len(rows) if self.query else keep)
        self.count.set_label(str(len(rows)))
        open_sha, self.expanded = self.expanded, None
        if open_sha:
            self._expand(open_sha)  # keep the same commit open across refreshes

    # -- lazy building ----------------------------------------------------------

    def _show_skeletons(self, n):
        for row in self.skeletons:
            self.list.remove(row)
        self.skeletons = [skeleton.list_row(i, "dot") for i in range(n)]
        for row in self.skeletons:
            self.list.append(row)

    def _build(self, upto):
        """Create commit rows up to index `upto`, keeping skeleton rows at the end while more remain."""
        upto = min(upto, len(self.rows))
        for row in self.skeletons:
            self.list.remove(row)
        self.skeletons = []
        for r, lane in zip(self.rows[self.built:upto], self.lanes[self.built:upto]):
            self.list.append(self._commit_row(r, lane))
        self.built = max(self.built, upto)
        if self.built < len(self.rows):
            self._show_skeletons(SKELETONS)

    def _maybe_more(self):
        if self._more_pending or self.built >= len(self.rows):
            return
        adj = self.scroller.get_vadjustment()
        if adj.get_value() + adj.get_page_size() >= adj.get_upper() - AHEAD:
            self._more_pending = True
            GLib.idle_add(self._more)  # after this frame, so the skeletons paint first

    def _more(self):
        self._more_pending = False
        self._build(self.built + BATCH)
        return GLib.SOURCE_REMOVE

    # -- rows -------------------------------------------------------------------

    def _commit_row(self, r, lane):
        row = Gtk.ListBoxRow()
        row.add_css_class("commit")
        row.log, row.lane = r, lane
        box = Gtk.Box(spacing=6)
        box.append(graph.GraphCell(lane, self.lane_count))
        for kind, name in r.refs:
            box.append(label(name, "ref", f"ref-{kind}", valign=Gtk.Align.CENTER,
                             ellipsize=Pango.EllipsizeMode.END, max_width_chars=18))
        box.append(label(r.subject, hexpand=True, ellipsize=Pango.EllipsizeMode.END))
        box.append(label(f"{r.author} · {r.when}", "meta", ellipsize=Pango.EllipsizeMode.END, max_width_chars=26))
        row.open_full = Gtk.Button(icon_name="text-x-generic-symbolic", tooltip_text="Show full commit",
                                   valign=Gtk.Align.CENTER, visible=False)
        row.open_full.add_css_class("flat")
        row.open_full.add_css_class("row-action")
        row.open_full.connect("clicked", lambda *_: self._show_commit(r))
        box.append(row.open_full)
        row.set_child(box)
        row.set_tooltip_text(f"{r.sha}  {r.subject}")
        row.graph = box.get_first_child()
        row.graph.set_visible(not self.query)  # lanes mean nothing between filtered rows
        return row

    def _file_row(self, commit, f, lanes):
        row = Gtk.ListBoxRow()
        row.add_css_class("commit-file")
        row.log, row.file = commit, f
        box = Gtk.Box(spacing=6)
        box.append(graph.GraphCell(lanes, self.lane_count))
        inner = Gtk.Box(spacing=8, margin_start=10, hexpand=True)
        inner.append(file_icon(f.path))
        p = Path(f.path)
        inner.append(label(p.name, ellipsize=Pango.EllipsizeMode.MIDDLE))
        parent = "" if str(p.parent) == "." else str(p.parent)
        inner.append(label(parent, "dim-label", "caption", hexpand=True, ellipsize=Pango.EllipsizeMode.START))
        inner.append(label(f.letter, "status", status_class(f.letter)))
        box.append(inner)
        row.set_child(box)
        row.set_tooltip_text(f"{f.orig} → {f.path}" if f.orig else f.path)
        return row

    def _note_row(self, text, lanes):
        row = Gtk.ListBoxRow(activatable=False)
        row.add_css_class("commit-file")
        box = Gtk.Box(spacing=6)
        box.append(graph.GraphCell(lanes, self.lane_count))
        box.append(label(text, "dim-label", "caption", margin_start=10))
        row.set_child(box)
        return row

    # -- search -------------------------------------------------------------------

    def _on_search_toggled(self, toggle):
        self.search_bar.set_reveal_child(toggle.get_active())
        if toggle.get_active():
            self.search.grab_focus()
        else:
            self.search.set_text("")

    def _on_search(self):
        query = self.search.get_text().strip().lower()
        if query:
            self._build(len(self.rows))  # search looks through every loaded commit
        if bool(query) != bool(self.query):
            self._collapse()
            self.expanded = None
            row = self.list.get_first_child()
            while row:
                if hasattr(row, "graph"):
                    row.graph.set_visible(not query)
                row = row.get_next_sibling()
        self.query, self.file_hits = query, set()
        self.list.invalidate_filter()
        if len(query) < 2:
            return

        def work():
            try:
                hits = set(git.run(self.repo, "log", "--format=%H", "--branches", "--remotes", "--tags", "HEAD",
                                   f"-n{git.LOG_LIMIT}", "--", f":(icase,glob)**/*{query}*",
                                   env={"GIT_LITERAL_PATHSPECS": "0"}).split())
            except Exception:
                hits = set()
            GLib.idle_add(done, hits)

        def done(hits):
            if query == self.query:  # still the current search
                self.file_hits = hits
                self.list.invalidate_filter()

        threading.Thread(target=work, daemon=True).start()

    def _filter(self, row):
        if not self.query:
            return True
        r = getattr(row, "log", None)
        if not r or getattr(row, "file", None) or not hasattr(row, "graph"):
            return bool(r) and self.expanded == r.full_sha  # file rows of an opened match
        q = self.query
        return q in r.subject.lower() or q in r.author.lower() or r.full_sha.startswith(q) or r.full_sha in self.file_hits

    # -- expand / collapse --------------------------------------------------------

    def _on_activated(self, _list, row):
        if getattr(row, "file", None):
            c, f = row.log, row.file
            CompareWindow(self.get_root(), Path(f.path).name, f"{Path(self.repo).name} · {c.sha} · {f.path}",
                          f.path, lambda: compare.commit_versions(self.repo, c.full_sha, f)).present()
            return
        sha = row.log.full_sha
        self._collapse()
        if sha != self.expanded:
            self._expand(sha)
        else:
            self.expanded = None

    def _find(self, sha):
        """The commit row (not one of its file rows) for `sha`."""
        row = self.list.get_first_child()
        while row:
            if getattr(row, "log", None) and not getattr(row, "file", None) and row.log.full_sha == sha:
                return row
            row = row.get_next_sibling()
        return None

    def _expand(self, sha):
        index = next((i for i, r in enumerate(self.rows) if r.full_sha == sha), None)
        if index is not None and index >= self.built:
            self._build(index + 1)
        row = self._find(sha)
        if not row:
            return
        self.expanded = sha
        row.add_css_class("expanded")
        row.open_full.set_visible(True)
        if sha in self.files:
            self._insert(row, self.files[sha], None)
            return

        def work():
            try:
                files, err = git.commit_files(self.repo, sha), None
            except Exception as e:
                files, err = [], e
            GLib.idle_add(done, files, err)

        def done(files, err):
            if not err:
                self.files[sha] = files
            if self.expanded == sha and row.get_parent() is self.list:  # still open and not rebuilt
                self._insert(row, files, err)

        threading.Thread(target=work, daemon=True).start()

    def _insert(self, row, files, err):
        lanes = graph.continuation(row.lane)
        if err:
            new = [self._note_row(f"Could not list files: {err}", lanes)]
        elif not files:
            new = [self._note_row("No file changes", lanes)]
        else:
            new = [self._file_row(row.log, f, lanes) for f in files[:MAX_FILES]]
            if len(files) > MAX_FILES:
                new.append(self._note_row(f"… and {len(files) - MAX_FILES} more files", lanes))
        at = row.get_index() + 1
        for r in new:
            r.log = row.log  # notes too, so search keeps them under their commit
            r.get_child().get_first_child().set_visible(not self.query)
        for i, r in enumerate(new):
            self.list.insert(r, at + i)
        self.file_rows = new

    def _collapse(self):
        for r in self.file_rows:
            self.list.remove(r)
        self.file_rows = []
        row = self._find(self.expanded) if self.expanded else None
        if row:
            row.remove_css_class("expanded")
            row.open_full.set_visible(False)

    def _show_commit(self, r):
        self.show_diff(r.subject, f"{Path(self.repo).name} · {r.sha} · {r.author}",
                       lambda: git.show(self.repo, r.full_sha))
