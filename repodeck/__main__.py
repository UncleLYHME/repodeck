"""Entry point: `python3 -m repodeck [FOLDER...]`."""

import sys
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gdk, Gio, GLib, Gtk  # noqa: E402

from . import cache  # noqa: E402
from .window import DeckWindow  # noqa: E402

APP_ID = "dev.foundry.RepoDeck"


class App(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_OPEN)
        self.set_accels_for_action("win.add", ["<Ctrl>o"])
        self.set_accels_for_action("win.refresh", ["<Ctrl>r", "F5"])

    def do_startup(self):
        Adw.Application.do_startup(self)
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.FORCE_DARK)
        data = Path(__file__).resolve().parent.parent / "data"
        Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(str(data / "icons"))
        open_uri = Gio.SimpleAction.new("open-uri", GLib.VariantType.new("s"))  # from notifications
        open_uri.connect("activate", lambda _a, uri: Gio.AppInfo.launch_default_for_uri(uri.get_string(), None))
        self.add_action(open_uri)
        css = Gtk.CssProvider()
        css.load_from_path(str(Path(__file__).with_name("style.css")))
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def _window(self):
        return self.get_active_window() or DeckWindow(self)

    def do_shutdown(self):
        cache.shared().save()  # don't lose results computed in the last seconds before quitting
        Adw.Application.do_shutdown(self)

    def do_activate(self):
        self._window().present()

    def do_open(self, files, n_files, hint):
        win = self._window()
        win.present()
        win.add_folders([f.get_path() for f in files if f.get_path()])


def main():
    return App().run(sys.argv)


if __name__ == "__main__":
    sys.exit(main())
