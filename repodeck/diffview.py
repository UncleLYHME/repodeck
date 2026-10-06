"""Read-only window showing a colored diff or commit."""

from gi.repository import Adw, Gtk

MAX_LINES = 20000

TAGS = {
    "add": {"paragraph_background": "rgba(46,194,126,0.16)"},
    "del": {"paragraph_background": "rgba(224,27,36,0.16)"},
    "hunk": {"foreground": "#3584e4"},
    "meta": {"weight": 700},
}


def line_tag(line):
    if line.startswith(("+++", "---", "diff ", "index ", "commit ", "new file", "deleted file", "rename ")):
        return "meta"
    if line.startswith("@@"):
        return "hunk"
    if line.startswith("+"):
        return "add"
    if line.startswith("-"):
        return "del"
    return None


class DiffWindow(Adw.Window):
    def __init__(self, parent, title, subtitle, text):
        super().__init__(transient_for=parent, default_width=1000, default_height=760, title=title)
        header = Adw.HeaderBar()
        header.set_title_widget(Adw.WindowTitle(title=title, subtitle=subtitle))

        view = Gtk.TextView(editable=False, cursor_visible=False, monospace=True,
                            left_margin=12, right_margin=12, top_margin=8, bottom_margin=8)
        buf = view.get_buffer()
        for name, props in TAGS.items():
            buf.create_tag(name, **props)

        lines = text.splitlines() or ["No differences."]
        if len(lines) > MAX_LINES:
            lines = lines[:MAX_LINES] + [f"… truncated after {MAX_LINES} lines"]
        for line in lines:
            tag = line_tag(line)
            if tag:
                buf.insert_with_tags_by_name(buf.get_end_iter(), line + "\n", tag)
            else:
                buf.insert(buf.get_end_iter(), line + "\n")

        content = Adw.ToolbarView()
        content.add_top_bar(header)
        content.set_content(Gtk.ScrolledWindow(child=view, vexpand=True))
        self.set_content(content)

        keys = Gtk.ShortcutController()
        keys.add_shortcut(Gtk.Shortcut(trigger=Gtk.ShortcutTrigger.parse_string("Escape"),
                                       action=Gtk.CallbackAction.new(lambda *_: self.close() or True)))
        self.add_controller(keys)
