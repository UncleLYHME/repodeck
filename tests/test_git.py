import tempfile
import unittest
from pathlib import Path

from repodeck import git

git.ENV.update({
    "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "T", "GIT_COMMITTER_EMAIL": "t@x",
})


class RepoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git.run(self.repo, "init", "-q", "-b", "main")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text="x\n"):
        (self.repo / name).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / name).write_text(text)

    def committed_files(self, rev="HEAD"):
        return set(git.run(self.repo, "show", "--name-only", "--no-renames", "--format=", rev).splitlines()) - {""}

    def by_path(self):
        return {c.path: c for c in git.status(self.repo).changes}

    def test_initial_commit_of_selected_untracked_files(self):
        self.write("a.txt")
        self.write("dir/b [1].txt")
        self.write("c.txt")
        st = git.status(self.repo)
        self.assertFalse(st.has_commits)
        self.assertEqual({c.letter for c in st.changes}, {"U"})
        pick = [c for c in st.changes if c.path != "c.txt"]
        git.commit(self.repo, st, "first", pick)
        self.assertEqual(self.committed_files(), {"a.txt", "dir/b [1].txt"})
        self.assertEqual(set(self.by_path()), {"c.txt"})

    def test_commit_only_selected_and_keep_other_staged_work(self):
        for n in ("keep.txt", "edit.txt", "gone.txt", "old.txt"):
            self.write(n, f"{n} original content\n")
        st = git.status(self.repo)
        git.commit(self.repo, st, "base", st.changes)
        self.write("edit.txt", "changed\n")
        self.write("keep.txt", "staged but unselected\n")
        git.run(self.repo, "add", "keep.txt")
        (self.repo / "gone.txt").unlink()
        git.run(self.repo, "mv", "old.txt", "new.txt")
        changes = self.by_path()
        self.assertEqual(changes["edit.txt"].letter, "M")
        self.assertEqual(changes["gone.txt"].letter, "D")
        self.assertEqual((changes["new.txt"].letter, changes["new.txt"].orig), ("R", "old.txt"))
        self.assertTrue(changes["keep.txt"].staged)

        st = git.status(self.repo)
        pick = [changes[p] for p in ("edit.txt", "gone.txt", "new.txt")]
        git.commit(self.repo, st, "second", pick)
        self.assertEqual(self.committed_files(), {"edit.txt", "gone.txt", "new.txt", "old.txt"})
        left = self.by_path()
        self.assertEqual(set(left), {"keep.txt"})
        self.assertTrue(left["keep.txt"].staged)

    def test_log_graph_refs_and_branch_status(self):
        self.write("a")
        st = git.status(self.repo)
        git.commit(self.repo, st, "one", st.changes)
        git.run(self.repo, "checkout", "-q", "-b", "feature/x")
        self.write("b")
        st = git.status(self.repo)
        git.commit(self.repo, st, "two | with: odd chars", st.changes)
        git.run(self.repo, "tag", "v1")
        git.run(self.repo, "checkout", "-q", "main")
        self.write("c")
        st = git.status(self.repo)
        git.commit(self.repo, st, "three", st.changes)

        st = git.status(self.repo)
        self.assertEqual(st.branch, "main")
        rows = git.log(self.repo, st)
        self.assertEqual(len(rows), 3)
        by_subject = {r.subject: r for r in rows}
        self.assertEqual(by_subject["three"].refs, [("head", "main")])
        self.assertEqual(sorted(by_subject["two | with: odd chars"].refs), [("branch", "feature/x"), ("tag", "v1")])
        self.assertEqual(by_subject["three"].parents, [by_subject["one"].full_sha])
        self.assertEqual(by_subject["one"].parents, [])

    def test_background_fetch_sees_new_upstream_commits(self):
        self.assertFalse(git.background_fetch(self.repo))  # no remote: nothing to do
        self.write("a")
        st = git.status(self.repo)
        git.commit(self.repo, st, "one", st.changes)
        with tempfile.TemporaryDirectory() as tmp:
            clone = Path(tmp) / "clone"
            git.run(tmp, "clone", "-q", str(self.repo), str(clone))
            self.write("b")
            st = git.status(self.repo)
            git.commit(self.repo, st, "two", st.changes)
            self.assertEqual(git.status(clone).behind, 0)
            self.assertTrue(git.background_fetch(clone))
            self.assertEqual(git.status(clone).behind, 1)

            git.run(clone, "remote", "set-url", "origin", str(Path(tmp) / "missing"))
            with self.assertRaises(git.GitError):
                git.background_fetch(clone)

    def test_commit_files_with_letters_renames_and_merges(self):
        for n in ("keep.txt", "old.txt", "gone.txt"):
            self.write(n, f"{n} content\n")
        st = git.status(self.repo)
        git.commit(self.repo, st, "base", st.changes)
        root = git.log(self.repo, git.status(self.repo))[0].full_sha
        self.assertEqual({(f.path, f.letter) for f in git.commit_files(self.repo, root)},
                         {("keep.txt", "A"), ("old.txt", "A"), ("gone.txt", "A")})

        self.write("keep.txt", "changed\n")
        self.write("dir/new file.txt", "new\n")
        (self.repo / "gone.txt").unlink()
        git.run(self.repo, "mv", "old.txt", "renamed.txt")
        st = git.status(self.repo)
        git.commit(self.repo, st, "changes", st.changes)
        head = git.log(self.repo, git.status(self.repo))[0].full_sha
        files = {f.path: f for f in git.commit_files(self.repo, head)}
        self.assertEqual({p: f.letter for p, f in files.items()},
                         {"keep.txt": "M", "dir/new file.txt": "A", "gone.txt": "D", "renamed.txt": "R"})
        self.assertEqual(files["renamed.txt"].orig, "old.txt")
        self.assertIn("+changed", git.commit_file_diff(self.repo, head, files["keep.txt"]))
        self.assertIn("rename from old.txt", git.commit_file_diff(self.repo, head, files["renamed.txt"]))

        git.run(self.repo, "checkout", "-q", "-b", "side")
        self.write("side.txt", "side\n")
        st = git.status(self.repo)
        git.commit(self.repo, st, "side", st.changes)
        git.run(self.repo, "checkout", "-q", "main")
        git.run(self.repo, "merge", "-q", "--no-ff", "-m", "merge side", "side")
        merge = git.log(self.repo, git.status(self.repo))[0]
        self.assertEqual(len(merge.parents), 2)
        self.assertEqual([(f.path, f.letter) for f in git.commit_files(self.repo, merge.full_sha)], [("side.txt", "A")])

    def test_parse_refs_remotes(self):
        refs = git.parse_refs("HEAD -> main, origin/main, origin/HEAD, tag: v2, fix/y", {"origin"})
        self.assertEqual(refs, [("head", "main"), ("remote", "origin/main"), ("tag", "v2"), ("branch", "fix/y")])

    def test_find_repos_in_folder_of_projects(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            (parent / "one").mkdir()
            (parent / "plain").mkdir()
            git.run(parent / "one", "init", "-q")
            self.assertEqual(git.find_repos(parent), [str(parent / "one")])
        self.assertEqual(git.find_repos(self.repo), [str(self.repo)])


if __name__ == "__main__":
    unittest.main()
