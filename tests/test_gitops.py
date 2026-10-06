import shutil
import tempfile
import unittest
from pathlib import Path

from repodeck import git, gitops
from tests import test_git  # noqa: F401  (isolates git config and identity)


class OpsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name, "r")
        self.binned = Path(self.tmp.name, "trash")
        self.binned.mkdir()
        git.run(self.tmp.name, "init", "-q", "-b", "main", str(self.repo))
        self.write("a.txt", "\n".join(f"line {i}" for i in range(1, 31)) + "\n")
        self.write("b.txt", "b\n")
        self.commit_all("base")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / name).write_text(text)

    def commit_all(self, message):
        st = git.status(self.repo)
        git.commit(self.repo, st, message, st.changes)

    def fake_trash(self, path):
        shutil.move(path, self.binned / Path(path).name)

    def changes(self):
        return {c.path: c for c in git.status(self.repo).changes}

    def test_discard_restores_tracked_and_bins_new_files(self):
        self.write("a.txt", "changed\n")
        (self.repo / "b.txt").unlink()
        self.write("new.txt", "new\n")
        self.write("staged-new.txt", "staged\n")
        git.run(self.repo, "add", "staged-new.txt")
        st = git.status(self.repo)
        gitops.discard(self.repo, st, st.changes, trash=self.fake_trash)
        self.assertEqual(self.changes(), {})
        self.assertTrue((self.repo / "a.txt").read_text().startswith("line 1"))
        self.assertTrue((self.repo / "b.txt").exists())
        self.assertEqual(sorted(p.name for p in self.binned.iterdir()), ["new.txt", "staged-new.txt"])

    def test_discard_rename(self):
        git.run(self.repo, "mv", "b.txt", "moved.txt")
        st = git.status(self.repo)
        gitops.discard(self.repo, st, st.changes, trash=self.fake_trash)
        self.assertEqual(self.changes(), {})
        self.assertTrue((self.repo / "b.txt").exists())

    def test_stage_one_hunk_and_commit_only_that(self):
        lines = (self.repo / "a.txt").read_text().splitlines()
        lines[1], lines[27] = "TOP EDIT", "BOTTOM EDIT"
        self.write("a.txt", "\n".join(lines) + "\n")
        unstaged = gitops.hunks(self.repo, "a.txt", staged=False)
        self.assertEqual(len(unstaged), 2)
        gitops.stage_hunk(self.repo, unstaged[0])
        change = self.changes()["a.txt"]
        self.assertTrue(change.partial)

        git.commit(self.repo, git.status(self.repo), "top only", [change])
        committed = git.run(self.repo, "show", "HEAD:a.txt")
        self.assertIn("TOP EDIT", committed)
        self.assertNotIn("BOTTOM EDIT", committed)
        left = self.changes()["a.txt"]
        self.assertEqual((left.x, left.y), (".", "M"))  # the bottom edit is still waiting
        self.assertIn("BOTTOM EDIT", (self.repo / "a.txt").read_text())

    def test_unstage_and_discard_hunk(self):
        self.write("a.txt", (self.repo / "a.txt").read_text().replace("line 2\n", "two\n"))
        gitops.stage_hunk(self.repo, gitops.hunks(self.repo, "a.txt", staged=False)[0])
        gitops.unstage_hunk(self.repo, gitops.hunks(self.repo, "a.txt", staged=True)[0])
        self.assertFalse(self.changes()["a.txt"].staged)
        gitops.discard_hunk(self.repo, gitops.hunks(self.repo, "a.txt", staged=False)[0])
        self.assertEqual(self.changes(), {})

    def test_branches_switch_create_and_remote_tracking(self):
        gitops.create_branch(self.repo, "feature/x")
        self.assertEqual(git.status(self.repo).branch, "feature/x")
        with self.assertRaises(git.GitError):
            gitops.create_branch(self.repo, "bad..name")
        gitops.switch(self.repo, "main")
        clone = Path(self.tmp.name, "clone")
        git.run(self.tmp.name, "clone", "-q", str(self.repo), str(clone))
        b = gitops.branches(clone)
        self.assertEqual((b.current, [n for n, _ in b.local]), ("main", ["main"]))
        self.assertEqual(b.remote, ["origin/feature/x"])
        gitops.switch_remote(clone, "origin/feature/x")
        st = git.status(clone)
        self.assertEqual((st.branch, st.upstream), ("feature/x", "origin/feature/x"))

    def test_stash_roundtrip_and_abort(self):
        self.write("a.txt", "wip\n")
        self.write("untracked.txt", "u\n")
        gitops.stash(self.repo)
        self.assertEqual(self.changes(), {})
        self.assertEqual(len(gitops.stashes(self.repo)), 1)
        gitops.stash_pop(self.repo)
        self.assertEqual(set(self.changes()), {"a.txt", "untracked.txt"})

        self.commit_all("wip")
        gitops.create_branch(self.repo, "side")
        self.write("a.txt", "side\n")
        self.commit_all("side")
        gitops.switch(self.repo, "main")
        self.write("a.txt", "main\n")
        self.commit_all("main")
        git.run(self.repo, "merge", "side", check=False)
        self.assertEqual(git.status(self.repo).operation, "merge")
        gitops.abort(self.repo, "merge")
        self.assertIsNone(git.status(self.repo).operation)

    def test_identity(self):
        gitops.set_identity(self.repo, "Repo Person", "repo@example.com")
        self.assertEqual(gitops.identity(self.repo), ("Repo Person", "repo@example.com"))
        with self.assertRaises(git.GitError):
            gitops.set_identity(self.repo, "x", "not-an-email")


if __name__ == "__main__":
    unittest.main()
