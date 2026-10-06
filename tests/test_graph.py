import unittest

from repodeck.graph import continuation, layout


def edges(row, kind):
    return sorted((a, b) for k, a, b, _ in row.lines if k == kind)


class LayoutTest(unittest.TestCase):
    def test_linear_history_stays_in_one_lane(self):
        rows = layout([("c", ["b"]), ("b", ["a"]), ("a", [])])
        self.assertEqual([r.col for r in rows], [0, 0, 0])
        self.assertEqual(edges(rows[0], "in"), [])  # branch tip: nothing above
        self.assertEqual(edges(rows[1], "in"), [(0, 0)])
        self.assertEqual(edges(rows[2], "out"), [])  # root: nothing below

    def test_merge_opens_lane_and_branch_rejoins(self):
        #  M merges F into main; F and B both sit on A.
        rows = layout([("M", ["B", "F"]), ("F", ["A"]), ("B", ["A"]), ("A", [])])
        m, f, b, a = rows
        self.assertEqual(edges(m, "out"), [(0, 0), (0, 1)])
        self.assertEqual((f.col, edges(f, "pass")), (1, [(0, 0)]))
        self.assertEqual((b.col, edges(b, "pass")), (0, [(1, 1)]))
        self.assertEqual(edges(a, "in"), [(0, 0), (1, 0)])  # both lines converge on A
        self.assertEqual(edges(a, "pass"), [])

    def test_lanes_stay_continuous_between_rows(self):
        # Every line leaving the bottom of a row must enter the top of the next row in the same column.
        commits = [("T2", ["X"]), ("M", ["B", "F"]), ("X", ["B"]), ("F", ["A"]), ("B", ["A"]), ("A", [])]
        rows = layout(commits)
        for upper, lower in zip(rows, rows[1:]):
            bottoms = {b for k, a, b, _ in upper.lines if k in ("pass", "out")}
            tops = {a for k, a, b, _ in lower.lines if k in ("pass", "in")}
            self.assertEqual(bottoms, tops)


    def test_continuation_carries_lanes_below_a_commit(self):
        rows = layout([("M", ["B", "F"]), ("F", ["A"]), ("B", ["A"]), ("A", [])])
        cont = continuation(rows[0])
        self.assertEqual(cont.col, -1)
        self.assertEqual(edges(cont, "pass"), [(0, 0), (1, 1)])  # merge opened lane 1 below M
        self.assertEqual(edges(continuation(rows[3]), "pass"), [])  # nothing below the root


if __name__ == "__main__":
    unittest.main()
