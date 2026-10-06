"""The branch pill: click it to switch branches, check out a remote branch, or create a new one."""

import threading

from gi.repository import GLib, Gtk, Pango

from . import gitops
from .widgets import label


class BranchButton(Gtk.MenuButton):
    def __init__(self, repo, run_op):
        super().__init__(valign=Gtk.Align.CENTER, tooltip_text="Switch branch")
        self.add_css_class("branch-button")
        self.repo, self.run_op = repo, run_op  # run_op(done message, fn(repo, status))
        self.text = label("", "branch", ellipsize=Pango.EllipsizeMode.END, max_width_chars=22)
        self.set_child(self.text)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, width_request=300)
        self.search = Gtk.SearchEntry(placeholder_text="Find or create a branch…")
        self.search.connect("search-changed", lambda *_: self.list.invalidate_filter() or self._update_create())
        self.search.connect("activate", lambda *_: self._activate_first())
        box.append(self.search)
        self.create = Gtk.Button(visible=False)
        self.create.add_css_class("flat")
        self.create.connect("clicked", lambda *_: self._create())
        box.append(self.create)
        self.list = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        self.list.add_css_class("navigation-sidebar")
        self.list.set_filter_func(self._filter)
        self.list.connect("row-activated", lambda _l, row: self._pick(row))
        box.append(Gtk.ScrolledWindow(child=self.list, propagate_natural_height=True, max_content_height=320,
                                      hscrollbar_policy=Gtk.PolicyType.NEVER))
        popover = Gtk.Popover(child=box)
        popover.connect("show", lambda *_: self._load())
        self.set_popover(popover)

    def set_label_text(self, text, tooltip):
        self.text.set_label(text)
        self.set_tooltip_text(f"{tooltip} · click to switch branch")

    def _load(self):
        self.search.set_text("")
        self.list.remove_all()

        def work():
            try:
                found = gitops.branches(self.repo)
            except Exception:
                found = None
            GLib.idle_add(self._fill, found)

        threading.Thread(target=work, daemon=True).start()
        self.search.grab_focus()

    def _fill(self, b):
        if not b:
            return
        for name, upstream in b.local:
            self.list.append(self._row(name, "local", upstream, current=name == b.current))
        for ref in b.remote:
            self.list.append(self._row(ref, "remote", None))
        self._update_create()

    def _row(self, name, kind, upstream, current=False):
        row = Gtk.ListBoxRow()
        row.name, row.kind, row.current = name, kind, current
        box = Gtk.Box(spacing=8)
        icon = "object-select-symbolic" if current else ("rd-branch-symbolic" if kind == "local" else "network-server-symbolic")
        box.append(Gtk.Image(icon_name=icon, opacity=1 if current else 0.6))
        box.append(label(name, hexpand=True, ellipsize=Pango.EllipsizeMode.MIDDLE))
        if upstream:
            box.append(label(upstream, "mono"))
        elif kind == "remote":
            box.append(label("remote", "mono"))
        row.set_child(box)
        return row

    def _filter(self, row):
        q = self.search.get_text().strip().lower()
        return not q or q in row.name.lower()

    def _update_create(self):
        name = self.search.get_text().strip()
        exists = False
        row = self.list.get_first_child()
        while row:
            exists = exists or getattr(row, "name", None) == name
            row = row.get_next_sibling()
        self.create.set_visible(bool(name) and not exists)
        self.create.set_label(f"Create branch “{name}” from here")

    def _activate_first(self):
        row = self.list.get_first_child()
        while row and not (row.get_child_visible() and self._filter(row)):
            row = row.get_next_sibling()
        if row:
            self._pick(row)
        elif self.create.get_visible():
            self._create()

    def _pick(self, row):
        self.popdown()
        if row.current:
            return
        if row.kind == "local":
            self.run_op(f"Switched to {row.name}", lambda repo, st: gitops.switch(repo, row.name))
        else:
            local = row.name.split("/", 1)[1]
            self.run_op(f"Switched to {local}", lambda repo, st: gitops.switch_remote(repo, row.name))

    def _create(self):
        name = self.search.get_text().strip()
        self.popdown()
        self.run_op(f"Created {name}", lambda repo, st: gitops.create_branch(repo, name))
