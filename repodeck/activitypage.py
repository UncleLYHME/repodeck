"""Activity page: the log of what RepoDeck did, grouped by day, newest first."""

from datetime import date, datetime
from pathlib import Path

from gi.repository import Adw, Gtk, Pango

from . import activity
from .widgets import label

ICONS = {  # (who, level) -> icon
    activity.ERROR: "dialog-error-symbolic",
    activity.WARN: "dialog-warning-symbolic",
    activity.AUTO: "emblem-synchronizing-symbolic",
    activity.YOU: "avatar-default-symbolic",
}
FILTERS = [("all", "All"), ("auto", "Automatic"), ("problems", "Problems")]


def day_title(d):
    today = date.today()
    if d == today:
        return "Today"
    if (today - d).days == 1:
        return "Yesterday"
    return f"{d:%A, %B} {d.day}"


class ActivityPage(Gtk.ScrolledWindow):
    def __init__(self, window):
        super().__init__(hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.window = window  # show_project(path), sidebar badge
        self.filter = "all"
        self.unseen_problems = 0

        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14, margin_top=24, margin_bottom=32)
        page.add_css_class("dashboard")
        head = Gtk.Box(spacing=10)
        titles = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True)
        titles.append(label("Activity", "project-title"))
        titles.append(label("What RepoDeck did: background fetches and pulls, updates, and actions you ran.", "card-meta",
                            wrap=True))
        head.append(titles)
        clear = Gtk.Button(label="Clear", valign=Gtk.Align.CENTER, tooltip_text="Clear the activity log")
        clear.add_css_class("pill")
        clear.connect("clicked", lambda *_: self._confirm_clear())
        head.append(clear)
        page.append(head)

        bar = Gtk.Box(spacing=10)
        group = Gtk.Box(css_classes=["linked"])
        first = None
        for key, text in FILTERS:
            b = Gtk.ToggleButton(label=text, group=first, active=key == "all")
            first = first or b
            b.connect("toggled", lambda btn, k=key: btn.get_active() and self._set_filter(k))
            group.append(b)
        bar.append(group)
        self.search = Gtk.SearchEntry(placeholder_text="Search activity…", hexpand=True)
        self.search.connect("search-changed", lambda *_: self.list.invalidate_filter())
        bar.append(self.search)
        page.append(bar)

        self.list = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        self.list.add_css_class("boxed-list")
        self.list.set_filter_func(self._visible)
        self.list.set_header_func(self._header)
        self.list.connect("row-activated", lambda _l, row: row.entry.repo and self.window.show_project(row.entry.repo))
        self.empty = Adw.StatusPage(icon_name="document-open-recent-symbolic", title="Nothing here yet",
                                    description="Fetches, pulls, updates and your actions will show up here.")
        self.stack = Gtk.Stack(vhomogeneous=False)  # a short list shouldn't take the empty state's height
        self.stack.add_named(self.list, "list")
        self.stack.add_named(self.empty, "empty")
        page.append(self.stack)
        self.set_child(Adw.Clamp(child=page, maximum_size=860, margin_start=16, margin_end=16))

        for entry in activity.shared().entries:
            self.list.prepend(self._row(entry))
        activity.shared().subscribe(self._on_entry)
        self._update_empty()

    # -- rows -----------------------------------------------------------------------

    def _row(self, e):
        row = Gtk.ListBoxRow(activatable=bool(e.repo))
        row.entry = e
        box = Gtk.Box(spacing=12, margin_top=10, margin_bottom=10, margin_start=14, margin_end=14)
        icon = ICONS.get(e.level) if e.level != activity.INFO else ICONS[e.who]
        box.append(Gtk.Image(icon_name=icon, css_classes=[f"activity-{e.level}", f"activity-{e.who}"]))
        text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, hexpand=True)
        text.append(label(e.message, wrap=True, wrap_mode=Pango.WrapMode.WORD_CHAR))
        who = "Automatic" if e.who == activity.AUTO else "You"
        text.append(label(f"{Path(e.repo).name} · {who}" if e.repo else who, "card-meta"))
        box.append(text)
        box.append(label(datetime.fromtimestamp(e.ts).strftime("%H:%M"), "card-meta", valign=Gtk.Align.START))
        row.set_child(box)
        where = f" in {Path(e.repo).name}" if e.repo else ""
        row.update_property([Gtk.AccessibleProperty.LABEL],
                            [f"{e.message}{where}, {'automatic' if e.who == activity.AUTO else 'you'}, "
                             f"{datetime.fromtimestamp(e.ts):%H:%M}"])
        if e.repo:
            row.set_tooltip_text(f"{e.repo}\nClick for this project")
        return row

    def _header(self, row, before):
        d = datetime.fromtimestamp(row.entry.ts).date()
        if before is None or datetime.fromtimestamp(before.entry.ts).date() != d:
            row.set_header(label(day_title(d), "activity-day"))
        else:
            row.set_header(None)

    def _visible(self, row):
        e = row.entry
        if self.filter == "auto" and e.who != activity.AUTO:
            return False
        if self.filter == "problems" and e.level == activity.INFO:
            return False
        q = self.search.get_text().strip().lower()
        return not q or q in e.message.lower() or (e.repo and q in Path(e.repo).name.lower())

    def _set_filter(self, key):
        self.filter = key
        self.list.invalidate_filter()

    # -- updates --------------------------------------------------------------------

    def _on_entry(self, entry):
        if entry is None:
            self.list.remove_all()
        else:
            self.list.prepend(self._row(entry))
            if entry.level != activity.INFO and not self.get_mapped():
                self.unseen_problems += 1
        self.list.invalidate_headers()
        self._update_empty()
        self.window.sidebar.set_activity_badge(self.unseen_problems)
        return False

    def seen(self):
        self.unseen_problems = 0
        self.window.sidebar.set_activity_badge(0)

    def _update_empty(self):
        self.stack.set_visible_child_name("list" if self.list.get_first_child() else "empty")

    def _confirm_clear(self):
        dialog = Adw.AlertDialog(heading="Clear the activity log?", body="This removes every entry. It can't be undone.")
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("clear", "Clear")
        dialog.set_response_appearance("clear", Adw.ResponseAppearance.DESTRUCTIVE)
        dialog.connect("response", lambda _d, r: r == "clear" and activity.shared().clear())
        dialog.present(self.get_root())

