import tempfile

from repodeck import cache

# Tests get their own throwaway cache instead of ~/.cache/repodeck.
_dir = tempfile.TemporaryDirectory(prefix="repodeck-test-cache-")
cache._shared = cache.Cache(f"{_dir.name}/cache.json")
