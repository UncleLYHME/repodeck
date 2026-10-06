"""Compare two versions of a file: side by side (aligned, syntax highlighted) or unified."""

import difflib
import threading

import gi

gi.require_version("GtkSource", "5")
from gi.repository import Adw, GLib, Gtk, GtkSource, Pango  # noqa: E402

from . import compare  # noqa: E402
from .widgets import label  # noqa: E402

GtkSource.init()
SCHEME = "Adwaita-dark"
LINE_TAGS = {
    "del-line": {"paragraph_background": "rgba(248,81,73,0.13)"},
    "add-line": {"paragraph_background": "rgba(63,185,80,0.13)"},
    "filler": {"paragraph_background": "rgba(255,255,255,0.025)"},
    "del-word": {"background": "rgba(248,81,73,0.38)"},
    "add-word": {"background": "rgba(63,185,80,0.38)"},
}
LAYOUT = {"value": "side", "on_change": None}  # the default layout (Preferences); toggling a window updates it


def _buffer(language):
    buf = GtkSource.Buffer(highlight_matching_brackets=False)
    buf.set_style_scheme(GtkSource.StyleSchemeManager.get_default().get_scheme(SCHEME))
    if language:
        buf.set_language(language)
    for name, props in LINE_TAGS.items():
        buf.create_tag(name, **props)
    return buf


def _view(buf):
    view = GtkSource.View(buffer=buf, editable=False, cursor_visible=False, monospace=True,
                          top_margin=6, bottom_margin=6, left_margin=8, right_margin=8)
    view.add_css_class("compare-view")
    return view


def _number_gutter(view, numbers):
    """Real file line numbers (fillers stay blank), instead of buffer line numbers."""
    renderer = GtkSource.GutterRendererText(xpad=8)
    renderer.add_css_class("compare-gutter")
    width = max((len(n) for n in numbers), default=1)
    renderer.set_size_request(width * 9 + 16, -1)
    renderer.connect("query-data", lambda r, _lines, line: r.set_text(numbers[line] if line < len(numbers) else "", -1))
    view.get_gutter(Gtk.TextWindowType.LEFT).insert(renderer, 0)


class CompareWindow(Adw.Window):
    def __init__(self, parent, title, subtitle, filename, load):
        super().__init__(transient_for=parent, default_width=1280, default_height=820, title=title)
        self.filename, self.load = filename, load
        self.rows, self.starts, self.current = [], [], -1
        self.old = self.new = ""

        header = Adw.HeaderBar()
        header.set_title_widget(Adw.WindowTitle(title=title, subtitle=subtitle))
        switch = Gtk.Box(css_classes=["linked"])
        self.side_btn = Gtk.ToggleButton(label="Side by Side", active=LAYOUT["value"] == "side")
        self.unified_btn = Gtk.ToggleButton(label="Unified", group=self.side_btn, active=LAYOUT["value"] == "unified")
        for b in (self.side_btn, self.unified_btn):
            switch.append(b)
        self.side_btn.connect("toggled", lambda b: b.get_active() and self._set_layout("side"))
        self.unified_btn.connect("toggled", lambda b: b.get_active() and self._set_layout("unified"))
        header.pack_start(switch)
        nav = Gtk.Box(css_classes=["linked"])
        self.prev_btn = Gtk.Button(icon_name="go-up-symbolic", tooltip_text="Previous change (Alt+Up)")
        self.next_btn = Gtk.Button(icon_name="go-down-symbolic", tooltip_text="Next change (Alt+Down)")
        self.prev_btn.connect("clicked", lambda *_: self.jump(-1))
        self.next_btn.connect("clicked", lambda *_: self.jump(1))
        nav.append(self.prev_btn)
        nav.append(self.next_btn)
        header.pack_end(nav)
        self.summary = label("", "dim-label", "caption")
        header.pack_end(self.summary)

        self.stack = Gtk.Stack()
        self.stack.add_named(Gtk.Spinner(spinning=True, halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER,
                                         width_request=32, height_request=32), "loading")
        self.message = Adw.StatusPage(icon_name="dialog-information-symbolic")
        self.stack.add_named(self.message, "message")
        toolbar = Adw.ToolbarView(content=self.stack)
        toolbar.add_top_bar(header)
        self.set_content(toolbar)

        keys = Gtk.ShortcutController()
        for trigger, fn in (("Escape", lambda: self.close()), ("<Alt>Down", lambda: self.jump(1)),
                            ("<Alt>Up", lambda: self.jump(-1))):
            keys.add_shortcut(Gtk.Shortcut(trigger=Gtk.ShortcutTrigger.parse_string(trigger),
                                           action=Gtk.CallbackAction.new(lambda *_, f=fn: f() or True)))
        self.add_controller(keys)
        self._start()

    def _start(self):
        def work():
            try:
                old, new = self.load()
                result = (old, new, compare.align(old, new), None)
            except compare.Unreadable as e:
                result = ("", "", [], str(e))
            except Exception as e:
                result = ("", "", [], f"Could not read this file: {e}")
            GLib.idle_add(self._loaded, *result)

        threading.Thread(target=work, daemon=True).start()

    def _loaded(self, old, new, rows, error):
        self.old, self.new, self.rows = old, new, rows
        self.starts = compare.change_starts(rows)
        if error or not any(r.kind != "equal" for r in rows):
            self.message.set_title(error or "No differences")
            self.message.set_description(None if error else "Both versions are identical.")
            self.stack.set_visible_child_name("message")
            for b in (self.prev_btn, self.next_btn, self.side_btn, self.unified_btn):
                b.set_sensitive(False)
            return
        added = sum(1 for r in rows if r.right and r.kind != "equal")
        removed = sum(1 for r in rows if r.left and r.kind != "equal")
        self.summary.set_label(f"{len(self.starts)} change{'s' * (len(self.starts) != 1)} · +{added} −{removed}")
        self._build_side()
        self._build_unified()
        self._set_layout(LAYOUT["value"])
        GLib.idle_add(lambda: self.jump(1) and False)

    # -- layouts --------------------------------------------------------------------

    def _language(self):
        return GtkSource.LanguageManager.get_default().guess_language(self.filename, None)

    def _build_side(self):
        language = self._language()
        left_buf, right_buf = _buffer(language), _buffer(language)
        left_nums, right_nums = [], []
        left_lines, right_lines = [], []
        for r in self.rows:
            for side, lines, nums in ((r.left, left_lines, left_nums), (r.right, right_lines, right_nums)):
                lines.append(side[1] if side else "")
                nums.append(str(side[0]) if side else "")
        left_buf.set_text("\n".join(left_lines))
        right_buf.set_text("\n".join(right_lines))
        for i, r in enumerate(self.rows):
            if r.kind == "equal":
                continue
            for side, buf, line_tag, word_tag in ((r.left, left_buf, "del-line", "del-word"),
                                                  (r.right, right_buf, "add-line", "add-word")):
                start = buf.get_iter_at_line(i)[1]
                end = start.copy()
                end.forward_to_line_end()
                buf.apply_tag_by_name(line_tag if side else "filler", start, end)
                for a, b in (side[2] if side else []):
                    s, e = start.copy(), start.copy()
                    s.forward_chars(a)
                    e.forward_chars(b)
                    buf.apply_tag_by_name(word_tag, s, e)
        self.left_view, self.right_view = _view(left_buf), _view(right_buf)
        _number_gutter(self.left_view, left_nums)
        _number_gutter(self.right_view, right_nums)
        left_scroll = Gtk.ScrolledWindow(child=self.left_view, hexpand=True)
        right_scroll = Gtk.ScrolledWindow(child=self.right_view, hexpand=True)
        right_scroll.set_vadjustment(left_scroll.get_vadjustment())  # one vertical scroll for both sides
        halves = Gtk.Box(homogeneous=True)  # equal halves; a Paned would need a width before it has one
        halves.append(left_scroll)
        right_scroll.add_css_class("compare-right")
        halves.append(right_scroll)
        self.stack.add_named(halves, "side")

    def _build_unified(self):
        text = "".join(difflib.unified_diff(self.old.splitlines(True), self.new.splitlines(True),
                                            "a/" + self.filename, "b/" + self.filename, n=3))
        buf = _buffer(GtkSource.LanguageManager.get_default().get_language("diff"))
        buf.set_text(text)
        self.unified_view = _view(buf)
        self.unified_view.set_show_line_numbers(False)
        self.stack.add_named(Gtk.ScrolledWindow(child=self.unified_view), "unified")

    def _set_layout(self, layout):
        if layout != LAYOUT["value"]:
            LAYOUT["value"] = layout
            if LAYOUT["on_change"]:
                LAYOUT["on_change"](layout)
        if self.stack.get_child_by_name(layout):
            self.stack.set_visible_child_name(layout)
        both = layout == "side"
        self.prev_btn.set_sensitive(both)
        self.next_btn.set_sensitive(both)

    def jump(self, step):
        """Scroll to the next/previous change (side-by-side layout)."""
        if not self.starts or self.stack.get_visible_child_name() != "side":
            return False
        self.current = (self.current + step) % len(self.starts)
        buf = self.left_view.get_buffer()
        it = buf.get_iter_at_line(self.starts[self.current])[1]
        self.left_view.scroll_to_iter(it, 0.0, True, 0.0, 0.3)
        return False
