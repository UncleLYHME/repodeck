"""Left navigation: Home, Projects, and a live list of every project with its state."""

from pathlib import Path

from gi.repository import Gtk, Pango

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
        self.projects = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        self.projects.add_css_class("navigation-sidebar")
        self.projects.connect("row-activated", lambda _l, row: self.on_project(row.path))
        self.append(Gtk.ScrolledWindow(child=self.projects, vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER))

    def select(self, page):
        self._syncing = True
        self.nav.select_row(self.rows[page])
        self._syncing = False

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
            row.set_tooltip_text(pane.path)
            self.projects.append(row)
        projects = self.rows["projects"].badge
        projects.set_visible(bool(dirty))
        projects.set_label(str(dirty))
        projects.set_tooltip_text(f"{dirty} with uncommitted changes")
