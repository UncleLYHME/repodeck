"""Preferences (Ctrl+,): every setting in one place. Changes apply and save immediately."""

from pathlib import Path

from gi.repository import Adw, Gio, Gtk

from . import activity, autostart, cache, diffwindow, hero

FETCH_MINUTES = [2, 5, 10, 15, 30, 60]
LAYOUTS = [("side", "Side by Side"), ("unified", "Unified")]


def _switch(title, subtitle, active, on_change):
    row = Adw.SwitchRow(title=title, subtitle=subtitle or "", active=active)
    row.connect("notify::active", lambda r, _p: on_change(r.get_active()))
    return row


def _size(path):
    try:
        n = Path(path).stat().st_size
    except OSError:
        return "empty"
    return f"{n / 1024:.0f} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:.1f} MB"


class PreferencesDialog(Adw.PreferencesDialog):
    def __init__(self, window):
        super().__init__(title="Preferences", search_enabled=True)
        self.window = window
        self.add(self._general())
        self.add(self._sync())
        self.add(self._data())

    # -- pages ------------------------------------------------------------------------

    def _general(self):
        w = self.window
        page = Adw.PreferencesPage(title="General", icon_name="preferences-system-symbolic")
        app = Adw.PreferencesGroup(title="App")
        app.add(_switch("Start on Login", "Open RepoDeck when you sign in", autostart.enabled(),
                        lambda v: w.set_setting("autostart", v)))
        app.add(_switch("Desktop Notifications", "When RepoDeck is in the background: pulls, CI failures, reviews",
                        w.notify_enabled, lambda v: w.set_setting("notify", v)))
        app.add(_switch("Check for RepoDeck Updates", "Look for a new version on GitHub every 30 minutes",
                        w.update_checks, lambda v: w.set_setting("update_checks", v)))
        page.add(app)

        look = Adw.PreferencesGroup(title="Appearance")
        look.add(_switch("Animated Banner", "Drifting clouds, twinkling stars and the lighthouse beam on Home",
                         hero.MOTION["enabled"], lambda v: w.set_setting("banner_motion", v)))
        layout = Adw.ComboRow(title="Comparing Files", subtitle="How a file's changes open",
                              model=Gtk.StringList.new([t for _k, t in LAYOUTS]))
        layout.set_selected(next((i for i, (k, _t) in enumerate(LAYOUTS) if k == diffwindow.LAYOUT["value"]), 0))
        layout.connect("notify::selected", lambda r, _p: w.set_setting("diff_layout", LAYOUTS[r.get_selected()][0]))
        look.add(layout)
        page.add(look)
        return page

    def _sync(self):
        w = self.window
        page = Adw.PreferencesPage(title="Sync", icon_name="emblem-synchronizing-symbolic")
        bg = Adw.PreferencesGroup(title="In the Background",
                                  description="Fetching only updates what RepoDeck knows about the remote. "
                                              "Pulling fast-forwards the branch you're on, never other branches.")
        bg.add(_switch("Fetch Automatically", None, w.fetcher.enabled, lambda v: w.set_setting("auto-fetch", v)))
        every = Adw.ComboRow(title="Fetch Every", model=Gtk.StringList.new([f"{m} minutes" for m in FETCH_MINUTES]))
        minutes = w.fetcher.interval // 60
        every.set_selected(FETCH_MINUTES.index(minutes) if minutes in FETCH_MINUTES else 1)
        every.connect("notify::selected", lambda r, _p: w.set_setting("fetch_minutes", FETCH_MINUTES[r.get_selected()]))
        bg.add(every)
        pull = _switch("Pull Automatically", "Fast-forward only; your uncommitted changes are always kept",
                       w.auto_pull, lambda v: (w.set_setting("auto-pull", v), folders.set_sensitive(v)))
        bg.add(pull)
        page.add(bg)

        folders = Adw.PreferencesGroup(title="Pull Automatically In",
                                       description="Turn off for folders you'd rather pull by hand, such as work repositories.")
        for group in w.groups:
            n = len(group.panes)
            folders.add(_switch(Path(group.folder).name, f"{group.folder} · {n} repositor{'y' if n == 1 else 'ies'}",
                                group.auto_pull, lambda v, g=group: w.set_folder_auto_pull(g, v)))
        if not w.groups:
            folders.add(Adw.ActionRow(title="No folders yet", subtitle="Add a folder from the Projects page."))
        folders.set_sensitive(w.auto_pull)
        page.add(folders)
        return page

    def _data(self):
        page = Adw.PreferencesPage(title="Data", icon_name="drive-harddisk-symbolic")
        group = Adw.PreferencesGroup(title="Stored on This Computer")
        self.cache_row = Adw.ActionRow(title="Cache", subtitle=f"Git and GitHub results · {_size(cache.PATH)}")
        self.cache_row.add_suffix(self._button("Clear", self._clear_cache))
        group.add(self.cache_row)
        self.log_row = Adw.ActionRow(title="Activity Log",
                                     subtitle=f"{len(activity.shared().entries)} entries · {_size(activity.PATH)}")
        self.log_row.add_suffix(self._button("Clear", self._clear_log))
        group.add(self.log_row)
        settings_dir = Path(self.window.config_path).parent
        folder = Adw.ActionRow(title="Settings Folder", subtitle=str(settings_dir))
        folder.add_suffix(self._button("Open", lambda: Gio.AppInfo.launch_default_for_uri(
            Gio.File.new_for_path(str(settings_dir)).get_uri(), None)))
        group.add(folder)
        page.add(group)
        return page

    # -- helpers ----------------------------------------------------------------------

    def _button(self, text, fn):
        b = Gtk.Button(label=text, valign=Gtk.Align.CENTER)
        b.connect("clicked", lambda *_: fn())
        return b

    def _clear_cache(self):
        c = cache.shared()
        with c.lock:
            c.entries.clear()
        c.save()
        self.cache_row.set_subtitle(f"Git and GitHub results · {_size(cache.PATH)}")
        self.add_toast(Adw.Toast(title="Cache cleared; it refills as you use RepoDeck"))

    def _clear_log(self):
        activity.shared().clear()
        self.log_row.set_subtitle("0 entries · empty")
        self.add_toast(Adw.Toast(title="Activity log cleared"))
