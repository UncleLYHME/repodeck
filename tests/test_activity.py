import json
import tempfile
import unittest
from pathlib import Path

from repodeck import activity


class ActivityLogTest(unittest.TestCase):
    def test_persists_reloads_and_compacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "a.jsonl")
            log = activity.ActivityLog(path)
            log.add("pulled 2 commits", "/r/app", activity.AUTO)
            log.add("push failed: offline", "/r/app", activity.YOU, activity.ERROR)
            again = activity.ActivityLog(path)
            self.assertEqual([e.message for e in again.entries], ["pulled 2 commits", "push failed: offline"])
            self.assertEqual((again.entries[1].who, again.entries[1].level), ("you", "error"))

            with mock_keep(5):
                small = activity.ActivityLog(path)
                for i in range(12):
                    small.add(f"e{i}")
                lines = path.read_text().splitlines()
                self.assertLessEqual(len(lines), 10)  # rewritten to the newest entries once it doubled
                self.assertEqual(json.loads(lines[-1])["message"], "e11")
                self.assertEqual([e.message for e in activity.ActivityLog(path).entries][-1], "e11")

    def test_clear_and_bad_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "a.jsonl")
            path.write_text('{"ts": 1, "message": "ok"}\nnot json\n{"oops": 1}\n')
            log = activity.ActivityLog(path)
            self.assertEqual([e.message for e in log.entries], ["ok"])
            log.clear()
            self.assertEqual((list(log.entries), path.read_text()), ([], ""))


class mock_keep:
    def __init__(self, n):
        self.n = n

    def __enter__(self):
        self.old = activity.KEEP
        activity.KEEP = self.n

    def __exit__(self, *exc):
        activity.KEEP = self.old


if __name__ == "__main__":
    unittest.main()
