---
name: pinchtab-account-setup-linux
disable-model-invocation: true
description: >
  STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. How to configure PinchTab on Linux to persist user accounts and logins (e.g. Google accounts)
  using dedicated, isolated browser User Data directories. Covers the correct architecture
  (Brave + named profiles registered via HTTP API), profile directory structure (~/.pinchtab/profiles/),
  clean 1-tab startup, and the manual sign-in / CAPTCHA bypass workflow on Linux.
---

# PinchTab Account Setup & Profile Persistence (Linux)

## Browser: Brave

PinchTab runs on **Brave**, configured via `browser.binary` in `~/.pinchtab/config.json`:

```json
"browser": {
  "binary": "/home/omar/.local/bin/brave"
}
```

Why Brave over Chrome on Linux:
- Built-in flags prevent intrusive crash-restore and profile-picker popups.
- Better stealth defaults out of the box (`--disable-automation`, `--disable-blink-features=AutomationControlled`).
- Full Chromium credential and cookie persistence in isolated `--user-data-dir`.
- Native Wayland client under Omarchy / Hyprland (`--ozone-platform=wayland`).

## Core Concept

Each PinchTab instance launches with:

```bash
--user-data-dir="~/.pinchtab/profiles/<profileDir>"
```

Chromium's cookie encryption and storage tie credentials to the **exact path string** of the profile directory.
- The only reliable way to have a persistent account is to **sign into it once inside PinchTab's isolated directory**, letting the browser save session cookies and tokens there.
- The directory must be **stable across launches** — see the named profile section below.

## Named Profiles vs Ephemeral Directories

**The issue:** If no profile name is specified at launch, `pinchtab instance start` creates a throwaway `instance-<timestamp>` directory every time. Logins do not persist.

**The solution:** Register a **named profile** via the PinchTab HTTP API:

```bash
token=$(grep '"token":' ~/.pinchtab/config.json | head -n1 | awk -F'"' '{print $4}')
curl -s -X POST http://127.0.0.1:9867/profiles \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  -d '{"name":"profile_1"}'
```

Response:
```json
{"id":"prof_sample1","name":"profile_1","status":"created"}
```

This creates a stable directory at `~/.pinchtab/profiles/prof_<id>` and registers it in PinchTab. From then on, always launch with:

```bash
pinchtab instance start --mode headed --profile profile_1
```

Verified behavior: stopping and restarting with `--profile profile_1` reuses the exact same directory.

## Architecture: One Named Profile Per Account

```text
~/.pinchtab/profiles/
  ├── default/              ← default instance profile
  ├── prof_sample1/         ← named profile "profile_1" (e.g. Primary Account)
  ├── prof_sample2/         ← named profile "profile_2" (e.g. Secondary Account)
  └── prof_sample3/         ← named profile "profile_3" (e.g. Workflow Account)
```

### Example Profile Registry Table

| Profile Name | Profile ID | Account Role | Typical Port |
| :--- | :--- | :--- | :--- |
| `profile_1` *(default)* | `prof_sample1` | Primary Account | `9868` |
| `profile_2` | `prof_sample2` | Secondary / Backup | `9870` |
| `profile_3` | `prof_sample3` | Workflow / Testing | `9872` |

## Manual Sign-In / CAPTCHA Bypass Protocol (Linux)

When signing into Google, Cloudflare-protected services, or 2FA where automation is blocked:

1. Stop active instances:
   ```bash
   pkill -f 'pinchtab.*instance|brave.*pinchtab' || true
   sleep 1
   ```
2. Launch standalone clean Brave (no remote debugging or CDP flags):
   ```bash
   bash .agents/skills/pinchtab-account-setup-linux/scripts/launch-manual-auth.sh --profile profile_1 --url "https://accounts.google.com"
   ```
3. The user signs in normally, saves credentials, and closes the browser window.
4. Resume PinchTab automation on that authenticated profile:
   ```bash
   pinchtab instance start --mode headed --profile profile_1
   ```
