import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from repodeck import cache, git, projectstats, stats
from tests import test_git  # noqa: F401  (isolates git config and identity)


class CacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name, "cache.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_versioned_and_timed_entries(self):
        c = cache.Cache(self.path)
        c.put("a", {"x": 1}, version="v1")
        self.assertEqual(c.get("a", version="v1"), ({"x": 1}, True))
        self.assertEqual(c.get("a", version="v2"), (None, False))
        c.put("b", [1, 2])
        self.assertEqual(c.get("b", ttl=60), ([1, 2], True))
        c.entries["b"]["t"] -= 120
        self.assertEqual(c.get("b", ttl=60), ([1, 2], False))  # stale but still returned
        self.assertEqual(c.get("missing"), (None, False))

    def test_persists_and_prunes(self):
        c = cache.Cache(self.path)
        c.put("keep", "yes", version="v")
        c.put("old", "no")
        c.entries["old"]["used"] = time.time() - (cache.PRUNE_DAYS + 1) * 86400
        c.save()
        self.assertFalse(self.path.with_suffix(".tmp").exists())
        again = cache.Cache(self.path)
        self.assertEqual(again.get("keep", version="v"), ("yes", True))
        self.assertEqual(again.get("old"), (None, False))

    def test_ignores_other_formats_and_corrupt_files(self):
        self.path.write_text(json.dumps({"format": cache.FORMAT + 1, "entries": {"a": {}}}))
        self.assertEqual(cache.Cache(self.path).entries, {})
        self.path.write_text("{not json")
        self.assertEqual(cache.Cache(self.path).entries, {})


class GitCachingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git.run(self.repo, "init", "-q", "-b", "main")
        self.commit("a.txt", "one\n", "first")

    def tearDown(self):
        self.tmp.cleanup()

    def commit(self, name, text, message):
        (self.repo / name).write_text(text)
        git.run(self.repo, "add", "-A")
        git.run(self.repo, "commit", "-qm", message)

    def git_logs(self, fn):
        """How many `git log` processes `fn` starts."""
        real, calls = git.run, []

        def counting(repo, *args, **kw):
            if args and args[0] == "log":
                calls.append(args)
            return real(repo, *args, **kw)

        with mock.patch.object(git, "run", counting):
            result = fn()
        return result, len(calls)

    def test_fingerprint_follows_history_not_edits(self):
        fp = git.fingerprint(self.repo)
        (self.repo / "a.txt").write_text("edited, not committed\n")
        self.assertEqual(git.fingerprint(self.repo), fp)
        git.run(self.repo, "branch", "side")
        self.assertNotEqual(git.fingerprint(self.repo), fp)
        fp = git.fingerprint(self.repo)
        git.run(self.repo, "stash", "-q")
        self.assertNotEqual(git.fingerprint(self.repo), fp)
        fp = git.fingerprint(self.repo)
        git.run(self.repo, "update-ref", "refs/t3/checkpoint", "HEAD")  # tool-private refs don't count
        self.assertEqual(git.fingerprint(self.repo), fp)

    def test_activity_reuses_its_scan_until_a_commit(self):
        repos = [str(self.repo)]
        first, logs = self.git_logs(lambda: stats.activity(repos))
        self.assertEqual((first.total, logs), (1, 1))
        second, logs = self.git_logs(lambda: stats.activity(repos))
        self.assertEqual((second.total, logs), (1, 0))
        self.commit("b.txt", "two\n", "second")
        third, logs = self.git_logs(lambda: stats.activity(repos))
        self.assertEqual((third.total, logs), (2, 1))

    def test_project_stats_cached_and_round_trip(self):
        first, logs = self.git_logs(lambda: projectstats.project(str(self.repo)))
        self.assertGreater(logs, 0)
        second, logs = self.git_logs(lambda: projectstats.project(str(self.repo)))
        self.assertEqual(logs, 0)
        self.assertEqual(second, first)
        self.assertEqual(projectstats.from_data(json.loads(json.dumps(projectstats.to_data(first)))), first)
        self.assertEqual(first.languages, [])  # .txt isn't a language


class GithubCachingTest(unittest.TestCase):
    def test_reuses_refetches_on_force_and_falls_back_when_offline(self):
        repos = ["/nowhere/github-cache-test"]
        calls = []

        def prs():
            calls.append(1)
            return {"review": [], "mine": [{"title": f"call {len(calls)}"}]}

        with mock.patch.object(stats, "pull_requests", prs), mock.patch.object(stats, "ci_failures", lambda r: []):
            a = stats.github(repos)
            b = stats.github(repos)
            self.assertEqual((len(calls), a, stats.freshness(b)), (1, b, "Updated just now"))
            stats.github(repos, force=True)
            self.assertEqual(len(calls), 2)

        def offline():
            raise RuntimeError("could not connect")

        with mock.patch.object(stats, "pull_requests", offline):
            c = stats.github(repos, force=True)
        self.assertEqual(c["prs"]["mine"][0]["title"], "call 2")
        self.assertEqual(c["stale"], "could not connect")
        self.assertIn("unreachable", stats.freshness(c))


if __name__ == "__main__":
    unittest.main()
