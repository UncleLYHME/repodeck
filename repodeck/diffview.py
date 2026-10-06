"""Read-only window showing a full patch (git diff / git show), syntax highlighted.

TAGS and line_tag are also used by the hunk window's per-hunk views."""

from gi.repository import Adw, Gtk

from .diffwindow import GtkSource, _buffer, _view  # syntax-highlighted git diff, same look as Compare

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

        buf = _buffer(GtkSource.LanguageManager.get_default().get_language("diff"))
        view = _view(buf)
        lines = text.splitlines() or ["No differences."]
        if len(lines) > MAX_LINES:
            lines = lines[:MAX_LINES] + [f"… truncated after {MAX_LINES} lines"]
        buf.set_text("\n".join(lines))

        content = Adw.ToolbarView()
        content.add_top_bar(header)
        content.set_content(Gtk.ScrolledWindow(child=view, vexpand=True))
        self.set_content(content)

        keys = Gtk.ShortcutController()
        keys.add_shortcut(Gtk.Shortcut(trigger=Gtk.ShortcutTrigger.parse_string("Escape"),
                                       action=Gtk.CallbackAction.new(lambda *_: self.close() or True)))
        self.add_controller(keys)
