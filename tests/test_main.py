import os
import unittest
from unittest import mock

from repodeck import __main__ as entry


class ShimTest(unittest.TestCase):
    def test_hands_over_to_the_electron_launcher(self):
        with mock.patch.object(entry.os, "execve") as execve, \
                mock.patch.object(entry.sys, "argv", ["repodeck", "relative/dir"]), \
                mock.patch.dict(entry.os.environ, {"PYTHONPATH": "/somewhere"}, clear=False):
            os.environ.pop("REPODECK_LEGACY", None)
            entry.main()
        path, argv, env = execve.call_args[0]
        self.assertEqual(path, "/bin/sh")
        self.assertTrue(argv[1].endswith("bin/repodeck"))
        self.assertEqual(argv[2], os.path.abspath("relative/dir"))
        self.assertNotIn("PYTHONPATH", env)


if __name__ == "__main__":
    unittest.main()
