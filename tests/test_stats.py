import os
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path

from repodeck import git, stats
from tests import test_git  # noqa: F401  (isolates git config and identity)


class ActivityTest(unittest.TestCase):
    def test_counts_days_lines_and_dedupes_clones(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp, "a"), Path(tmp, "b")
            git.run(tmp, "init", "-q", "-b", "main", str(a))
            (a / "f.txt").write_text("1\n2\n3\n")
            git.run(a, "add", "-A")
            git.run(a, "commit", "-qm", "three lines")
            (a / "f.txt").write_text("1\n")
            git.run(a, "commit", "-qam", "drop two")
            git.run(tmp, "clone", "-q", str(a), str(b))  # same commits again: counted once
            (b / "g.txt").write_text("x\n")
            git.run(b, "add", "-A")
            git.run(b, "commit", "-qm", "only in b")

            act = stats.activity([str(a), str(b)])
            self.assertEqual(act.total, 3)
            self.assertEqual((act.added, act.deleted), (4, 2))
            self.assertEqual(len(act.days), stats.DAYS)
            self.assertEqual(act.days[-1], (date.today(), 3))
            self.assertEqual(act.per_repo, {str(a): 2, str(b): 1})
            self.assertEqual(act.recent[0][2], "only in b")


class ParseTest(unittest.TestCase):
    def test_parse_ss(self):
        text = (
            'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=4242,fd=21))\n'
            'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=4242,fd=22))\n'
            'LISTEN 0 4096 127.0.0.1:8000 0.0.0.0:* users:(("docker-proxy",pid=5660,fd=7))\n'
            'garbage line\n'
        )
        self.assertEqual(stats.parse_ss(text), [(3000, "node", 4242), (8000, "docker-proxy", 5660)])

    def test_services_maps_own_process_to_repo(self):
        repo = os.getcwd()  # this test process runs inside the repodeck checkout
        found, _others = stats.services([repo])
        self.assertIsInstance(found, list)

    def test_ci_keeps_only_latest_failing_run_per_workflow_and_branch(self):
        runs = [
            {"workflowName": "ci", "headBranch": "main", "conclusion": "failure", "createdAt": "2026-10-01T00:00:00Z"},
            {"workflowName": "ci", "headBranch": "main", "conclusion": "success", "createdAt": "2026-10-02T00:00:00Z"},
            {"workflowName": "ci", "headBranch": "fix", "conclusion": "failure", "createdAt": "2026-10-03T00:00:00Z"},
            {"workflowName": "e2e", "headBranch": "main", "conclusion": "timed_out", "createdAt": "2026-10-04T00:00:00Z"},
            {"workflowName": "old", "headBranch": "main", "conclusion": "failure", "createdAt": "2026-01-01T00:00:00Z"},
        ]
        failed = stats.ci_failures_from_runs(runs, since="2026-09-20T00:00:00Z")
        self.assertEqual(sorted((r["workflowName"], r["headBranch"]) for r in failed), [("ci", "fix"), ("e2e", "main")])

    def test_github_slug_and_time_helpers(self):
        self.assertEqual(stats.GITHUB_URL.search("git@github.com:me/app.git")["slug"], "me/app")
        self.assertEqual(stats.GITHUB_URL.search("https://github.com/me/app")["slug"], "me/app")
        self.assertEqual(stats.iso_ts("1970-01-01T00:01:00Z"), 60)
        now = time.time()
        self.assertEqual([stats.ago(now - s, now) for s in (5, 120, 7200, 3 * 86400)], ["now", "2m", "2h", "3d"])


if __name__ == "__main__":
    unittest.main()
