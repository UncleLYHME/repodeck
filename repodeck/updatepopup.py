"""The "new version" popup, and the watcher that decides when to show it."""

import threading
from pathlib import Path

from gi.repository import Adw, Gio, GLib, Gtk, Pango

from . import activity, cache, updater
from .widgets import label

FIRST_CHECK_SECONDS = 10


class UpdatePopup(Gtk.Revealer):
    """Bottom-right card: version, a few changelog lines, Later / Restart to Update."""

    def __init__(self, window):
        super().__init__(transition_type=Gtk.RevealerTransitionType.SLIDE_UP, transition_duration=250,
                         halign=Gtk.Align.END, valign=Gtk.Align.END, margin_end=18, margin_bottom=18,
                         reveal_child=False)
        self.window = window
        self.update = None
        self.dismissed = set()  # versions the user said "Later" to this session
        self._busy = False

        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, width_request=340)
        card.add_css_class("update-popup")
        head = Gtk.Box(spacing=8)
        head.append(Gtk.Image(icon_name="software-update-available-symbolic", pixel_size=16,
                              css_classes=["update-icon"]))
        self.title = label("", "update-title", hexpand=True, wrap=True)
        head.append(self.title)
        card.append(head)
        self.notes = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
        card.append(self.notes)
        self.error = label("", "update-error", wrap=True, visible=False)
        card.append(self.error)
        buttons = Gtk.Box(spacing=6, halign=Gtk.Align.END, margin_top=4)
        later = Gtk.Button(label="Later")
        later.add_css_class("flat")
        later.connect("clicked", lambda *_: self.dismiss())
        buttons.append(later)
        self.restart = Gtk.Button()
        self.restart.add_css_class("suggested-action")
        self.restart.add_css_class("pill")
        self.restart_label = label("Restart to Update")
        self.spinner = Gtk.Spinner(visible=False)
        inner = Gtk.Box(spacing=6)
        inner.append(self.spinner)
        inner.append(self.restart_label)
        self.restart.set_child(inner)
        self.restart.connect("clicked", lambda *_: self.window.restart_for_update(self.update))
        buttons.append(self.restart)
        card.append(buttons)
        self.set_child(card)

        # Event-driven for the checkout itself; a quiet fetch now and then for GitHub.
        self.monitor = Gio.File.new_for_path(str(updater.APP_DIR / updater.VERSION_FILE)).monitor_file(
            Gio.FileMonitorFlags.WATCH_MOVES, None)
        self.monitor.connect("changed", lambda *_: self.check(fetch=False))
        GLib.timeout_add_seconds(FIRST_CHECK_SECONDS, self._first_check)
        GLib.timeout_add_seconds(updater.CHECK_SECONDS, self._periodic_check)

    def _first_check(self):
        self.check()
        return GLib.SOURCE_REMOVE

    def _periodic_check(self):
        self.check()
        return GLib.SOURCE_CONTINUE

    def check(self, fetch=True):
        remote = self.window.update_checks  # with checks off, only an update already on disk shows

        def work():
            try:
                found = updater.check(fetch=fetch and remote, remote=remote)
            except Exception:  # an update check must never disturb the app
                found = None
            GLib.idle_add(self._found, found)

        threading.Thread(target=work, daemon=True).start()

    def _found(self, update):
        if not update or update.version in self.dismissed or self._busy:
            return
        if self.update and self.update.version == update.version and self.get_reveal_child():
            return
        self.update = update
        ready = update.source == "disk"
        self.title.set_label(f"RepoDeck {update.version} is ready" if ready else f"RepoDeck {update.version} is available")
        self.restart_label.set_label("Restart Now" if ready else "Restart to Update")
        while child := self.notes.get_first_child():
            self.notes.remove(child)
        for note in update.notes[:4] or ["Bug fixes and improvements."]:
            self.notes.append(label(f"• {note}", "update-note", wrap=True, wrap_mode=Pango.WrapMode.WORD_CHAR))
        self.error.set_visible(False)
        self.set_reveal_child(True)
        activity.log(self.title.get_label(), None, activity.AUTO)
        self.window.announce(self.title.get_label(), "Open RepoDeck to restart into the new version.", key="update")

    def dismiss(self):
        if self.update:
            self.dismissed.add(self.update.version)
        self.set_reveal_child(False)

    def set_busy(self, busy, error=None):
        self._busy = busy
        self.spinner.set_visible(busy)
        self.spinner.set_spinning(busy)
        self.restart.set_sensitive(not busy)
        self.error.set_visible(bool(error))
        self.error.set_label(error or "")


def restart(window, update):
    """Apply `update` (if it needs a pull), then quit and start again from the checkout."""
    popup = window.update_popup
    drafts = [p for p in window.panes() if p.commit_box.text()]
    if drafts and not getattr(window, "_restart_confirmed", False):
        names = ", ".join(sorted(Path(p.path).name for p in drafts))
        dialog = Adw.AlertDialog(heading="Restart with unsent commit messages?",
                                 body=f"Commit messages you've typed in {names} will be lost.")
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("restart", "Restart Anyway")
        dialog.set_response_appearance("restart", Adw.ResponseAppearance.DESTRUCTIVE)

        def answered(_d, response):
            if response == "restart":
                window._restart_confirmed = True
                restart(window, update)

        dialog.connect("response", answered)
        dialog.present(window)
        return
    popup.set_busy(True)

    def work():
        try:
            updater.apply(update)
            err = None
        except Exception as e:
            err = str(e)
        GLib.idle_add(done, err)

    def done(err):
        if err:
            window._restart_confirmed = False
            popup.set_busy(False, err)
            return
        activity.log(f"Restarting into RepoDeck {update.version}", None, activity.YOU)
        window.save()
        cache.shared().save()
        updater.spawn_relaunch()
        window.get_application().quit()

    threading.Thread(target=work, daemon=True).start()

