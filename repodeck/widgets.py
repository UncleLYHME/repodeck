"""Small widget helpers shared by the panes."""

from gi.repository import Gio, Gtk


def label(text="", *classes, **props):
    lbl = Gtk.Label(label=text, **{"xalign": 0, **props})
    for c in classes:
        lbl.add_css_class(c)
    return lbl


def section_header(title):
    """An uppercase section title with a count badge; returns (box, count label)."""
    box = Gtk.Box(spacing=8)
    box.add_css_class("section-header")
    box.append(label(title.upper(), "section-title"))
    count = label("0", "count")
    box.append(count)
    return box, count


def file_icon(path):
    """The theme's symbolic icon for a file type, guessed from its name."""
    content_type, _uncertain = Gio.content_type_guess(path, None)
    return Gtk.Image(gicon=Gio.content_type_get_symbolic_icon(content_type))


def status_class(letter):
    """CSS class colouring a git status letter (M, A, D, R, ...)."""
    return f"st-{'R' if letter == 'C' else letter}"  # st-C is reserved for conflicts


def action_popover(sections):
    """A menu popover built from plain buttons bound to actions: [[(text, action_name[, "check"]), ...], ...].

    Used instead of Gio.Menu popovers: GTK 4.14 segfaults when a GtkPopoverMenu item is activated
    through the accessibility bus (screen readers, automation). Action enablement still applies, and
    "check" items show and toggle a boolean action's state."""
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
    popover = Gtk.Popover(child=box, has_arrow=False)
    popover.add_css_class("menu")
    for i, section in enumerate(sections):
        if i:
            box.append(Gtk.Separator(margin_top=3, margin_bottom=3))
        for text, action, *kind in section:
            if kind == ["check"]:
                item = Gtk.CheckButton(label=text, action_name=action, css_classes=["menu-check"])
            else:
                item = Gtk.Button(child=label(text), action_name=action, css_classes=["flat", "menu-item"])
                item.connect("clicked", lambda *_: popover.popdown())
            box.append(item)
    return popover


def menu_button(sections, icon="view-more-symbolic", tooltip=None, **props):
    button = Gtk.MenuButton(icon_name=icon, tooltip_text=tooltip, popover=action_popover(sections), **props)
    button.add_css_class("flat")
    return button
