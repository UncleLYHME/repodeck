import os
import tempfile
import time
import unittest
from datetime import date, datetime
from pathlib import Path

from repodeck import git, projectstats
from tests import test_git  # noqa: F401  (isolates git config and identity)


def commit_at(repo, message, when):
    stamp = f"@{int(when)} +0000"
    git.run(repo, "add", "-A")
    git.run(repo, "commit", "-qm", message, env={"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp})


class ProjectStatsTest(unittest.TestCase):
    def test_activity_streak_hot_files_languages_branches(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            git.run(repo, "init", "-q", "-b", "main")
            now = time.time()
            (repo / "app.py").write_text("print(1)\n" * 50)
            (repo / "style.css").write_text("a{}\n")
            commit_at(repo, "first", now - 40 * 86400)  # previous 30-day window
            for days_ago in (2, 1, 0):  # a three-day streak ending today
                (repo / "app.py").write_text(f"print({days_ago})\n" * 50)
                commit_at(repo, f"edit {days_ago}", now - days_ago * 86400)
            git.run(repo, "branch", "feature")

            s = projectstats.project(str(repo))
            self.assertEqual((s.commits_30, s.commits_prev_30, s.streak, s.total_commits), (3, 1, 3, 4))
            self.assertEqual(len(s.days), projectstats.BARS)
            self.assertEqual(s.days[-1], (date.today(), 1))
            self.assertEqual(s.hot_files[0][:2], ("app.py", 4))
            self.assertEqual([lang for lang, _ in s.languages], ["Python", "CSS"])
            self.assertEqual(sorted(b[0] for b in s.branches), ["feature", "main"])
            self.assertTrue(next(b for b in s.branches if b[0] == "main")[3])
            self.assertEqual(sum(s.punchcard.values()), 4)
            self.assertEqual(s.recent[0][1], "edit 0")
            self.assertEqual(s.authors, [("T", 4)])
            self.assertAlmostEqual(s.first_commit, int(now - 40 * 86400), delta=1)

    def test_empty_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            git.run(tmp, "init", "-q")
            s = projectstats.project(tmp)
            self.assertEqual((s.total_commits, len(s.days), s.languages), (0, projectstats.BARS, []))

    def test_languages_folds_into_other(self):
        with tempfile.TemporaryDirectory() as tmp:
            names = ["a.py", "b.js", "c.ts", "d.css", "e.html", "f.md", "g.go", "h.rs", "Dockerfile", "x.png"]
            for i, n in enumerate(names):
                Path(tmp, n).write_text("x" * (100 - i))
            langs = projectstats.languages({n: 100 - i for i, n in enumerate(names)})
            self.assertEqual(len(langs), 8)
            self.assertEqual(langs[-1][0], projectstats.OTHER)
            self.assertNotIn("x.png", [lang for lang, _ in langs])


class AuthorsTest(unittest.TestCase):
    def test_merges_spellings_addresses_and_github_logins(self):
        shortlog = (
            "   636\tOctoDev <OctoDev@users.noreply.github.com>\n"
            "    74\tOcto Dev <octo@example.com>\n"
            "    27\tOcto Dev <31078289+OctoDev@users.noreply.github.com>\n"
            "    18\tSam Rivera <sam@example.org>\n"
            "     7\tSam <31078289+OctoDev@users.noreply.github.com>\n"
            "     3\tAlex (Laptop) <alex@example.net>\n"
            "     1\tAlex <alex@example.dev>\n"
        )
        self.assertEqual(projectstats.merge_authors(shortlog),
                         [("OctoDev", 744), ("Sam Rivera", 18), ("Alex (Laptop)", 4)])


if __name__ == "__main__":
    unittest.main()
