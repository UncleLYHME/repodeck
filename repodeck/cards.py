"""Building blocks for the Home dashboard: cards, list rows and the activity bar chart."""

from gi.repository import Adw, Gdk, Graphene, Gsk, Gtk, Pango

from . import skeleton
from .widgets import label

BAR = "#3b6fe0"
BAR_TODAY = "#6f97ff"
BAR_EMPTY = "rgba(255,255,255,0.08)"


class Card(Gtk.Box):
    """A titled dashboard card; fill `self.body`, optionally set a count badge and a footnote."""

    def __init__(self, title, icon):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.add_css_class("dash-card")
        head = Gtk.Box(spacing=8)
        head.append(Gtk.Image(icon_name=icon, pixel_size=14, css_classes=["card-icon"]))
        head.append(label(title, "card-title"))
        self.count = label("", "card-count", visible=False)
        head.append(self.count)
        self.extra = Gtk.Box(hexpand=True, halign=Gtk.Align.END)
        head.append(self.extra)
        self.append(head)
        self.body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, vexpand=True)
        self.append(self.body)
        self.loading()
        self.note = label("", "card-note", visible=False)
        self.append(self.note)

    def set_count(self, n):
        self.count.set_visible(bool(n))
        self.count.set_label(str(n))

    def set_note(self, text):
        self.note.set_visible(bool(text))
        self.note.set_label(text or "")

    def clear(self):
        while child := self.body.get_first_child():
            self.body.remove(child)

    def loading(self, n=3):
        """Skeleton rows until the card's data arrives (the first clear() removes them)."""
        self.clear()
        self.body.append(skeleton.rows(n, "dot"))

    def empty(self, text):
        self.body.append(label(text, "card-empty", wrap=True))

    def subhead(self, text, *classes):
        self.body.append(label(text, "card-subhead", *classes))


def row(*cells, on_click=None, tooltip=None):
    """A dashboard list row. `cells` are widgets; give the one that should stretch hexpand=True."""
    box = Gtk.Box(spacing=10)
    for cell in cells:
        box.append(cell)
    if not on_click:
        box.add_css_class("dash-row")
        box.set_tooltip_text(tooltip)
        return box
    button = Gtk.Button(child=box, tooltip_text=tooltip)
    button.add_css_class("flat")
    button.add_css_class("dash-row")
    button.connect("clicked", lambda *_: on_click())
    return button


def text(s, *classes, expand=False, chars=None):
    return label(s, *classes, hexpand=expand, ellipsize=Pango.EllipsizeMode.END,
                 **({"max_width_chars": chars} if chars else {}))


def dot(css):
    return label("●", "dot", css, valign=Gtk.Align.CENTER)


def icon(name, *classes):
    return Gtk.Image(icon_name=name, pixel_size=14, css_classes=list(classes))


def _rgba(spec):
    c = Gdk.RGBA()
    c.parse(spec)
    return c


class Bars(Gtk.Widget):
    """Daily commit bars that grow in when the numbers change; hover a bar for its date and count."""

    def __init__(self, height=78):
        super().__init__(has_tooltip=True, hexpand=True)
        self.height = height
        self.days = []  # [(date, count)]
        self.progress = 1.0
        target = Adw.CallbackAnimationTarget.new(self._tick)
        self.anim = Adw.TimedAnimation.new(self, 0, 1, 650, target)
        self.anim.set_easing(Adw.Easing.EASE_OUT_CUBIC)
        self.connect("query-tooltip", self._tooltip)

    def set_days(self, days):
        if days == self.days:
            return
        self.days = days
        self.anim.reset()
        self.anim.play()

    def _tick(self, value):
        self.progress = value
        self.queue_draw()

    def do_measure(self, orientation, for_size):
        size = self.height if orientation == Gtk.Orientation.VERTICAL else 120
        return size, size, -1, -1

    def _slot(self):
        n = max(len(self.days), 1)
        return self.get_width() / n

    def do_snapshot(self, snapshot):
        if not self.days:
            return
        h = self.height
        slot = self._slot()
        gap = min(6, slot * 0.25)
        peak = max((c for _, c in self.days), default=0) or 1
        for i, (_day, count) in enumerate(self.days):
            x = i * slot + gap / 2
            bar_h = max(2.0, (count / peak) * (h - 4) * self.progress) if count else 2.0
            color = BAR_EMPTY if not count else (BAR_TODAY if i == len(self.days) - 1 else BAR)
            rect = Graphene.Rect().init(x, h - bar_h, slot - gap, bar_h)
            rounded = Gsk.RoundedRect()
            rounded.init_from_rect(rect, min(3, bar_h / 2))
            snapshot.push_rounded_clip(rounded)
            snapshot.append_color(_rgba(color), rect)
            snapshot.pop()

    def _tooltip(self, _widget, x, _y, _keyboard, tooltip):
        if not self.days:
            return False
        i = min(int(x // self._slot()), len(self.days) - 1)
        day, count = self.days[i]
        tooltip.set_text(f"{day:%a %b %-d}: {count} commit{'s' * (count != 1)}")
        return True


def day_letters(days):
    box = Gtk.Box(homogeneous=True)
    for day, _ in days:
        box.append(label(f"{day:%a}"[0], "day-letter", xalign=0.5))
    return box
