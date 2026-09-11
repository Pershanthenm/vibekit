#!/usr/bin/env bash
# Fresh machine (macOS, Linux, WSL2): installs Node.js 20+ if needed, installs vibecheck, then runs the guided setup.
# --minimal installs only what's needed to continue from the Claude Code panel (/vibe-check-cli:setup).
# Works whether it's started with `bash` or `sh`: nvm needs bash, so the script switches to it.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -eo pipefail

DIR=$(cd "$(dirname "$0")/.." && pwd)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

has_node() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]
}

load_nvm() {
  # nvm.sh reads variables that may be unset, so it can't run under `set -u`.
  set +u
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
}

install_node_with_nvm() {
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  load_nvm
  nvm install 22
  nvm alias default 22 >/dev/null
}

if ! has_node && [ -s "$NVM_DIR/nvm.sh" ]; then
  load_nvm
fi

if ! has_node; then
  if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install node
  else
    install_node_with_nvm
  fi
fi

if ! has_node; then
  echo "Node.js 20 or newer is still not available. Open a new terminal and run this script again." >&2
  exit 1
fi

npm install -g "$DIR"

if [ "${1:-}" = "--minimal" ]; then
  shift
  vibecheck setup --only claude,team-marketplaces,vibecheck-plugin,vibecheck-cli,cursor-agents "$@"
  echo
  echo "Next: load the plugin into Claude Code, then run /vibe-check-cli:setup"
  echo "  In a Claude Code session: type /reload-plugins (no restart needed)."
  echo "  In Cursor's Claude panel, if that isn't available: Command Palette → Developer: Reload Window."
  echo "Open a new terminal tab too, so the vibecheck command is found there."
  exit 0
fi
exec vibecheck setup "$@"
