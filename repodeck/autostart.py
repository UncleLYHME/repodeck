"""Start on Login: an XDG autostart entry in ~/.config/autostart."""

import shutil
import sys
from pathlib import Path

from gi.repository import GLib

ENTRY = Path(GLib.get_user_config_dir()) / "autostart" / "dev.foundry.RepoDeck.desktop"
SOURCE = Path(__file__).resolve().parent.parent


def command():
    installed = shutil.which("repodeck") or str(Path.home() / ".local/bin/repodeck")
    if Path(installed).exists():
        return installed
    return f"env PYTHONPATH={SOURCE} {sys.executable} -m repodeck"


def enabled():
    return ENTRY.exists()


def set_enabled(on):
    if not on:
        ENTRY.unlink(missing_ok=True)
        return
    ENTRY.parent.mkdir(parents=True, exist_ok=True)
    ENTRY.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=RepoDeck\n"
        "Comment=Bird's-eye source control for several git repositories\n"
        f"Exec={command()}\n"
        f"Icon={SOURCE / 'data' / 'repodeck.svg'}\n"
        "Terminal=false\n"
        "X-GNOME-Autostart-enabled=true\n"
    )
