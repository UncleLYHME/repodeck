import tempfile

from repodeck import cache

# Tests get their own throwaway cache instead of ~/.cache/repodeck.
_dir = tempfile.TemporaryDirectory(prefix="repodeck-test-cache-")
cache._shared = cache.Cache(f"{_dir.name}/cache.json")

from repodeck import activity  # noqa: E402

activity._shared = activity.ActivityLog(f"{_dir.name}/activity.jsonl")
