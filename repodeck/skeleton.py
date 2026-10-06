"""Skeleton placeholders: shimmering bars shown where content is still loading.

The shimmer is a CSS animation (style.css: .skeleton), so it stops by itself when the
desktop's "reduce animation" setting is on.
"""

from gi.repository import Gtk

WIDTHS = [190, 140, 230, 120, 170, 210, 150]  # varied so a stack of rows doesn't read as a grid


def bar(width, height=10, *classes, hexpand=False):
    b = Gtk.Box(width_request=width, height_request=height, valign=Gtk.Align.CENTER, hexpand=hexpand,
                halign=Gtk.Align.FILL if hexpand else Gtk.Align.START)
    b.add_css_class("skeleton")
    for c in classes:
        b.add_css_class(c)
    b.update_property([Gtk.AccessibleProperty.LABEL], ["Loading"])
    return b


def line(i, lead=None):
    """One placeholder row: optional leading dot, a text bar of varying width, a short meta bar."""
    box = Gtk.Box(spacing=10, margin_top=6, margin_bottom=6)
    if lead == "dot":
        box.append(bar(9, 9, "skeleton-dot"))
    elif lead == "check":
        box.append(bar(16, 16))
    box.append(bar(WIDTHS[i % len(WIDTHS)]))
    box.append(Gtk.Box(hexpand=True))
    box.append(bar(56 + (i * 13) % 30, 8))
    return box


def rows(n, lead=None):
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    for i in range(n):
        box.append(line(i, lead))
    return box


def list_row(i, lead=None):
    """A non-interactive Gtk.ListBoxRow holding one placeholder line."""
    row = Gtk.ListBoxRow(activatable=False, selectable=False, focusable=False)
    row.add_css_class("skeleton-row")
    row.set_child(line(i, lead))
    return row
