#!/bin/bash
# Install and run Product Listing Generator WITHOUT Xcode or Command Line Tools.
# Uses Miniforge (standalone Python from conda-forge).

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
MINIFORGE="$HOME/miniforge3"
PYTHON="$MINIFORGE/bin/python3"

echo "==> Product Listing Generator setup"
echo "    (No Xcode required)"
echo

# --- Find or install a real Python ---
if "$PYTHON" --version &>/dev/null; then
  echo "==> Found Miniforge Python at $PYTHON"
elif /Library/Frameworks/Python.framework/Versions/Current/bin/python3 --version &>/dev/null 2>&1; then
  PYTHON="/Library/Frameworks/Python.framework/Versions/Current/bin/python3"
  echo "==> Found python.org Python at $PYTHON"
else
  ARCH="$(uname -m)"
  if [ "$ARCH" = "arm64" ]; then
    INSTALLER="Miniforge3-MacOSX-arm64.sh"
  else
    INSTALLER="Miniforge3-MacOSX-x86_64.sh"
  fi
  URL="https://github.com/conda-forge/miniforge/releases/latest/download/$INSTALLER"

  echo "==> macOS system python3 requires developer tools — skipping it."
  echo "==> Downloading Miniforge (standalone Python, ~80 MB)..."
  TMP="$(mktemp -d)"
  curl -fsSL "$URL" -o "$TMP/$INSTALLER"
  bash "$TMP/$INSTALLER" -b -p "$MINIFORGE"
  rm -rf "$TMP"
  PYTHON="$MINIFORGE/bin/python3"
  echo "==> Installed Miniforge to $MINIFORGE"
fi

"$PYTHON" --version

# --- Virtual environment ---
cd "$PROJECT_DIR"
if [ ! -d ".venv" ]; then
  echo "==> Creating virtual environment..."
  "$PYTHON" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> Installing dependencies..."
pip install --upgrade pip -q
pip install -r requirements.txt -q

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "==> Created .env — add your OPENAI_API_KEY before generating listings."
fi

echo
echo "Done! To start the app:"
echo "  cd $PROJECT_DIR"
echo "  source .venv/bin/activate"
echo "  python run.py"
echo
echo "Then open http://127.0.0.1:8080 in your browser."
