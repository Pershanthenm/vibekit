#!/usr/bin/env bash
# New developer, from scratch (macOS, Linux, WSL2): installs git if needed, gets your team's
# Vibe-check-cli kit, and installs everything it needs.
#
#   bash onboard.sh <team repository URL>
#   or: curl -fsSL <raw URL of this file> | bash -s -- <team repository URL>
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eo pipefail

REPO_URL="${1:-${VIBECHECK_TEAM_REPO:-}}"
TARGET="${VIBECHECK_TARGET:-$HOME/tools/vibe-check-cli}"
if [ -z "$REPO_URL" ]; then
  echo "Usage: bash onboard.sh <team repository URL>   (ask your team lead for the URL)"
  exit 1
fi

step() { printf '\n== %s\n' "$1"; }

step 'Checking git'
if ! command -v git >/dev/null 2>&1; then
  case "$(uname)" in
    Darwin)
      xcode-select --install 2>/dev/null || true
      echo "A window is installing Apple's developer tools (they include git). When it finishes, run this command again."
      exit 1;;
    *)
      if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y git curl
      elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y git curl
      elif command -v pacman >/dev/null 2>&1; then sudo pacman -Sy --noconfirm git curl
      else echo "Install git with your package manager, then run this again."; exit 1; fi;;
  esac
fi
git --version

step "Getting your team's kit into $TARGET"
if [ -d "$TARGET/.git" ]; then
  git -C "$TARGET" pull --ff-only
else
  rm -rf "$TARGET"
  mkdir -p "$(dirname "$TARGET")"
  git clone "$REPO_URL" "$TARGET"
fi

step 'Installing Node.js (if needed), Claude Code, the plugin, and the Cursor kit'
bash "$TARGET/plugin/scripts/bootstrap.sh" --minimal --yes

step 'Done'
echo 'Next, in Cursor:'
echo '  1. Open the Claude Code panel (Spark icon) and sign in if asked.'
echo '  2. Type /reload-plugins, then /vibe-check-cli:setup, then /vibe-check-cli:health live'
