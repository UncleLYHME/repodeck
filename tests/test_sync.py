import tempfile
import unittest
from pathlib import Path

from repodeck import git
from tests import test_git  # noqa: F401  (isolates git config and identity)


class SyncTest(unittest.TestCase):
    """A bare 'origin' with two clones: `mine` (the deck's repo) and `theirs` (someone else pushing)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.origin, self.mine, self.theirs = root / "origin.git", root / "mine", root / "theirs"
        git.run(root, "init", "-q", "--bare", "-b", "main", str(self.origin))
        git.run(root, "clone", "-q", str(self.origin), str(self.mine))
        self.commit(self.mine, "shared.txt", "line 1\n", "base")
        git.run(self.mine, "push", "-q", "-u", "origin", "main")
        git.run(root, "clone", "-q", str(self.origin), str(self.theirs))

    def tearDown(self):
        self.tmp.cleanup()

    def commit(self, repo, name, text, message):
        (repo / name).write_text(text)
        st = git.status(repo)
        git.commit(repo, st, message, [c for c in st.changes if c.path == name])

    def their_push(self, name, text, message):
        self.commit(self.theirs, name, text, message)
        git.run(self.theirs, "push", "-q")
        git.run(self.mine, "fetch", "-q")

    def subjects(self, repo, rev="HEAD"):
        return git.run(repo, "log", "--format=%s", rev).split("\n")[:-1]

    def test_fast_forward_keeps_unrelated_local_edits(self):
        self.their_push("theirs.txt", "x\n", "their change")
        (self.mine / "shared.txt").write_text("my edit in progress\n")
        st = git.status(self.mine)
        self.assertTrue(st.can_fast_forward)
        git.fast_forward(self.mine)
        st = git.status(self.mine)
        self.assertEqual((st.behind, self.subjects(self.mine)[0]), (0, "their change"))
        self.assertEqual((self.mine / "shared.txt").read_text(), "my edit in progress\n")

    def test_fast_forward_refuses_when_local_edits_would_be_overwritten(self):
        self.their_push("shared.txt", "their version\n", "their change")
        (self.mine / "shared.txt").write_text("my edit in progress\n")
        with self.assertRaises(git.GitError):
            git.fast_forward(self.mine)
        self.assertEqual(git.status(self.mine).behind, 1)
        self.assertEqual((self.mine / "shared.txt").read_text(), "my edit in progress\n")

    def test_push_when_diverged_rebases_then_pushes(self):
        self.their_push("theirs.txt", "x\n", "their change")
        self.commit(self.mine, "mine.txt", "y\n", "my change")
        (self.mine / "wip.txt").write_text("uncommitted\n")  # survives via --autostash
        git.push(self.mine, git.status(self.mine))
        self.assertEqual(self.subjects(self.origin, "main"), ["my change", "their change", "base"])
        st = git.status(self.mine)
        self.assertEqual((st.ahead, st.behind, st.operation), (0, 0, None))
        self.assertEqual((self.mine / "wip.txt").read_text(), "uncommitted\n")

    def test_conflicting_push_aborts_cleanly(self):
        self.their_push("shared.txt", "their line\n", "their change")
        self.commit(self.mine, "shared.txt", "my line\n", "my change")
        with self.assertRaises(git.GitError):
            git.push(self.mine, git.status(self.mine))
        st = git.status(self.mine)
        self.assertEqual((st.ahead, st.behind, st.operation), (1, 1, None))
        self.assertEqual(self.subjects(self.mine)[0], "my change")
        self.assertEqual(self.subjects(self.origin, "main")[0], "their change")

    def test_only_the_checked_out_branch_is_pulled(self):
        git.run(self.theirs, "push", "-q", "origin", "main:feature")
        git.run(self.mine, "fetch", "-q")
        git.run(self.mine, "branch", "-q", "--track", "feature", "origin/feature")
        git.run(self.theirs, "fetch", "-q")
        git.run(self.theirs, "checkout", "-q", "-b", "feature", "origin/feature")
        self.their_push("f.txt", "f\n", "feature update")
        git.run(self.theirs, "checkout", "-q", "main")
        self.their_push("m.txt", "m\n", "main update")

        feature_before = git.run(self.mine, "rev-parse", "feature")
        st = git.status(self.mine)
        self.assertTrue(st.can_fast_forward)
        git.fast_forward(self.mine)
        self.assertEqual(self.subjects(self.mine)[0], "main update")
        self.assertEqual(git.run(self.mine, "rev-parse", "feature"), feature_before)  # untouched

        git.run(self.mine, "checkout", "-q", "feature")  # now it's the current branch, so it gets pulled
        self.assertTrue(git.status(self.mine).can_fast_forward)
        git.fast_forward(self.mine)
        self.assertEqual(self.subjects(self.mine)[0], "feature update")

    def test_operation_in_progress_is_detected(self):
        git.run(self.mine, "checkout", "-q", "-b", "side")
        self.commit(self.mine, "shared.txt", "side\n", "side")
        git.run(self.mine, "checkout", "-q", "main")
        self.commit(self.mine, "shared.txt", "main\n", "main")
        git.run(self.mine, "merge", "side", check=False)
        st = git.status(self.mine)
        self.assertEqual(st.operation, "merge")
        self.assertFalse(st.can_fast_forward)


if __name__ == "__main__":
    unittest.main()
