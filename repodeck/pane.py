"""One repository panel: header, commit box, changes list and history graph."""

import shutil
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import quote

from gi.repository import Adw, Gio, GLib, Gtk, Pango

from . import git, gitops, stats
from .branches import BranchButton
from .changes import ChangesView
from .commitbox import CommitBox
from .diffview import DiffWindow
from .history import HistoryView
from .hunkview import HunkWindow
from .watch import RepoWatcher
from .widgets import label


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


class RepoPane(Gtk.Box):
    def __init__(self, path, on_remove, on_status=lambda pane: None):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, hexpand=True, vexpand=True)
        self.add_css_class("card")
        self.add_css_class("pane")
        self.set_size_request(380, 460)
        self.path = path
        self.on_remove = on_remove
        self.on_status = on_status  # lets the folder header and dashboard summarize this repo
        self.status = None
        self.rows = None
        self.extras = None  # (identity, stashes, GitHub slug)
        self.pinned = False
        self._loading = self._pending = self._busy = False
        self.fetching = False  # managed by AutoFetcher
        self.last_fetch = 0.0  # time.monotonic() of the last finished fetch
        self.fetched_at = None  # wall-clock label for the tooltip
        self.fetch_error = None
        self._pulling = False
        self.pull_blocked = None  # why the last automatic pull could not run; retried on the next change

        self._install_actions()
        self.append(self._build_header())
        self.banner = Adw.Banner(button_label="Abort…")
        self.banner.connect("button-clicked", lambda *_: self._confirm_abort())
        self.append(self.banner)
        self.commit_box = CommitBox(self.commit, self._update_commit_button, self._set_identity_dialog)
        self.append(self.commit_box)
        self.changes = ChangesView(self._open_change, self._confirm_discard, self._update_commit_button)
        self.append(self.changes)
        self.history = HistoryView(path, self._show_diff)
        self.append(self.history)
        self.watcher = RepoWatcher(path, self.refresh)  # also does the first refresh

    def close(self):
        self.watcher.close()

    # -- layout ---------------------------------------------------------------

    def _build_header(self):
        box = Gtk.Box(spacing=8)
        box.add_css_class("pane-header")
        names = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True)
        self.title = label(Path(self.path).name, "heading", ellipsize=Pango.EllipsizeMode.END)
        names.append(self.title)
        names.append(label(self.path, "dim-label", "caption", ellipsize=Pango.EllipsizeMode.START))
        box.append(names)
        self.spinner = Gtk.Spinner()
        box.append(self.spinner)
        self.branch = BranchButton(self.path, self._op)
        box.append(self.branch)
        self.sync = label("", "caption", "dim-label", valign=Gtk.Align.CENTER)
        box.append(self.sync)
        self.pending = label("", "caption", "pending", valign=Gtk.Align.CENTER, visible=False)
        box.append(self.pending)

        menu = Gio.Menu()
        for section in (
            [("Fetch", "fetch"), ("Pull (fast-forward)", "pull"), ("Push", "push")],
            [("Open on GitHub", "github"), ("Create Pull Request", "pull-request")],
            [("Stash All Changes", "stash"), ("Apply Latest Stash", "stash-pop")],
            [("Pin to Top", "pin"), ("Open in Files", "files")]
            + ([("Open in VS Code", "code")] if shutil.which("code") else []) + [("Remove from Deck", "remove")],
        ):
            part = Gio.Menu()
            for text, action in section:
                part.append(text, f"pane.{action}")
            menu.append_section(None, part)
        more = Gtk.MenuButton(icon_name="view-more-symbolic", menu_model=menu, valign=Gtk.Align.CENTER)
        more.add_css_class("flat")
        box.append(more)
        return box

    def _install_actions(self):
        self.actions = Gio.SimpleActionGroup()
        handlers = {
            "fetch": lambda: self._op("Fetched", git.fetch, after=lambda: self.fetch_finished(None, 0, None)),
            "commit-push": lambda: self.commit(push=True),
            "pull": lambda: self._op("Pulled", git.pull),
            "push": lambda: self._op("Pushed", git.push),
            "github": lambda: self._launch(self._github_url()),
            "pull-request": lambda: self._launch(self._github_url(compare=True)),
            "stash": lambda: self._op("Stashed all changes", lambda repo, st: gitops.stash(repo)),
            "stash-pop": lambda: self._op("Applied the latest stash", lambda repo, st: gitops.stash_pop(repo)),
            "files": lambda: self._launch(Gio.File.new_for_path(self.path).get_uri()),
            "code": lambda: subprocess.Popen(["code", self.path], start_new_session=True),
            "remove": lambda: self.on_remove(self),
        }
        for name, fn in handlers.items():
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", lambda *_, fn=fn: fn())
            self.actions.add_action(action)
        pin = Gio.SimpleAction.new_stateful("pin", None, GLib.Variant.new_boolean(False))
        pin.connect("change-state", lambda *_: self.get_root().toggle_pin(self))
        self.actions.add_action(pin)
        self.insert_action_group("pane", self.actions)
        self._enable_extras()

    def set_pinned(self, pinned):
        self.pinned = pinned
        self.actions.lookup_action("pin").set_state(GLib.Variant.new_boolean(pinned))
        (self.title.add_css_class if pinned else self.title.remove_css_class)("pinned")
        self.title.set_label(("★ " if pinned else "") + Path(self.path).name)

    def _enable_extras(self):
        _ident, stashes, slug = self.extras or (None, [], None)
        st = self.status
        on_branch = bool(st and st.branch != "(detached)")
        self.actions.lookup_action("github").set_enabled(bool(slug))
        self.actions.lookup_action("pull-request").set_enabled(bool(slug and st and st.upstream and on_branch))
        self.actions.lookup_action("stash").set_enabled(bool(st and st.changes))
        self.actions.lookup_action("stash-pop").set_enabled(bool(stashes))

    # -- data -----------------------------------------------------------------

    def refresh(self):
        if self._loading:
            self._pending = True
            return
        self._loading = True

        def work():
            try:
                st = git.status(self.path)
                extras = (gitops.identity(self.path), gitops.stashes(self.path), stats.github_slug(self.path))
                result = (st, git.log(self.path, st), extras, None)
            except Exception as e:  # missing folder, corrupt repo, ...
                result = (None, None, None, e)
            GLib.idle_add(self._apply, *result)

        threading.Thread(target=work, daemon=True).start()

    def _apply(self, st, rows, extras, error):
        self._loading = False
        if error:
            self.branch.set_label_text("unavailable", str(error))
            self.sync.set_label("")
            self.set_tooltip_text(str(error))
        else:
            self.set_tooltip_text(None)
            if extras != self.extras:
                self.extras = extras
                (name, email), stashes, _slug = extras
                self.commit_box.set_identity(name, email)
                self.changes.set_stashes(stashes)
            if st != self.status:
                self.status = st
                self._render_status()
                self.on_status(self)
                self.maybe_auto_pull()
            if rows != self.rows:
                self.rows = rows
                self.history.set_rows(rows)
                self.on_status(self)  # e.g. fetched commits on another branch
            self._enable_extras()
        if self._pending:
            self._pending = False
            self.refresh()

    def _render_status(self):
        st = self.status
        self.branch.set_label_text(st.branch if st.branch != "(detached)" else f"detached {st.oid[:7]}",
                                   f"Tracking {st.upstream}" if st.upstream else "No upstream branch")
        self._render_sync()
        self.changes.render(st.changes)
        conflicts = sum(1 for c in st.changes if c.kind == "conflict")
        if st.operation:
            title = f"{st.operation.capitalize()} in progress"
            if conflicts:
                title += f" · {plural(conflicts, 'conflict')}" + (" (opens in VS Code)" if shutil.which("code") else "")
            self.banner.set_title(title)
        self.banner.set_revealed(bool(st.operation))

    def _render_sync(self):
        st = self.status
        if not st:
            return
        text = f"↑{st.ahead} ↓{st.behind}" if st.upstream else "local"
        tip = [f"{st.ahead} to push, {st.behind} to pull" if st.upstream else "No upstream branch"]
        if self.fetched_at:
            tip.append(f"Last fetched at {self.fetched_at}")
        if self.fetch_error:
            text = f"⚠ {text}"
            tip.append(f"Background fetch failed: {self.fetch_error}")
        self.sync.set_label(text)
        self.sync.set_tooltip_text("\n".join(tip))

        pending, why = None, None
        if st.upstream and st.behind and st.ahead:
            pending = "syncs on push"
            why = (f"You have {st.ahead} unpushed and the remote has {st.behind} new. Push replays your "
                   "commits on top of the remote's, then pushes; on a conflict nothing changes.")
        elif st.behind and st.operation:
            pending, why = "pull pending", f"Waiting for the {st.operation} in progress to finish."
        elif st.behind and self.pull_blocked:
            pending = "pull pending"
            why = f"{self.pull_blocked}\nRetries automatically when these files are committed, reverted or stashed."
        self.pending.set_visible(bool(pending))
        self.pending.set_label(pending or "")
        self.pending.set_tooltip_text(why)

    def fetch_finished(self, error, behind_before, fresh):
        self.fetching = False
        self.last_fetch = time.monotonic()
        self.fetched_at = time.strftime("%H:%M")
        self.fetch_error = (str(error).strip().splitlines() or [type(error).__name__])[0] if error else None
        self._render_sync()
        root = self.get_root()
        # New commits that will be pulled automatically get a "pulled" message instead.
        if root and fresh and fresh.behind > behind_before and not (root.auto_pull and fresh.can_fast_forward):
            new = fresh.behind - behind_before
            root.announce(f"{Path(self.path).name}: {plural(new, 'new commit')} to pull", key=f"behind:{self.path}")

    # -- commit, discard, identity --------------------------------------------------

    def _update_commit_button(self):
        n = len(self.changes.selected())
        ok = n > 0 and bool(self.commit_box.text()) and not self._busy
        self.commit_box.set_button(f"Commit {n}" if n else "Commit", ok)

    def commit(self, push=False):
        picked, message = self.changes.selected(), self.commit_box.text()
        if not picked or not message or self._busy:
            return

        def committed():
            self.commit_box.clear()
            if push:  # a separate step, so a failed push still reports the commit as done
                self._op("Pushed", git.push)

        self._op(f"Committed {plural(len(picked), 'file')}",
                 lambda repo, st: git.commit(repo, st, message, picked), after=committed)

    def _confirm_discard(self, changes):
        changes = [c for c in changes if c.kind != "conflict"]
        if not changes:
            return
        new = sum(1 for c in changes if c.kind == "untracked" or c.x in "AC")
        what = Path(changes[0].path).name if len(changes) == 1 else plural(len(changes), "file")
        body = "Edits go back to the last commit and can't be recovered."
        if new:
            body += f" {plural(new, 'new file')} will be moved to the Trash."
        dialog = Adw.AlertDialog(heading=f"Discard changes to {what}?", body=body)
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("discard", "Discard")
        dialog.set_response_appearance("discard", Adw.ResponseAppearance.DESTRUCTIVE)
        dialog.connect("response", lambda _d, r: r == "discard" and self._op(
            f"Discarded {plural(len(changes), 'file')}", lambda repo, st: gitops.discard(repo, st, changes)))
        dialog.present(self.get_root())

    def _confirm_abort(self):
        op = self.status.operation if self.status else None
        if not op:
            return
        dialog = Adw.AlertDialog(heading=f"Abort the {op}?",
                                 body=f"This returns the branch to where it was before the {op} started. "
                                      "Conflict resolutions you've made so far are thrown away.")
        dialog.add_response("cancel", "Keep Going")
        dialog.add_response("abort", "Abort")
        dialog.set_response_appearance("abort", Adw.ResponseAppearance.DESTRUCTIVE)
        dialog.connect("response", lambda _d, r: r == "abort" and self._op(
            f"Aborted the {op}", lambda repo, st: gitops.abort(repo, op)))
        dialog.present(self.get_root())

    def _set_identity_dialog(self):
        profiles = gitops.profiles()
        name, email = Gtk.Entry(placeholder_text="Name"), Gtk.Entry(placeholder_text="Email")
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        if profiles:
            choices = Gtk.DropDown.new_from_strings([f"{lbl}: {e}" for lbl, _n, e in profiles] + ["Custom"])
            def pick(*_):
                i = choices.get_selected()
                if i < len(profiles):
                    name.set_text(profiles[i][1])
                    email.set_text(profiles[i][2])
            choices.connect("notify::selected", pick)
            box.append(choices)
            # Preselect the profile named after a folder on this repo's path (e.g. .../Personal/app -> Personal).
            parts = [part.lower() for part in Path(self.path).parts]
            choices.set_selected(next((i for i, (lbl, _n, _e) in enumerate(profiles) if lbl.lower() in parts), 0))
            pick()
        box.append(name)
        box.append(email)
        dialog = Adw.AlertDialog(heading=f"Commit identity for {Path(self.path).name}",
                                 body="Saved in this repository's own git config (user.name / user.email).",
                                 extra_child=box)
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("save", "Save")
        dialog.set_response_appearance("save", Adw.ResponseAppearance.SUGGESTED)
        dialog.connect("response", lambda _d, r: r == "save" and self._op(
            "Identity saved", lambda repo, st, n=name.get_text(), e=email.get_text(): gitops.set_identity(repo, n, e)))
        dialog.present(self.get_root())

    # -- keeping up to date -----------------------------------------------------

    def maybe_auto_pull(self):
        """Fast-forward onto fetched remote commits. Re-runs on every status change, so a blocked
        pull is retried as soon as the files in the way are committed or reverted."""
        st, root = self.status, self.get_root()
        if not (root and root.auto_pull and st and st.can_fast_forward) or self._pulling or self._busy:
            return
        self._pulling = True
        incoming = st.behind

        def work():
            try:
                git.fast_forward(self.path)
                err = None
            except Exception as e:
                err = e
            GLib.idle_add(done, err)

        def done(err):
            self._pulling = False
            if err:
                self.pull_blocked = (str(err).strip().splitlines() or ["pull failed"])[0]
            else:
                self.pull_blocked = None
                root = self.get_root()
                if root:
                    root.announce(f"{Path(self.path).name}: pulled {plural(incoming, 'new commit')}",
                                  key=f"pulled:{self.path}")
            self._render_sync()

        threading.Thread(target=work, daemon=True).start()

    # -- background work --------------------------------------------------------

    def _op(self, done_msg, fn, after=None):
        if self._busy or not self.status:
            return
        self._busy = True
        self.spinner.start()
        self._update_commit_button()
        st = self.status

        def work():
            try:
                fn(self.path, st)
                err = None
            except Exception as e:  # GitError, timeouts
                err = e
            GLib.idle_add(finish, err)

        def finish(err):
            self._busy = False
            self.spinner.stop()
            root = self.get_root()
            if err:
                root.alert(f"{Path(self.path).name}: action failed", str(err))
            else:
                if after:
                    after()
                root.toast(f"{Path(self.path).name}: {done_msg}")
            self.refresh()

        threading.Thread(target=work, daemon=True).start()

    def _github_url(self, compare=False):
        slug = self.extras[2] if self.extras else None
        branch = quote(self.status.branch, safe="/") if self.status else ""
        if compare:
            return f"https://github.com/{slug}/compare/{branch}?expand=1"
        return f"https://github.com/{slug}/tree/{branch}" if branch and branch != "%28detached%29" else \
            f"https://github.com/{slug}"

    def _launch(self, uri):
        Gio.AppInfo.launch_default_for_uri(uri, None)

    def _show_diff(self, title, subtitle, fn):
        def work():
            try:
                text = fn()
            except Exception as e:
                text = f"Could not load diff:\n{e}"
            GLib.idle_add(lambda: DiffWindow(self.get_root(), title, subtitle, text).present())

        threading.Thread(target=work, daemon=True).start()

    def _open_change(self, change):
        st = self.status
        if change.kind == "conflict" and shutil.which("code"):
            subprocess.Popen(["code", "-g", str(Path(self.path, change.path))], start_new_session=True)
        elif change.kind == "tracked" and not st.operation:
            HunkWindow(self.get_root(), self.path, change, self.refresh).present()
        else:
            self._show_diff(Path(change.path).name, f"{Path(self.path).name} · {change.path}",
                            lambda: git.file_diff(self.path, st, change))
