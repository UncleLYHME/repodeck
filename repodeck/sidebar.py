"""Left navigation: Home, Projects, and a live list of every project with its state."""

from pathlib import Path

from gi.repository import Gtk, Pango

from . import __version__
from .widgets import label


class Sidebar(Gtk.Box):
    def __init__(self, on_page, on_project):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.add_css_class("deck-sidebar")
        self.on_page, self.on_project = on_page, on_project
        self._syncing = False

        self.nav = Gtk.ListBox(selection_mode=Gtk.SelectionMode.SINGLE)
        self.nav.add_css_class("navigation-sidebar")
        self.rows = {}
        for page, title, icon in (("home", "Home", "go-home-symbolic"), ("projects", "Projects", "view-grid-symbolic")):
            row = Gtk.ListBoxRow()
            row.page = page
            box = Gtk.Box(spacing=10)
            box.append(Gtk.Image(icon_name=icon))
            box.append(label(title, hexpand=True))
            row.badge = label("", "side-badge", visible=False, valign=Gtk.Align.CENTER)
            box.append(row.badge)
            row.set_child(box)
            self.nav.append(row)
            self.rows[page] = row
        self.nav.connect("row-selected", self._on_nav)
        self.append(self.nav)

        self.append(label("PROJECTS", "side-heading"))
        self.current = None  # path of the project page being shown
        self.projects = Gtk.ListBox(selection_mode=Gtk.SelectionMode.SINGLE)
        self.projects.add_css_class("navigation-sidebar")
        self.projects.connect("row-activated", lambda _l, row: self.on_project(row.path))
        self.append(Gtk.ScrolledWindow(child=self.projects, vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER))
        self.append(label(f"RepoDeck {__version__}", "side-version"))

    def select(self, page, path=None):
        """Highlight Home/Projects, or (page == "project") the project's row."""
        self._syncing = True
        if page in self.rows:
            self.nav.select_row(self.rows[page])
        else:
            self.nav.unselect_all()
        self.current = path if page == "project" else None
        self._select_current()
        self._syncing = False

    def _select_current(self):
        row = self.projects.get_first_child()
        while row:
            if getattr(row, "path", None) == self.current:
                self.projects.select_row(row)
                return
            row = row.get_next_sibling()
        self.projects.unselect_all()

    def _on_nav(self, _list, row):
        if row and not self._syncing:
            self.on_page(row.page)

    def update(self, panes):
        """Rebuild the project list: orange dot = uncommitted changes, blue = ahead/behind, grey = clean."""
        self.projects.remove_all()
        dirty = 0
        for pane in sorted(panes, key=lambda p: (not p.pinned, Path(p.path).name.lower())):
            st = pane.status
            if st and st.changes:
                css, badge = "dot-busy", str(len(st.changes))
                dirty += 1
            elif st and (st.ahead or st.behind):
                css, badge = "dot-sync", f"↑{st.ahead}" if st.ahead else f"↓{st.behind}"
            else:
                css, badge = "dot-idle", ""
            row = Gtk.ListBoxRow()
            row.path = pane.path
            box = Gtk.Box(spacing=10)
            box.append(label("●", "dot", css))
            box.append(label(Path(pane.path).name, hexpand=True, ellipsize=Pango.EllipsizeMode.END))
            if pane.pinned:
                box.append(label("★", "side-pin", tooltip_text="Pinned"))
            if badge:
                box.append(label(badge, "side-count", valign=Gtk.Align.CENTER))
            row.set_child(box)
            row.set_tooltip_text(f"{pane.path}\nClick for this project's analytics")
            self.projects.append(row)
        self._select_current()
        projects = self.rows["projects"].badge
        projects.set_visible(bool(dirty))
        projects.set_label(str(dirty))
        projects.set_tooltip_text(f"{dirty} with uncommitted changes")
