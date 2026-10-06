"""Commit message (multi-line), Commit / Commit & Push, and the identity the commit will use."""

from gi.repository import Adw, Gio, Gtk, Pango

from .widgets import label

PLACEHOLDER = "Message (Ctrl+Enter to commit)"


class CommitBox(Gtk.Box):
    def __init__(self, on_commit, on_changed, on_set_identity):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        self.add_css_class("commit-box")
        row = Gtk.Box(spacing=6)

        self.view = Gtk.TextView(wrap_mode=Gtk.WrapMode.WORD_CHAR, accepts_tab=False, top_margin=8,
                                 bottom_margin=8, left_margin=10, right_margin=10)
        self.view.add_css_class("commit-message")
        self.view.update_property([Gtk.AccessibleProperty.LABEL], ["Commit message"])
        self.buffer = self.view.get_buffer()
        self.placeholder = label(PLACEHOLDER, "commit-placeholder", can_target=False, valign=Gtk.Align.START,
                                 margin_top=8, margin_start=11)
        self.buffer.connect("changed", lambda *_: (self.placeholder.set_visible(not self.text()), on_changed()))
        scroll = Gtk.ScrolledWindow(child=self.view, propagate_natural_height=True, max_content_height=150,
                                    hscrollbar_policy=Gtk.PolicyType.NEVER, hexpand=True)
        scroll.add_css_class("commit-message-frame")
        overlay = Gtk.Overlay(child=scroll, hexpand=True)
        overlay.add_overlay(self.placeholder)
        row.append(overlay)

        keys = Gtk.ShortcutController(propagation_phase=Gtk.PropagationPhase.CAPTURE)
        for trigger, push in (("<Control>Return", False), ("<Control><Shift>Return", True)):
            keys.add_shortcut(Gtk.Shortcut(trigger=Gtk.ShortcutTrigger.parse_string(trigger),
                                           action=Gtk.CallbackAction.new(lambda *_, p=push: on_commit(p) or True)))
        self.view.add_controller(keys)

        menu = Gio.Menu()
        menu.append("Commit & Push (Ctrl+Shift+Enter)", "pane.commit-push")
        self.button = Adw.SplitButton(label="Commit", menu_model=menu, sensitive=False, valign=Gtk.Align.START,
                                      tooltip_text="Commit the checked files (Ctrl+Enter)")
        self.button.add_css_class("suggested-action")
        self.button.connect("clicked", lambda *_: on_commit(False))
        row.append(self.button)
        self.append(row)

        ident = Gtk.Box(spacing=6)
        self.identity = label("", "identity", hexpand=True, ellipsize=Pango.EllipsizeMode.END)
        ident.append(self.identity)
        self.fix = Gtk.Button(label="Set identity…", visible=False)
        self.fix.add_css_class("flat")
        self.fix.add_css_class("identity-fix")
        self.fix.connect("clicked", lambda *_: on_set_identity())
        ident.append(self.fix)
        self.append(ident)

    def text(self):
        start, end = self.buffer.get_bounds()
        return self.buffer.get_text(start, end, False).strip()

    def clear(self):
        self.buffer.set_text("")

    def set_button(self, text, sensitive):
        self.button.set_label(text)
        self.button.set_sensitive(sensitive)

    def set_identity(self, name, email):
        missing = not (name and email)
        self.identity.set_label("No git identity here: commits will fail" if missing else f"as {name} <{email}>")
        self.identity.set_tooltip_text("user.name / user.email from git config" if not missing else
                                       "Git has no user.name/user.email for this repository.")
        (self.identity.add_css_class if missing else self.identity.remove_css_class)("identity-missing")
        self.fix.set_visible(missing)

