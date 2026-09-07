#!/usr/bin/env bash
set -e

PROFILE="default_profile"
URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile|-p)
      PROFILE="$2"
      shift 2
      ;;
    --url|-u)
      URL="$2"
      shift 2
      ;;
    *)
      if [[ -z "$PROFILE" || "$PROFILE" == "default_profile" ]]; then
        PROFILE="$1"
      elif [[ -z "$URL" ]]; then
        URL="$1"
      fi
      shift
      ;;
  esac
done

# Resolve Brave binary
BRAVE_BIN="/home/omar/.local/bin/brave"
if [ ! -x "$BRAVE_BIN" ]; then
  BRAVE_BIN=$(command -v brave || command -v brave-browser || true)
fi

if [ -z "$BRAVE_BIN" ]; then
  echo "Error: Brave binary not found." >&2
  exit 1
fi

# Resolve profiles baseDir
CONFIG_FILE="$HOME/.pinchtab/config.json"
BASE_DIR="$HOME/.pinchtab/profiles"

if [ -f "$CONFIG_FILE" ]; then
  CONFIG_BASE=$(jq -r '.profiles.baseDir // empty' "$CONFIG_FILE" 2>/dev/null || true)
  if [ -n "$CONFIG_BASE" ] && [ "$CONFIG_BASE" != "null" ]; then
    BASE_DIR="$CONFIG_BASE"
  fi
fi

TARGET_DIR="$BASE_DIR/$PROFILE"
if [ ! -d "$TARGET_DIR" ]; then
  MATCHING=$(find "$BASE_DIR" -maxdepth 1 -type d -name "*$PROFILE*" 2>/dev/null | head -n 1)
  if [ -n "$MATCHING" ]; then
    TARGET_DIR="$MATCHING"
  else
    # Check if registered via pinchtab profile registry
    mkdir -p "$TARGET_DIR"
  fi
fi

# Stop active instances to release profile lock
pkill -f 'pinchtab.*instance|brave.*pinchtab' >/dev/null 2>&1 || true
sleep 1

echo "Opening standalone Brave session for profile '$PROFILE' ($TARGET_DIR)..."

if [ -n "$URL" ]; then
  nohup "$BRAVE_BIN" --user-data-dir="$TARGET_DIR" "$URL" >/dev/null 2>&1 &
else
  nohup "$BRAVE_BIN" --user-data-dir="$TARGET_DIR" >/dev/null 2>&1 &
fi

echo "Standalone Brave window opened."
echo "Complete sign-in/verification in Brave, then close the window before resuming PinchTab."
