#!/bin/sh

# Xcode Cloud: runs after the repo is cloned, before the build.
# Installs Node dependencies and copies the web app into the iOS project.

set -e

echo "==> Working directory: $CI_PRIMARY_REPOSITORY_PATH"
cd "$CI_PRIMARY_REPOSITORY_PATH"

# Install Node if it's not on PATH (Xcode Cloud images include Node, but be safe)
if ! command -v node &>/dev/null; then
  echo "==> Node not found; installing via Homebrew..."
  brew install node
fi

echo "==> Node $(node --version) / npm $(npm --version)"

echo "==> Installing npm dependencies..."
npm ci

echo "==> Copying web assets to iOS project..."
npx cap copy ios

echo "==> Done — web assets copied."
