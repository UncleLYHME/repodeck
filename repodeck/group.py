"""A collapsible section holding the repositories that live in one folder."""

import math
from pathlib import Path

from gi.repository import Gio, GLib, Gtk, Pango

from . import git
from .pane import RepoPane
from .widgets import label
from .watch import FolderWatcher

MAX_COLUMNS = 3


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


class RepoGroup(Gtk.Box):
    def __init__(self, folder, expanded, watching, hidden, on_changed, on_empty):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.add_css_class("group")
        self.folder = folder
        self.panes = []
        self.watching = watching  # add projects that appear in the folder
        self.hidden = set(hidden)  # removed by hand: never auto-add these again
        self.on_changed = on_changed  # persist after edits
        self.on_activity = lambda: None  # any repo's status changed (the dashboard listens)
        self.on_empty = on_empty

        top = Gtk.Box(spacing=4)
        self.header = Gtk.Button(hexpand=True, tooltip_text=folder)
        self.header.add_css_class("flat")
        self.header.add_css_class("group-header")
        self.header.connect("clicked", lambda *_: self.set_expanded(not self.expanded))
        row = Gtk.Box(spacing=10)
        self.arrow = Gtk.Image(icon_name="pan-down-symbolic")
        row.append(self.arrow)
        row.append(label(Path(folder).name, "title-4"))
        self.count = label("", "count", valign=Gtk.Align.CENTER)
        row.append(self.count)
        self.summary = label("", "dim-label", hexpand=True, ellipsize=Pango.EllipsizeMode.END)
        row.append(self.summary)
        self.header.set_child(row)
        top.append(self.header)

        menu = Gio.Menu()
        menu.append("Show New Projects Automatically", "group.watch")
        menu.append("Remove Folder from Deck", "group.remove")
        more = Gtk.MenuButton(icon_name="view-more-symbolic", menu_model=menu, valign=Gtk.Align.CENTER,
                              tooltip_text="Folder actions")
        more.add_css_class("flat")
        top.append(more)
        self.append(top)

        actions = Gio.SimpleActionGroup()
        remove = Gio.SimpleAction.new("remove", None)
        remove.connect("activate", lambda *_: self.on_empty(self))
        actions.add_action(remove)
        watch = Gio.SimpleAction.new_stateful("watch", None, GLib.Variant.new_boolean(watching))
        watch.connect("change-state", self._on_watch_toggled)
        actions.add_action(watch)
        self.watch_action = watch
        self.insert_action_group("group", actions)
        self.watcher = FolderWatcher(folder, self.sync_folder)

        self.grid = Gtk.Grid(row_spacing=12, column_spacing=12, row_homogeneous=True,
                             column_homogeneous=True, margin_top=8)
        self.revealer = Gtk.Revealer(child=self.grid, transition_type=Gtk.RevealerTransitionType.SLIDE_DOWN,
                                     transition_duration=180)
        self.append(self.revealer)
        self.expanded = None
        self.set_expanded(expanded, save=False)

    def set_expanded(self, expanded, save=True):
        if expanded == self.expanded:
            return
        self.expanded = expanded
        self.revealer.set_reveal_child(expanded)
        self.set_vexpand(expanded)  # an open folder fills the spare height
        self.arrow.set_from_icon_name("pan-down-symbolic" if expanded else "pan-end-symbolic")
        self.header.update_state([Gtk.AccessibleState.EXPANDED], [int(expanded)])  # tristate wants an int
        if save:
            self.on_changed()

    # -- repositories -----------------------------------------------------------

    def add_repo(self, path):
        self.hidden.discard(path)
        self.panes.append(RepoPane(path, self.remove_pane, self.update_summary))

    def remove_pane(self, pane, hide=True):
        pane.close()
        self.panes.remove(pane)
        if hide:
            self.hidden.add(pane.path)
        if self.panes or self.watching:
            self.relayout()
            self.on_changed()
        else:
            self.on_empty(self)

    def close(self):
        self.watcher.close()
        for pane in self.panes:
            pane.close()

    def set_watching(self, watching):
        self.watch_action.change_state(GLib.Variant.new_boolean(watching))

    def _on_watch_toggled(self, action, value):
        action.set_state(value)
        self.watching = value.get_boolean()
        self.sync_folder()
        self.on_changed()

    def sync_folder(self):
        """Folder event: drop projects that are gone, add new ones when watching."""
        gone = [p for p in self.panes if not Path(p.path, ".git").exists()]
        for pane in gone:
            self.remove_pane(pane, hide=False)
        new = []
        if self.watching:
            known = {p.path for p in self.panes} | self.hidden
            new = [r for r in git.child_repos(self.folder) if r not in known]
            for path in new:
                self.add_repo(path)
        if new:
            self.relayout()
            self.on_changed()
        root = self.get_root()
        if root and (new or gone):
            names = ", ".join(Path(p).name for p in new) or ", ".join(Path(p.path).name for p in gone)
            root.toast(f"{'Added' if new else 'Removed'} {names}")

    def relayout(self):
        while child := self.grid.get_first_child():
            self.grid.remove(child)
        rows = max(1, math.ceil(len(self.panes) / MAX_COLUMNS))
        cols = max(1, math.ceil(len(self.panes) / rows))
        self.panes.sort(key=lambda p: not p.pinned)  # pinned first, otherwise keep the order
        for i, pane in enumerate(self.panes):
            self.grid.attach(pane, i % cols, i // cols, 1, 1)
        self.update_summary()

    def update_summary(self, *_):
        states = [(Path(p.path).name, p.status) for p in self.panes if p.status]
        dirty = [(name, st) for name, st in states if st.changes]
        ahead = sum(st.ahead for _, st in states)
        behind = sum(st.behind for _, st in states)
        files = sum(len(st.changes) for _, st in dirty)
        if not self.panes:
            parts = ["new projects in this folder will appear here"]
        else:
            parts = [f"{len(dirty)} with changes ({plural(files, 'file')})" if dirty else "all clean"]
        if ahead:
            parts.append(f"↑{ahead} to push")
        if behind:
            parts.append(f"↓{behind} to pull")
        self.on_activity()
        self.count.set_label(str(len(self.panes)))
        self.count.set_tooltip_text(plural(len(self.panes), "repository"))
        self.summary.set_label(" · ".join(parts))
        self.summary.set_tooltip_text("\n".join(f"{n}: {plural(len(st.changes), 'change')}" for n, st in dirty) or None)
