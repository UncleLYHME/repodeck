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
