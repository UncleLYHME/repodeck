import tempfile
import unittest
from pathlib import Path

from repodeck import compare, git
from tests import test_git  # noqa: F401  (isolates git config and identity)


class AlignTest(unittest.TestCase):
    def test_rows_line_up_with_fillers(self):
        old = "a\nb\nc\nd\n"
        new = "a\nB changed\nc\nnew line\nd\n"
        rows = compare.align(old, new)
        self.assertEqual([r.kind for r in rows], ["equal", "replace", "equal", "insert", "equal"])
        self.assertEqual(rows[3].left, None)  # filler on the left of an insertion
        self.assertEqual((rows[3].right[0], rows[3].right[1]), (4, "new line"))
        self.assertEqual((rows[4].left[0], rows[4].right[0]), (4, 5))  # line numbers stay true per side
        self.assertEqual(compare.change_starts(rows), [1, 3])

    def test_word_level_spans_on_replaced_lines(self):
        rows = compare.align("total = price * qty\n", "total = price * quantity + tax\n")
        (row,) = rows
        left, right = row.left, row.right
        self.assertEqual([left[1][s:e] for s, e in left[2]], ["qty"])
        self.assertEqual("".join(right[1][s:e] for s, e in right[2]), "quantity + tax")

    def test_uneven_replace_pads_shorter_side(self):
        rows = compare.align("x\n", "y1\ny2\ny3\n")
        self.assertEqual([r.kind for r in rows], ["replace"] * 3)
        self.assertEqual([r.left is None for r in rows], [False, True, True])


class VersionsTest(unittest.TestCase):
    def test_working_and_commit_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            git.run(repo, "init", "-q", "-b", "main")
            (repo / "a.py").write_text("print(1)\n")
            (repo / "bin.dat").write_bytes(b"\x00\x01binary")
            git.run(repo, "add", "-A")
            git.run(repo, "commit", "-qm", "one")
            (repo / "a.py").write_text("print(2)\n")
            (repo / "new.txt").write_text("hello\n")
            st = git.status(repo)
            ch = {c.path: c for c in st.changes}
            self.assertEqual(compare.working_versions(repo, st, ch["a.py"]), ("print(1)\n", "print(2)\n"))
            self.assertEqual(compare.working_versions(repo, st, ch["new.txt"]), ("", "hello\n"))

            git.run(repo, "commit", "-qam", "two")
            sha = git.log(repo, git.status(repo))[0].full_sha
            (f,) = git.commit_files(repo, sha)
            self.assertEqual(compare.commit_versions(repo, sha, f), ("print(1)\n", "print(2)\n"))
            root = git.log(repo, git.status(repo))[-1].full_sha
            binfile = [x for x in git.commit_files(repo, root) if x.path == "bin.dat"][0]
            with self.assertRaises(compare.Unreadable):
                compare.commit_versions(repo, root, binfile)


if __name__ == "__main__":
    unittest.main()
