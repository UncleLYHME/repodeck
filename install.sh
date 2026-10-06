#!/usr/bin/env bash
# Install RepoDeck for the current user: `repodeck` command + app-menu entry.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin"
apps="$HOME/.local/share/applications"
mkdir -p "$bin" "$apps"

cat > "$bin/repodeck" <<EOF
#!/usr/bin/env bash
PYTHONPATH="$here\${PYTHONPATH:+:\$PYTHONPATH}" exec python3 -m repodeck "\$@"
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
