#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/hjewkes/brain.git"
INSTALL_DIR="${BRAIN_INSTALL_DIR:-$HOME/.local/share/brain-cli}"
BIN_DIR="${HOME}/.local/bin"
SKILL_NAME="second-brain"

info() { echo "[brain] $*"; }
error() { echo "[brain] ERROR: $*" >&2; exit 1; }

# Clone or update the repo
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning brain to $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# Build
info "Installing dependencies and building..."
cd "$INSTALL_DIR"
npm ci
npm run build

# Symlink binary
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/brain"
chmod +x "$BIN_DIR/brain"
info "Linked brain to $BIN_DIR/brain"

# Ensure bin dir is on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "^$BIN_DIR$"; then
  info "WARNING: $BIN_DIR is not on your PATH"
  info "Add this to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
fi

# Initialize brain if not already done
if ! brain status --json >/dev/null 2>&1; then
  info "Running brain init..."
  brain init
fi

# Install skill
SKILL_SOURCE="$INSTALL_DIR/skills/$SKILL_NAME"
if command -v chezmoi >/dev/null 2>&1; then
  CHEZMOI_SOURCE="$(chezmoi source-path)"
  SKILL_DEST="$CHEZMOI_SOURCE/dot_claude/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DEST"
  cp "$SKILL_SOURCE/SKILL.md" "$SKILL_DEST/SKILL.md"
  chezmoi apply
  info "Installed skill via chezmoi"
else
  SKILL_DEST="$HOME/.claude/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DEST"
  ln -sf "$SKILL_SOURCE/SKILL.md" "$SKILL_DEST/SKILL.md"
  info "Linked skill to $SKILL_DEST"
fi

info "Installation complete!"
info "Run 'brain --help' to get started."
