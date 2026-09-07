---
name: pinchtab-brave-attach-linux
disable-model-invocation: true
description: >
  STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. Drive an ALREADY-RUNNING, ALREADY-LOGGED-IN Brave profile on Linux by attaching
  over CDP with PinchTab bridge. Use when the task needs the user's real browser identity
  (existing site logins, real cookies, real extensions) and does NOT need stealth or
  fingerprint control.
metadata:
  openclaw:
    requires:
      bins:
        - pinchtab
      anyBins:
        - brave
        - brave-browser
    homepage: https://github.com/pinchtab/pinchtab
---

# PinchTab — Attach to a Live Brave Profile (Linux)

This skill allows PinchTab to attach to your real, daily Brave browser on Linux over CDP without creating separate isolated directories.

## Choose the Right Skill

| Need | Use |
|---|---|
| The user's real logins, real cookies, real extensions on Linux | **this skill (`pinchtab-brave-attach-linux`)** |
| Zero manual sign-in step, works on existing browser sessions | **this skill (`pinchtab-brave-attach-linux`)** |
| Stealth, isolated profiles, disposable testing | `pinchtab-account-setup-linux` |
| Headless operation | `pinchtab-account-setup-linux` |

## Setup & Execution

### 1. Launch Brave with the Remote Debugging Port

On Linux, launch Brave with `--remote-debugging-port=9222` and `--profile-directory="Default"`:

```bash
brave --remote-debugging-port=9222 --profile-directory="Default" &
```

> **Rules**:
> - The `--remote-debugging-port` flag must be present on the first launch of the browser process.
> - Always specify `--profile-directory="Default"` (or your preferred named subprofile) so Brave skips the profile picker.

### 2. Verify Port Availability

Confirm the DevTools endpoint is live:

```bash
curl -s http://127.0.0.1:9222/json/version
```

### 3. Attach PinchTab Bridge

Start the standalone PinchTab bridge targeting the debug port:

```bash
pinchtab bridge --cdp-attach http://127.0.0.1:9222 --remote-browser-name brave
```

Or run in background:
```bash
nohup pinchtab bridge --cdp-attach http://127.0.0.1:9222 --remote-browser-name brave > ~/.pinchtab/bridge.log 2>&1 &
```

### 4. Control the Browser

Once attached, drive the live session directly:

```bash
pinchtab --server http://127.0.0.1:9868 tab
pinchtab --server http://127.0.0.1:9868 nav https://github.com --snap
```
