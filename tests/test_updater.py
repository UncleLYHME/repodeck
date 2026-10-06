import tempfile
import unittest
from pathlib import Path
from unittest import mock

from repodeck import git, updater
from tests import test_git  # noqa: F401  (isolates git config and identity)

CHANGELOG = """# Changelog

## 1.2.0 — 2026-10-08

- Newest thing
- Another

## 1.1.0 — 2026-10-07

* Middle thing

## 1.0.0 — 2026-10-06

- Old thing
"""


class VersionTest(unittest.TestCase):
    def test_parse_compare_and_notes(self):
        self.assertEqual(updater.parse_version('__version__ = "1.10.2"\n'), "1.10.2")
        self.assertIsNone(updater.parse_version("nothing here"))
        self.assertTrue(updater.newer("1.10.0", "1.9.9"))
        self.assertFalse(updater.newer("1.0.0", "1.0.0"))
        self.assertFalse(updater.newer(None, "1.0.0"))
        self.assertEqual(updater.notes_since(CHANGELOG, "1.0.0"), ["Newest thing", "Another", "Middle thing"])
        self.assertEqual(updater.notes_since(CHANGELOG, "1.2.0"), [])


class CheckoutTest(unittest.TestCase):
    """origin (bare) -> app (the running checkout) and dev (where a release is made)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.origin, self.app, self.dev = root / "origin.git", root / "app", root / "dev"
        git.run(root, "init", "-q", "--bare", "-b", "main", str(self.origin))
        git.run(root, "clone", "-q", str(self.origin), str(self.dev))
        self.release(self.dev, "1.0.0", "First")
        git.run(root, "clone", "-q", str(self.origin), str(self.app))
        patcher = mock.patch.object(updater, "APP_DIR", self.app)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def release(self, repo, version, note):
        (repo / "repodeck").mkdir(exist_ok=True)
        (repo / "repodeck" / "__init__.py").write_text(f'__version__ = "{version}"\n')
        log = repo / "CHANGELOG.md"
        old = log.read_text() if log.exists() else "# Changelog\n"
        log.write_text(old.replace("# Changelog\n", f"# Changelog\n\n## {version} — 2026-10-06\n\n- {note}\n", 1))
        git.run(repo, "add", "-A")
        git.run(repo, "commit", "-qm", f"release {version}")
        git.run(repo, "push", "-q", "origin", "HEAD")

    def test_nothing_new(self):
        self.assertIsNone(updater.check("1.0.0"))

    def test_remote_release_found_applied_and_reported(self):
        self.release(self.dev, "1.1.0", "Shiny popup")
        update = updater.check("1.0.0")
        self.assertEqual((update.version, update.source, update.notes), ("1.1.0", "remote", ["Shiny popup"]))
        with mock.patch.object(updater, "__version__", "1.0.0"):
            updater.apply(update)
        self.assertIn('"1.1.0"', (self.app / "repodeck" / "__init__.py").read_text())

    def test_already_on_disk_needs_only_a_restart(self):
        self.release(self.dev, "1.1.0", "Pulled elsewhere")
        git.run(self.app, "pull", "-q")
        update = updater.check("1.0.0", fetch=False)
        self.assertEqual((update.version, update.source), ("1.1.0", "disk"))

    def test_conflicting_local_edit_refuses_and_changes_nothing(self):
        self.release(self.dev, "1.1.0", "Conflicts")
        (self.app / "repodeck" / "__init__.py").write_text('__version__ = "1.0.0"  # local tweak\n')
        update = updater.check("1.0.0")
        with self.assertRaises(git.GitError) as caught:
            updater.apply(update)
        self.assertIn("Nothing was changed", str(caught.exception))
        self.assertIn("local tweak", (self.app / "repodeck" / "__init__.py").read_text())


class RelaunchTest(unittest.TestCase):
    def test_helper_waits_for_this_process_then_starts_from_the_checkout(self):
        with mock.patch.object(updater.subprocess, "Popen") as popen:
            updater.spawn_relaunch()
        args, kwargs = popen.call_args
        cmd = args[0]
        self.assertEqual(cmd[:2], ["sh", "-c"])
        self.assertIn('kill -0 "$0"', cmd[2])
        self.assertEqual(cmd[3], str(updater.os.getpid()))
        self.assertEqual(cmd[-2:], ["-m", "repodeck"])
        self.assertTrue(kwargs["env"]["PYTHONPATH"].startswith(str(updater.APP_DIR)))
        self.assertTrue(kwargs["start_new_session"])


if __name__ == "__main__":
    unittest.main()
