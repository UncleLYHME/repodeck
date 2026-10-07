"""Entry point: `python3 -m repodeck [FOLDER...]` starts RepoDeck 2, the Electron app (bin/repodeck).

Kept so existing launchers, the app-menu entry, Start on Login and a running 1.x's "Restart Now"
all reach the new app. The previous GTK app still runs with REPODECK_LEGACY=1.
"""

import os
import sys
from pathlib import Path


def main():
    if os.environ.get("REPODECK_LEGACY") == "1":
        from .legacy import main as legacy
        return legacy()
    launcher = Path(__file__).resolve().parent.parent / "bin" / "repodeck"
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}  # set by the 1.x launcher; not needed now
    folders = [os.path.abspath(a) for a in sys.argv[1:]]
    os.execve("/bin/sh", ["sh", str(launcher), *folders], env)


if __name__ == "__main__":
    sys.exit(main())
