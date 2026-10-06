"""Main window: sidebar navigation, the Home dashboard, and the Projects deck of repo panes."""

import json
from pathlib import Path

from gi.repository import Adw, Gdk, Gio, GLib, Gtk

from . import git
from .fetcher import AutoFetcher
from .dashboard import Dashboard
from . import autostart
from .group import RepoGroup, plural
from .project import ProjectPage
from . import updatepopup
from .updatepopup import UpdatePopup
from .sidebar import Sidebar
from .watch import Throttle

CONFIG = Path(GLib.get_user_config_dir()) / "repodeck" / "repos.json"
SAFETY_REFRESH_SECONDS = 60  # file events drive updates; this only refreshes relative dates and catches misses


def load_config():
    """{auto_fetch, auto_pull, groups: [{folder, expanded, watch, hidden, repos}]}.

    The old flat list of repos is grouped by parent folder."""
    try:
        data = json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        data = {}
    if isinstance(data, list):
        groups = {}
        for repo in data:
            groups.setdefault(str(Path(repo).parent), []).append(repo)
        data = {"groups": [{"folder": f, "expanded": True, "repos": r} for f, r in groups.items()]}
    groups = [{**g, "repos": [r for r in g.get("repos", []) if Path(r).is_dir()]} for g in data.get("groups", [])]
    return {"auto_fetch": data.get("auto_fetch", True), "auto_pull": data.get("auto_pull", True),
            "notify": data.get("notify", True), "pinned": set(data.get("pinned", [])), "groups": groups}


class DeckWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="RepoDeck", default_width=1600, default_height=980)
        self.groups = []

        # Projects page: the folder sections of repo panes.
        self.sections = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12,
                                margin_top=12, margin_bottom=12, margin_start=12, margin_end=12)
        empty_btn = Gtk.Button(label="Add Folder", action_name="win.add", halign=Gtk.Align.CENTER)
        empty_btn.add_css_class("pill")
        empty_btn.add_css_class("suggested-action")
        empty = Adw.StatusPage(icon_name="folder-symbolic", title="No repositories yet",
                               description="Add a git repository, or a folder that contains several.", child=empty_btn)
        self.stack = Gtk.Stack()
        self.stack.add_named(empty, "empty")
        self.deck_scroll = Gtk.ScrolledWindow(child=self.sections)
        self.stack.add_named(self.deck_scroll, "deck")

        self.dashboard = Dashboard(self)
        self.pages = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE, transition_duration=150)
        self.pages.add_named(self.dashboard, "home")
        self.pages.add_named(self.stack, "projects")
        self.project_page = ProjectPage(self)
        self.pages.add_named(self.project_page, "project")

        header = Adw.HeaderBar(show_start_title_buttons=False)
        self.title = Adw.WindowTitle(title="Home")
        header.set_title_widget(self.title)
        add = Gtk.Button(child=Adw.ButtonContent(icon_name="list-add-symbolic", label="Add Folder"),
                         action_name="win.add", tooltip_text="Add a repository or a folder of repositories (Ctrl+O)")
        header.pack_start(add)
        refresh = Gtk.Button(icon_name="view-refresh-symbolic", action_name="win.refresh", tooltip_text="Refresh all (F5)")
        header.pack_end(refresh)
        menu = Gio.Menu()
        menu.append("Fetch All Now", "win.fetch-all")
        menu.append("Fetch Automatically (every 5 min)", "win.auto-fetch")
        menu.append("Pull Automatically (fast-forward only)", "win.auto-pull")
        prefs = Gio.Menu()
        prefs.append("Desktop Notifications When in Background", "win.notify")
        prefs.append("Start on Login", "win.autostart")
        menu.append_section(None, prefs)
        header.pack_end(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu, tooltip_text="Main menu"))
        self.fold_all = Gtk.Button(icon_name="view-list-symbolic", action_name="win.toggle-all")
        header.pack_end(self.fold_all)

        self.toasts = Adw.ToastOverlay(child=self.pages)
        self.update_popup = UpdatePopup(self)
        floating = Gtk.Overlay(child=self.toasts)
        floating.add_overlay(self.update_popup)
        drop = Gtk.DropTarget.new(Gdk.FileList, Gdk.DragAction.COPY)
        drop.connect("drop", lambda _t, files, _x, _y: self.add_folders(
            [f.get_path() for f in files.get_files() if f.get_path() and Path(f.get_path()).is_dir()]) or True)
        self.toasts.add_controller(drop)
        content = Adw.ToolbarView(content=floating)
        content.add_top_bar(header)

        self.sidebar = Sidebar(self.show_page, self.show_project)
        side_header = Adw.HeaderBar(show_end_title_buttons=False)
        side_header.set_title_widget(Adw.WindowTitle(title="RepoDeck"))
        side = Adw.ToolbarView(content=self.sidebar)
        side.add_top_bar(side_header)
        split = Adw.OverlaySplitView(sidebar=side, content=content, min_sidebar_width=210, max_sidebar_width=240)
        self.set_content(split)
        self.notify_activity = Throttle(250, self._on_activity)

        config = load_config()
        self.fetcher = AutoFetcher(self.panes, config["auto_fetch"])
        for name, fn in (("add", self.choose_folders), ("refresh", self.refresh_now),
                         ("toggle-all", self.toggle_all), ("fetch-all", self.fetcher.fetch)):
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", lambda *_, fn=fn: fn())
            self.add_action(action)
        self.auto_pull = config["auto_pull"]  # read by panes when new remote commits are fetched
        self.notify_enabled = config["notify"]
        self.pinned = config["pinned"]
        config["autostart"] = autostart.enabled()
        for name, on_change in (("auto-fetch", self._on_auto_fetch), ("auto-pull", self._on_auto_pull),
                                ("notify", self._on_notify), ("autostart", self._on_autostart)):
            key = name.replace("-", "_")
            toggle = Gio.SimpleAction.new_stateful(name, None, GLib.Variant.new_boolean(config[key]))
            toggle.connect("change-state", on_change)
            self.add_action(toggle)

        for g in config["groups"]:
            watching = g.get("watch", True)
            if g["repos"] or watching:
                group = self._add_group(g["folder"], g.get("expanded", True), watching, g.get("hidden", []))
                for repo in g["repos"]:
                    group.add_repo(repo)
                for pane in group.panes:
                    pane.set_pinned(pane.path in self.pinned)
                group.relayout()
                group.sync_folder()  # pick up projects created or deleted while the app was closed
        self._update_view()
        self.show_page("home")
        GLib.timeout_add_seconds(SAFETY_REFRESH_SECONDS, self._safety_refresh)
        self.connect("notify::is-active", lambda *_: self.is_active() and self.refresh_all())

    # -- folders & repos --------------------------------------------------------

    def save(self):
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        data = {"auto_fetch": self.fetcher.enabled, "auto_pull": self.auto_pull, "notify": self.notify_enabled,
                "pinned": sorted(self.pinned),
                "groups": [{"folder": g.folder, "expanded": g.expanded, "watch": g.watching,
                            "hidden": sorted(g.hidden), "repos": [p.path for p in g.panes]}
                           for g in self.groups]}
        CONFIG.write_text(json.dumps(data, indent=2) + "\n")
        self._update_view()

    def _add_group(self, folder, expanded, watching, hidden=()):
        group = RepoGroup(folder, expanded, watching, hidden, self.save, self.remove_group)
        group.on_activity = self.notify_activity
        self.groups.append(group)
        self.sections.append(group)
        return group

    def remove_group(self, group):
        group.close()
        self.groups.remove(group)
        self.sections.remove(group)
        self.save()
        self.notify_activity()

    def add_folders(self, folders):
        added = 0
        for folder in folders:
            if not Path(folder).is_dir():
                self.toast(f"Not a folder: {folder}")
                continue
            # A single repo joins its parent folder's section; a folder of projects gets its own
            # section, which keeps watching for new projects.
            root = git.toplevel(folder)
            section = str(Path(root).parent if root else Path(folder).resolve())
            group = next((g for g in self.groups if g.folder == section), None)
            if not group:
                group = self._add_group(section, True, watching=not root)
            elif not root:
                group.set_watching(True)  # may already add the new projects itself
            group.set_expanded(True, save=False)
            known = {p.path for g in self.groups for p in g.panes}
            repos = [r for r in git.find_repos(folder) if r not in known]
            for repo in repos:
                group.add_repo(repo)
            group.relayout()
            added += len(repos)
            if not repos and not group.panes:
                self.toast(f"Watching {Path(section).name} for new projects")
        if added:
            self.toast(f"Added {plural(added, 'repository')}")
        self.save()

    def choose_folders(self):
        dialog = Gtk.FileDialog(title="Add repository or folder of repositories")
        dialog.select_multiple_folders(self, None, self._on_folders_chosen)

    def _on_folders_chosen(self, dialog, result):
        try:
            files = dialog.select_multiple_folders_finish(result)
        except GLib.Error:
            return  # cancelled
        self.add_folders([f.get_path() for f in files if f.get_path()])

    # -- pages ------------------------------------------------------------------

    def panes(self):
        return [p for g in self.groups for p in g.panes]

    def show_page(self, page, path=None):
        self.pages.set_visible_child_name(page)
        self.title.set_title({"home": "Home", "projects": "Projects"}.get(page) or Path(path).name)
        self.title.set_subtitle("Project analytics" if page == "project" else "")
        self.fold_all.set_visible(page == "projects")
        self.sidebar.select(page, path)
        if page == "home":
            self.dashboard.schedule()

    def show_project(self, path):
        """The analytics page for one repository."""
        self.show_page("project", path)
        self.project_page.show(path)

    def open_project(self, path):
        """Show a repo's panel on the Projects page: open its folder, scroll to it and flash it."""
        for group in self.groups:
            pane = next((p for p in group.panes if p.path == path), None)
            if pane:
                break
        else:
            return
        self.show_page("projects")
        group.set_expanded(True)

        def reveal():
            ok, bounds = pane.compute_bounds(self.sections)
            if ok:
                adj = self.deck_scroll.get_vadjustment()
                adj.set_value(max(0, bounds.get_y() - 12))
            pane.add_css_class("flash")
            GLib.timeout_add(1400, lambda: pane.remove_css_class("flash") or GLib.SOURCE_REMOVE)
            return GLib.SOURCE_REMOVE

        GLib.timeout_add(220, reveal)  # after the folder's reveal animation has laid it out

    def _on_activity(self):
        self.sidebar.update(self.panes())
        self.dashboard.schedule()
        if self.pages.get_visible_child_name() == "project":
            path = self.project_page.path
            if any(p.path == path for p in self.panes()):
                self.project_page.show(path)  # same project: live refresh
            else:
                self.show_page("home")  # it was removed or deleted

    # -- view & refresh ---------------------------------------------------------

    def _on_auto_fetch(self, action, value):
        action.set_state(value)
        self.fetcher.enabled = value.get_boolean()
        self.save()

    def _on_auto_pull(self, action, value):
        action.set_state(value)
        self.auto_pull = value.get_boolean()
        self.save()
        for pane in (p for g in self.groups for p in g.panes):
            pane.maybe_auto_pull()  # catch up on anything already fetched

    def _on_notify(self, action, value):
        action.set_state(value)
        self.notify_enabled = value.get_boolean()
        self.save()

    def _on_autostart(self, action, value):
        try:
            autostart.set_enabled(value.get_boolean())
        except OSError as e:
            self.alert("Couldn't change Start on Login", str(e))
            return
        action.set_state(value)

    def toggle_pin(self, pane):
        pinned = not pane.pinned
        pane.set_pinned(pinned)
        (self.pinned.add if pinned else self.pinned.discard)(pane.path)
        for group in self.groups:
            if pane in group.panes:
                group.relayout()
        self.save()
        self.notify_activity()

    def toggle_all(self):
        expand = not any(g.expanded for g in self.groups)
        for g in self.groups:
            g.set_expanded(expand, save=False)
        self.save()

    def _update_view(self):
        self.stack.set_visible_child_name("deck" if self.groups else "empty")
        any_open = any(g.expanded for g in self.groups)
        self.fold_all.set_tooltip_text("Collapse all folders" if any_open else "Expand all folders")

    def refresh_all(self):
        for g in self.groups:
            for pane in g.panes:
                pane.refresh()

    def restart_for_update(self, update):
        updatepopup.restart(self, update)

    def refresh_now(self):
        """F5 / the refresh button: everything, including GitHub data that's normally reused for a while."""
        self.refresh_all()
        self.dashboard.refresh_github(force=True)
        if self.pages.get_visible_child_name() == "project":
            self.project_page.reload()

    def _safety_refresh(self):
        self.refresh_all()
        return GLib.SOURCE_CONTINUE

    # -- feedback ---------------------------------------------------------------

    def toast(self, message):
        self.toasts.add_toast(Adw.Toast(title=GLib.markup_escape_text(message), timeout=3))

    def announce(self, message, body=None, key=None, uri=None):
        """A toast while the window is focused; a desktop notification while it's in the background."""
        if self.is_active() or not self.notify_enabled:
            self.toast(message)
            return
        note = Gio.Notification.new(message)
        if body:
            note.set_body(body)
        if uri:
            note.set_default_action_and_target_value("app.open-uri", GLib.Variant.new_string(uri))
        self.get_application().send_notification(key, note)

    def alert(self, heading, body):
        dialog = Adw.AlertDialog(heading=heading, body=body)
        dialog.add_response("ok", "OK")
        dialog.present(self)
