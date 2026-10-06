"""Project-page charts: a weekday x hour heatmap and a stacked language bar, with legends.

Colors follow the dataviz rules: the heatmap is one hue stepped dark -> bright (sequential);
languages use the validated categorical order (dark steps, checked against the card surface)
in a fixed slot order, with "Other" in neutral gray; text stays in neutral ink.
"""

from gi.repository import Gdk, Graphene, Gsk, Gtk

from .widgets import label

CATEGORICAL = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]
OTHER_COLOR = "#5e5e66"
HEAT = ["#26282e", "#1f3a66", "#2a5aa8", "#3a78d6", "#7ea2ff"]  # empty, then increasing commits
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
CELL, GAP = 14, 3


def rgba(spec):
    c = Gdk.RGBA()
    c.parse(spec)
    return c


def rounded(snapshot, x, y, w, h, radius, color):
    rect = Graphene.Rect().init(x, y, w, h)
    rr = Gsk.RoundedRect()
    rr.init_from_rect(rect, min(radius, w / 2, h / 2))
    snapshot.push_rounded_clip(rr)
    snapshot.append_color(rgba(color), rect)
    snapshot.pop()


class Swatch(Gtk.Widget):
    """A small rounded square of one color (legends)."""

    def __init__(self, color, size=11):
        super().__init__(valign=Gtk.Align.CENTER)
        self.color, self.size = color, size

    def do_measure(self, orientation, for_size):
        return self.size, self.size, -1, -1

    def do_snapshot(self, snapshot):
        rounded(snapshot, 0, 0, self.size, self.size, 3, self.color)


def heat_level(count, peak):
    if not count or not peak:
        return 0
    return min(len(HEAT) - 1, 1 + int((count / peak) * (len(HEAT) - 2) + 0.5))


class Heatmap(Gtk.Widget):
    """When commits happen: 7 rows (Mon..Sun) x 24 hourly columns; hover a cell for its count."""

    def __init__(self):
        super().__init__(has_tooltip=True, hexpand=True)
        self.counts = {}
        self.connect("query-tooltip", self._tooltip)

    def set_counts(self, counts):
        self.counts = dict(counts)
        self.queue_draw()

    def do_measure(self, orientation, for_size):
        size = 7 * (CELL + GAP) if orientation == Gtk.Orientation.VERTICAL else 24 * 8
        return size, size, -1, -1

    def _cell_w(self):
        return (self.get_width() + GAP) / 24 - GAP

    def do_snapshot(self, snapshot):
        peak = max(self.counts.values(), default=0)
        w = self._cell_w()
        for day in range(7):
            for hour in range(24):
                color = HEAT[heat_level(self.counts.get((day, hour), 0), peak)]
                rounded(snapshot, hour * (w + GAP), day * (CELL + GAP), w, CELL, 3, color)

    def _tooltip(self, _w, x, y, _kb, tooltip):
        hour = min(23, int(x // (self._cell_w() + GAP)))
        day = min(6, int(y // (CELL + GAP)))
        n = self.counts.get((day, hour), 0)
        tooltip.set_text(f"{DAYS[day]} {hour:02d}:00–{(hour + 1) % 24:02d}:00 · {n} commit{'s' * (n != 1)}")
        return True


def heatmap_block(heatmap):
    """The heatmap with weekday labels, hour ticks and a less/more legend."""
    outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
    row = Gtk.Box(spacing=8)
    days = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    for name in DAYS:
        days.append(label(name, "axis-label", height_request=CELL + GAP, valign=Gtk.Align.CENTER))
    row.append(days)
    grid = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, hexpand=True)
    grid.append(heatmap)
    ticks = Gtk.Box(homogeneous=True)
    for hour in range(24):
        ticks.append(label(f"{hour}" if hour % 6 == 0 else "", "axis-label"))
    grid.append(ticks)
    row.append(grid)
    outer.append(row)
    legend = Gtk.Box(spacing=4, halign=Gtk.Align.END)
    legend.append(label("Less", "axis-label"))
    for color in HEAT:
        legend.append(Swatch(color))
    legend.append(label("More", "axis-label"))
    outer.append(legend)
    return outer


class StackedBar(Gtk.Widget):
    """One horizontal bar split into segments (2px surface gaps, rounded ends); hover for name and share."""

    HEIGHT = 10

    def __init__(self):
        super().__init__(has_tooltip=True, hexpand=True)
        self.parts = []  # [(name, value, color)]
        self.connect("query-tooltip", self._tooltip)

    def set_parts(self, parts):
        self.parts = parts
        self.queue_draw()

    def do_measure(self, orientation, for_size):
        size = self.HEIGHT if orientation == Gtk.Orientation.VERTICAL else 100
        return size, size, -1, -1

    def _spans(self):
        total = sum(v for _, v, _ in self.parts) or 1
        usable = self.get_width() - 2 * max(len(self.parts) - 1, 0)
        x, spans = 0.0, []
        for name, value, color in self.parts:
            w = max(2.0, usable * value / total)
            spans.append((x, w, name, value / total, color))
            x += w + 2
        return spans

    def do_snapshot(self, snapshot):
        for x, w, _name, _share, color in self._spans():
            rounded(snapshot, x, 0, w, self.HEIGHT, 4, color)

    def _tooltip(self, _w, x, _y, _kb, tooltip):
        for sx, w, name, share, _c in self._spans():
            if sx <= x <= sx + w + 2:
                tooltip.set_text(f"{name} · {'<1%' if share < 0.005 else f'{share:.0%}'}")
                return True
        return False


def language_parts(languages):
    """Fixed slot order by rank in this repo; 'Other' is always gray."""
    parts, slot = [], 0
    for name, size in languages:
        if name == "Other":
            parts.append((name, size, OTHER_COLOR))
        else:
            parts.append((name, size, CATEGORICAL[slot % len(CATEGORICAL)]))
            slot += 1
    return parts


def legend_grid(parts):
    """Swatch + name + share, two columns; text in neutral ink so identity isn't color alone."""
    total = sum(v for _, v, _ in parts) or 1
    grid = Gtk.Grid(column_spacing=18, row_spacing=6, column_homogeneous=True)
    for i, (name, value, color) in enumerate(parts):
        cell = Gtk.Box(spacing=8)
        cell.append(Swatch(color, 10))
        cell.append(label(name, hexpand=True))
        share = value / total
        cell.append(label("<1%" if 0 < share < 0.005 else f"{share:.0%}", "card-meta"))
        grid.attach(cell, i % 2, i // 2, 1, 1)
    return grid
