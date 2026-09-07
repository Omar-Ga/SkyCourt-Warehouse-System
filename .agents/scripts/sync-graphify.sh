#!/bin/sh
# Antigravity PostToolUse hook: sync graphify AST on file edits
cat > /dev/null 2>&1 || true
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -d "$ROOT_DIR/graphify-out" ]; then
  (cd "$ROOT_DIR" && graphify update > /dev/null 2>&1 || true)
fi
printf '{}'
