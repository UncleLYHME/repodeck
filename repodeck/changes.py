"""The Changes list: checkboxes choose what to commit; per-file discard; stash count."""

from pathlib import Path

from gi.repository import Gdk, GLib, Gtk, Pango

from . import gitops, skeleton
from .widgets import file_icon, label, section_header, status_class

MAX_CHANGES = 1000


class ChangesView(Gtk.Box):
    def __init__(self, on_open, on_discard, on_selection, on_ignore):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.on_open, self.on_discard, self.on_selection = on_open, on_discard, on_selection
        self.on_ignore = on_ignore  # (change, pattern, untrack paths)
        self.changes = []
        self.excluded = set()  # unchecked paths survive refreshes
        self._syncing = False

        header, self.count = section_header("Changes")
        self.stashed = label("", "stash-pill", visible=False, valign=Gtk.Align.CENTER)
        header.append(self.stashed)
        header.append(Gtk.Box(hexpand=True))
        self.discard_btn = Gtk.Button(icon_name="edit-undo-symbolic", tooltip_text="Discard checked changes…",
                                      valign=Gtk.Align.CENTER, sensitive=False)
        self.discard_btn.add_css_class("flat")
        self.discard_btn.add_css_class("row-action")
        self.discard_btn.connect("clicked", lambda *_: self.on_discard(self.selected()))
        header.append(self.discard_btn)
        self.select_all = Gtk.CheckButton(tooltip_text="Select all")
        self.select_all.connect("toggled", self._on_select_all)
        header.append(self.select_all)
        self.append(header)

        self.list = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        self.list.add_css_class("changes")
        self.list.set_placeholder(label("Working tree clean", "dim-label", "placeholder", xalign=0.5))
        self.list.connect("row-activated", lambda _l, row: self.on_open(row.change))
        # Grows with the change count up to a cap; history gets the remaining height.
        self.append(Gtk.ScrolledWindow(child=self.list, propagate_natural_height=True,
                                       max_content_height=260, hscrollbar_policy=Gtk.PolicyType.NEVER))
        for i in range(2):  # until the first status arrives
            self.list.append(skeleton.list_row(i, "check"))

    def render(self, changes):
        self.changes = changes
        self.excluded &= {c.path for c in changes}
        self.list.remove_all()
        for change in changes[:MAX_CHANGES]:
            self.list.append(self._row(change))
        self.count.set_label(str(len(changes)))
        self.sync_controls()

    def set_stashes(self, stashes):
        self.stashed.set_visible(bool(stashes))
        self.stashed.set_label(f"{len(stashes)} stashed")
        self.stashed.set_tooltip_text("\n".join(s.split("\x1f")[-1] for s in stashes[:10]) or None)

    def _row(self, change):
        row = Gtk.ListBoxRow()
        row.change = change
        box = Gtk.Box(spacing=8)
        row.check = Gtk.CheckButton(active=change.path not in self.excluded)
        row.check.connect("toggled", self._on_toggle, change.path)
        box.append(row.check)
        p = Path(change.path)
        box.append(file_icon(change.path))
        box.append(label(p.name, ellipsize=Pango.EllipsizeMode.MIDDLE))
        parent = "" if str(p.parent) == "." else str(p.parent)
        box.append(label(parent, "dim-label", "caption", hexpand=True, ellipsize=Pango.EllipsizeMode.START))
        if change.partial:
            box.append(label("partial", "caption", "staged", tooltip_text=(
                "Part of this file is staged: Commit takes only the staged part. Open it to stage or unstage hunks.")))
        elif change.staged:
            box.append(label("staged", "caption", "staged"))
        if change.kind != "conflict":
            undo = Gtk.Button(icon_name="edit-undo-symbolic", tooltip_text="Discard changes…", valign=Gtk.Align.CENTER)
            undo.add_css_class("flat")
            undo.add_css_class("row-action")
            undo.add_css_class("row-discard")
            undo.connect("clicked", lambda *_: self.on_discard([change]))
            box.append(undo)
        box.append(label(change.letter, "status", "st-C" if change.kind == "conflict" else status_class(change.letter)))
        row.set_child(box)
        row.set_tooltip_text((f"{change.orig} → {change.path}" if change.orig else change.path)
                             + "\nRight-click for more")
        click = Gtk.GestureClick(button=3)
        click.connect("pressed", lambda _g, _n, x, y: self._menu(row, x, y))
        row.add_controller(click)
        press = Gtk.GestureLongPress()
        press.connect("pressed", lambda _g, x, y: self._menu(row, x, y))
        row.add_controller(press)
        keys = Gtk.ShortcutController()
        for trigger in ("<Shift>F10", "Menu"):
            keys.add_shortcut(Gtk.Shortcut(trigger=Gtk.ShortcutTrigger.parse_string(trigger),
                                           action=Gtk.CallbackAction.new(lambda *_: self._menu(row) or True)))
        row.add_controller(keys)
        return row

    def _menu(self, row, x=None, y=None):
        """Context menu: open, ignore (file / extension / folder), discard."""
        change = row.change
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        popover = Gtk.Popover(child=box, has_arrow=False)
        popover.add_css_class("menu")

        def item(text, fn, *classes):
            b = Gtk.Button(child=label(text), css_classes=["flat", "menu-item", *classes])
            b.connect("clicked", lambda *_: (popover.popdown(), fn()))
            box.append(b)

        item("Open Changes", lambda: self.on_open(change))
        if change.kind != "conflict":
            # A file git already tracks keeps being tracked after it's ignored, so "this file" untracks it too.
            tracked = change.kind == "tracked" and change.x not in "A?"
            box.append(Gtk.Separator())
            for i, (text, pattern) in enumerate(gitops.ignore_choices(change)):
                untrack = [change.path] if i == 0 and tracked else []
                verb = "Stop Tracking & Ignore" if untrack else "Ignore"
                item(f"{verb} {text}",
                     lambda p=pattern, u=untrack: self.on_ignore(change, p, u))
            box.append(Gtk.Separator())
            item("Discard Changes…", lambda: self.on_discard([change]), "menu-destructive")
        popover.set_parent(row)
        popover.connect("closed", lambda p: GLib.idle_add(p.unparent))
        if x is not None:
            rect = Gdk.Rectangle()
            rect.x, rect.y, rect.width, rect.height = int(x), int(y), 1, 1
            popover.set_pointing_to(rect)
        popover.popup()

    # -- selection ----------------------------------------------------------------

    def selected(self):
        return [c for c in self.changes[:MAX_CHANGES] if c.path not in self.excluded]

    def sync_controls(self):
        n, total = len(self.selected()), len(self.changes)
        self._syncing = True
        self.select_all.set_sensitive(total > 0)
        self.select_all.set_inconsistent(0 < n < total)
        self.select_all.set_active(total > 0 and n == total)
        self._syncing = False
        self.discard_btn.set_sensitive(any(c.kind != "conflict" for c in self.selected()))
        self.on_selection()

    def _on_toggle(self, check, path):
        (self.excluded.discard if check.get_active() else self.excluded.add)(path)
        if not self._syncing:
            self.sync_controls()

    def _on_select_all(self, check):
        if self._syncing:
            return
        select = check.get_active()
        self.excluded = set() if select else {c.path for c in self.changes}
        self._syncing = True
        row = self.list.get_first_child()
        while row:
            if hasattr(row, "check"):
                row.check.set_active(select)
            row = row.get_next_sibling()
        self._syncing = False
        self.sync_controls()
