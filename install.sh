#!/usr/bin/env bash
# Install RepoDeck for the current user: dependencies and a first build, the `repodeck` command,
# and an app-menu entry. Safe to run again.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin"
apps="$HOME/.local/share/applications"
mkdir -p "$bin" "$apps"

"$here/bin/repodeck" --prepare

cat > "$bin/repodeck" <<EOF
#!/bin/sh
exec "$here/bin/repodeck" "\$@"
EOF
chmod +x "$bin/repodeck"

cat > "$apps/dev.foundry.RepoDeck.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RepoDeck
Comment=Bird's-eye source control for several git repositories
Exec=$bin/repodeck %F
Icon=$here/data/repodeck.svg
Terminal=false
Categories=Development;RevisionControl;
StartupWMClass=dev.foundry.RepoDeck
EOF

command -v update-desktop-database >/dev/null && update-desktop-database "$apps" || true
echo "Installed: $bin/repodeck and $apps/dev.foundry.RepoDeck.desktop"
