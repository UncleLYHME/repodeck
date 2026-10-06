"""A file's working-tree changes split into hunks you can stage, unstage or discard one by one."""

import threading
from pathlib import Path

from gi.repository import Adw, GLib, Gtk

from . import gitops
from .diffview import TAGS, line_tag
from .widgets import label


def hunk_text(body):
    view = Gtk.TextView(editable=False, cursor_visible=False, monospace=True, left_margin=10, right_margin=10,
                        top_margin=4, bottom_margin=6)
    buf = view.get_buffer()
    for name, props in TAGS.items():
        buf.create_tag(name, **props)
    for line in body.splitlines()[1:]:  # the @@ line is shown in the header
        tag = line_tag(line)
        if tag:
            buf.insert_with_tags_by_name(buf.get_end_iter(), line + "\n", tag)
        else:
            buf.insert(buf.get_end_iter(), line + "\n")
    return view


class HunkWindow(Adw.Window):
    def __init__(self, parent, repo, change, on_done):
        name = Path(change.path).name
        super().__init__(transient_for=parent, default_width=980, default_height=760, title=name)
        self.repo, self.change, self.on_done = repo, change, on_done
        header = Adw.HeaderBar()
        header.set_title_widget(Adw.WindowTitle(title=name, subtitle=f"{Path(repo).name} · {change.path}"))
        self.content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, margin_top=12, margin_bottom=16,
                               margin_start=14, margin_end=14)
        toolbar = Adw.ToolbarView(content=Gtk.ScrolledWindow(child=self.content, vexpand=True))
        toolbar.add_top_bar(header)
        self.set_content(toolbar)
        keys = Gtk.ShortcutController()
        keys.add_shortcut(Gtk.Shortcut(trigger=Gtk.ShortcutTrigger.parse_string("Escape"),
                                       action=Gtk.CallbackAction.new(lambda *_: self.close() or True)))
        self.add_controller(keys)
        self.load()

    def load(self):
        def work():
            try:
                result = (gitops.hunks(self.repo, self.change.path, staged=False),
                          gitops.hunks(self.repo, self.change.path, staged=True), None)
            except Exception as e:
                result = ([], [], e)
            GLib.idle_add(self._render, *result)

        threading.Thread(target=work, daemon=True).start()

    def _render(self, unstaged, staged, error):
        while child := self.content.get_first_child():
            self.content.remove(child)
        if error:
            self.content.append(label(f"Could not read the diff: {error}", "card-empty", wrap=True))
            return
        if not unstaged and not staged:
            self.content.append(label("No text changes left in this file.", "card-empty"))
        for title, hunks, staged_side in (("Unstaged", unstaged, False), ("Staged", staged, True)):
            if not hunks:
                continue
            self.content.append(label(f"{title.upper()} · {len(hunks)}", "section-title"))
            for hunk in hunks:
                self.content.append(self._hunk_card(hunk, staged_side))

    def _hunk_card(self, hunk, staged):
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        card.add_css_class("hunk-card")
        head = Gtk.Box(spacing=6)
        head.add_css_class("hunk-head")
        head.append(label(hunk.title, "mono-strong", hexpand=True))
        actions = [("Unstage", gitops.unstage_hunk, False)] if staged else \
                  [("Discard", gitops.discard_hunk, True), ("Stage", gitops.stage_hunk, False)]
        for text, fn, destructive in actions:
            button = Gtk.Button(label=text, valign=Gtk.Align.CENTER)
            button.add_css_class("pill-button")
            if destructive:
                button.add_css_class("destructive-pill")
            button.connect("clicked", lambda _b, f=fn, h=hunk, d=destructive: self._act(f, h, d))
            head.append(button)
        card.append(head)
        card.append(hunk_text(hunk.body))
        return card

    def _act(self, fn, hunk, destructive):
        if destructive:
            dialog = Adw.AlertDialog(heading="Discard this change?",
                                     body="These lines go back to their last committed or staged version. "
                                          "This can't be undone.")
            dialog.add_response("cancel", "Cancel")
            dialog.add_response("discard", "Discard")
            dialog.set_response_appearance("discard", Adw.ResponseAppearance.DESTRUCTIVE)
            dialog.connect("response", lambda _d, r: r == "discard" and self._run(fn, hunk))
            dialog.present(self)
        else:
            self._run(fn, hunk)

    def _run(self, fn, hunk):
        def work():
            try:
                fn(self.repo, hunk)
                err = None
            except Exception as e:
                err = e
            GLib.idle_add(done, err)

        def done(err):
            if err:
                dialog = Adw.AlertDialog(heading="That didn't apply", body=str(err))
                dialog.add_response("ok", "OK")
                dialog.present(self)
            self.on_done()
            self.load()

        threading.Thread(target=work, daemon=True).start()
