"""Commit-graph lane layout and drawing.

`layout` assigns every commit a column and lists the line segments crossing its row:
  pass  a lane running straight through the row
  in    a lane arriving at this commit (top half, may curve into the node)
  out   an edge leaving this commit for a parent's lane (bottom half)
Rows are drawn independently but edges meet exactly at row boundaries, so lines stay continuous.
"""

from dataclasses import dataclass

import gi

gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
gi.require_version("Gsk", "4.0")
gi.require_version("Graphene", "1.0")
from gi.repository import Gdk, Graphene, Gsk, Gtk  # noqa: E402

COLORS = ["#3584e4", "#ff7800", "#2ec27e", "#c061cb", "#e5a50a", "#e01b24", "#26c6da", "#f66151"]
LANE_WIDTH = 14
MAX_LANES = 12
NODE_RADIUS = 4.5
LINE_WIDTH = 2


@dataclass
class GraphRow:
    col: int
    color: int
    lines: list  # (kind, from_col, to_col, color)


def _slot(lanes, colors):
    if None in lanes:
        return lanes.index(None)
    lanes.append(None)
    colors.append(0)
    return len(lanes) - 1


def layout(commits):
    """commits: [(sha, [parent shas])] newest first, children before parents."""
    lanes, colors = [], []  # sha each column is waiting for; color index per column
    next_color = 0
    rows = []
    for sha, parents in commits:
        if sha in lanes:
            col = lanes.index(sha)
        else:  # branch tip: start a new lane
            col = _slot(lanes, colors)
            colors[col] = next_color
            next_color += 1
        node_color = colors[col]

        lines = []
        for i, waiting in enumerate(lanes):
            if waiting == sha:
                lines.append(("in", i, col, colors[i]))
                if i != col:
                    lanes[i] = None  # this branch line ends here
            elif waiting is not None:
                lines.append(("pass", i, i, colors[i]))

        lanes[col] = parents[0] if parents else None
        if parents:
            lines.append(("out", col, col, colors[col]))
        for parent in parents[1:]:
            if parent in lanes:
                j = lanes.index(parent)
            else:
                j = _slot(lanes, colors)
                lanes[j] = parent
                colors[j] = next_color
                next_color += 1
            lines.append(("out", col, j, colors[j]))

        while lanes and lanes[-1] is None:
            lanes.pop()
            colors.pop()
        rows.append(GraphRow(col, node_color, lines))
    return rows


def continuation(row):
    """A node-less row carrying the lanes below `row` straight down (for rows inserted under it)."""
    lanes = {b: color for kind, _a, b, color in row.lines if kind in ("pass", "out")}
    return GraphRow(-1, 0, [("pass", col, col, color) for col, color in sorted(lanes.items())])


def lane_count(rows):
    used = [max([r.col] + [max(a, b) for _, a, b, _ in r.lines]) + 1 for r in rows]
    return min(max(used, default=1), MAX_LANES)


def _x(col):
    return LANE_WIDTH * col + LANE_WIDTH / 2 + 2


def _rgba(index):
    rgba = Gdk.RGBA()
    rgba.parse(COLORS[index % len(COLORS)])
    return rgba


class GraphCell(Gtk.Widget):
    """The graph slice for one history row, drawn edge to edge so lanes join the rows above and below."""

    def __init__(self, row, lanes):
        super().__init__()
        self.row = row
        self.width = lanes * LANE_WIDTH + 4

    def do_measure(self, orientation, for_size):
        size = self.width if orientation == Gtk.Orientation.HORIZONTAL else 0
        return size, size, -1, -1

    def do_snapshot(self, snapshot):
        height = self.get_height()
        mid = height / 2
        stroke = Gsk.Stroke.new(LINE_WIDTH)
        stroke.set_line_cap(Gsk.LineCap.ROUND)
        for kind, a, b, color in self.row.lines:
            xa, xb = _x(a), _x(b)
            path = Gsk.PathBuilder.new()
            if kind == "pass":
                path.move_to(xa, 0)
                path.line_to(xa, height)
            elif kind == "in":  # from the top edge of lane a into the node
                path.move_to(xa, 0)
                if a == b:
                    path.line_to(xb, mid)
                else:
                    path.cubic_to(xa, mid * 0.6, xb, mid * 0.4, xb, mid)
            else:  # from the node down to the bottom edge of lane b
                path.move_to(xa, mid)
                if a == b:
                    path.line_to(xb, height)
                else:
                    path.cubic_to(xa, mid * 1.6, xb, mid * 1.4, xb, height)
            snapshot.append_stroke(path.to_path(), stroke, _rgba(color))

        if self.row.col < 0:
            return  # continuation row: lines only
        node = Gsk.PathBuilder.new()
        node.add_circle(Graphene.Point().init(_x(self.row.col), mid), NODE_RADIUS)
        snapshot.append_fill(node.to_path(), Gsk.FillRule.WINDING, _rgba(self.row.color))
