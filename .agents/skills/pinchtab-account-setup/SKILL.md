---
name: pinchtab-account-setup
disable-model-invocation: true
description: >
  STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. How to configure PinchTab to always open with a specific Google account
  by giving it a dedicated, isolated browser User Data directory. Covers the
  correct architecture (Brave + named profiles registered via the HTTP API),
  clean 1-tab startup configuration, manual sign-in / CAPTCHA bypass workflow,
  all failed approaches to avoid, and multi-account switching.
---

# PinchTab Account Setup & Switching

## Browser: Brave (not Chrome)

PinchTab runs on **Brave**, configured via `browser.binary` in
`%APPDATA%\pinchtab\config.json`:

```json
"browser": {
  "binary": "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
}
```

Why Brave over Chrome/Edge (verified empirically on pinchtab 0.15.1, 2026-08-20):

- PinchTab's Brave launch profile ships **bubble-suppression flags** natively:
  `--hide-crash-restore-bubble`, `--disable-session-crashed-bubble`,
  `--noerrdialogs` — kills the profile-picker / crash-restore windows that
  plagued Chrome.
- Better stealth defaults out of the box: `--disable-automation`,
  `--enable-automation=false`, `--disable-blink-features=AutomationControlled`.
- Brave is Chromium — DPAPI/App-Bound Encryption, isolated `--user-data-dir`,
  and one-time sign-in persistence behave identically to Chrome.
- Chrome's real profile picker used to open as a separate window because
  Chrome fell back to the real `User Data\`; with Brave + named profiles this
  never happens.

After changing `browser.binary`, restart the server (via schtasks — see below).

## Core Concept

Each PinchTab instance launches with:

```
--user-data-dir="<profiles.baseDir>\<profileDir>"
```

Chromium's **App-Bound Encryption** (DPAPI) ties cookie decryption to the
**exact path string** of the profile directory. This means:

- You **cannot** copy/junction another profile's cookies in — the browser will
  refuse to decrypt them.
- The only reliable way to have a persistent, specific Google account is to
  **sign into it once inside PinchTab's own isolated directory**, and let the
  browser save the encrypted session there.
- The directory must be **stable across launches** — see the named-profile
  section below. This is the whole ballgame for persistence.

## Critical: Named profiles (fixes the ephemeral instance dir)

**The bug:** if PinchTab's profile registry is empty, `pinchtab instance start`
creates a throwaway `instance-<timestamp>` directory under `profiles.baseDir`
every single launch. Every session is a blank slate — logins never persist.

**The fix:** register a **named profile** via the server's HTTP API. The CLI has
no `profiles create` subcommand (only `profiles` / `profiles prune`), so use:

```powershell
$token = (Get-Content "$env:APPDATA\pinchtab\config.json" -Raw | ConvertFrom-Json).server.token
$h = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Uri "http://127.0.0.1:9867/profiles" -Method Post -Headers $h `
  -ContentType "application/json" -Body '{"name":"profile_1"}'
```

Response:

```json
{"id":"prof_sample1","name":"profile_1","status":"created"}
```

This creates a **stable** directory at `<profiles.baseDir>\prof_<id>` (e.g.
`...\PinchTab User Data\prof_sample1`) and registers it. From then
on, ALWAYS launch with the profile name:

```powershell
pinchtab instance start --mode headed --profile profile_1
```

Verified behavior: stop → start again with `--profile profile_1` reuses the
**same** `--user-data-dir` (confirmed via brave.exe command line across
restarts). No more `instance-<timestamp>` dirs.

Notes:

- `POST /profiles` accepts only `{"name": "..."}`. Extra fields like `baseDir`
  return 409; unknown fields return 400.
- `instance start --profile <name>` returns `Error 404: profile "<name>" not
  found` if the registry is empty — register first.
- The old `profiles.defaultProfile` config key and the `--profile default`
  convention from pinchtab ≤0.14 no longer work on 0.15.1 (404). Use named
  profiles.

## Architecture: One Named Profile Per Account

```
%LOCALAPPDATA%\BraveSoftware\Brave-Browser\
  ├── User Data\                          ← real Brave, untouched
  └── PinchTab User Data\                 ← profiles.baseDir (config.json)
      ├── prof_sample1\                   ← named profile "profile_1" (stable / default)
      ├── prof_sample2\                   ← named profile "profile_2" (stable)
      ├── prof_sample3\                   ← named profile "profile_3" (stable)
      ├── prof_sample4\                   ← named profile "profile_4" (stable)
      └── instance-<timestamp>\           ← EPHEMERAL — only when no --profile given
```

`config.json` holds the base directory:

```json
"profiles": {
  "baseDir": "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\PinchTab User Data",
  "defaultProfile": "default",
  "quarantineKeep": 1
}
```

### Example Profile Registry Table

| Profile name | Profile ID | Account Role | Signed-in persistence tested |
|---|---|---|---|
| `profile_1` *(default)* | `prof_sample1` | Primary Account | yes |
| `profile_2` | `prof_sample2` | Backup / Secondary Account | yes |
| `profile_3` | `prof_sample3` | Workflow Account | yes |
| `profile_4` | `prof_sample4` | Failover Account | yes |

There is **no profile picker** in this model — each named profile is its own
isolated `--user-data-dir` containing exactly one browser profile, so there is
nothing to pick from. "Choosing a profile" is simply the `--profile` flag at
launch.

---

## Clean Tab Startup Configuration

To prevent browsers from resurrecting dozens of old tabs from prior sessions:
1. Every profile has `"session": { "restore_on_startup": 1, "startup_urls": [] }` in its `Default/Preferences` (`1` = New Tab Page).
2. PinchTab's `config.json` sets `"instanceDefaults": { "noRestore": true }` and passes `--no-restore-session-state`.
3. Each new instance starts with **1 clean tab** instead of accumulating stale tabs.

---

## Manual Sign-In / CAPTCHA Bypass (Clean Standalone Mode)

Some authentication providers (Google Sign-In, Cloudflare Turnstile, Arkose, 2FA, passkeys) detect active automation / CDP debugging flags and block buttons or popup flows.

To bypass this without losing profile cookies, launch the profile in **Clean Standalone Mode** (no CDP, no PinchTab daemon attached).

### Usage Discipline (Strict Rule)
> **The manual standalone helper script is NOT to be used unless explicitly requested by the user, or when an automated sign-in / CAPTCHA is blocked and requires manual user intervention.**

### Execution Protocol

1. **Stop active PinchTab instance / processes** to unlock the profile folder:
   ```powershell
   Get-Process brave,pinchtab-windows-amd64 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
   ```

2. **Launch Standalone Clean Brave via Task Scheduler**:
   ```powershell
   schtasks /Create /TN "LaunchManualBrave" /TR 'powershell.exe -ExecutionPolicy Bypass -File "%APPDATA%\pinchtab\launch-manual-auth.ps1" -Profile profile_1 -Url "<url>"' /SC ONCE /ST 23:59 /F
   schtasks /Run /TN "LaunchManualBrave"
   ```

3. **Notify User**:
   Tell the user the standalone Brave window is open. Instruct them to complete the sign-in / CAPTCHA, close the window, and say *"I'm done"* in chat.

4. **Resume PinchTab Upon Confirmation**:
   When the user confirms they are done:
   - Ensure the standalone Brave window is closed (`Get-Process brave -ErrorAction SilentlyContinue | Stop-Process -Force`).
   - Start the PinchTab GUI server: `schtasks /Run /TN "LaunchPinchTabGUI"`
   - Start the instance: `pinchtab instance start --mode headed --profile profile_1`
   - Re-target the instance port (e.g. `pinchtab --server http://127.0.0.1:9868 ...`) and resume automation.

---

## Multi-Account Switching

With named profiles, switching accounts is just a different `--profile` flag —
no config.json patching, no server restart needed:

```powershell
pinchtab instance stop <currentInstanceId>
pinchtab instance start --mode headed --profile <otherAccount>
```

---

## Failed Approaches (do not retry)

1. **Junction/symlink the real profile into PinchTab's dir.** DPAPI decryption
   fails on the new path; the browser sees a corrupt profile.
2. **`--profile-directory` into the real Chrome User Data.** If any other
   Chrome window is open, Chrome delegates the launch to the existing process,
   the CDP port never opens, and PinchTab falls back to its own blank profile.
3. **Bridge mode with `--profile-directory`.** Same delegation problem as #2 —
   `pinchtab bridge --cdp-attach` ends up auto-launching a default-profile
   browser.
4. **Copying profile files across directories.** DPAPI is bound to the signed
   binary + OS user + exact path. Copied cookies/session files are unreadable.
5. **Relying on `profiles.defaultProfile` / `--profile default` (pinchtab
   0.15.1).** Returns `Error 404: profile "default" not found`. The registry is
   separate from the config key now.
6. **Launching without `--profile` on an empty registry.** Creates an
   ephemeral `instance-<timestamp>` dir — login is lost every session.

---

## Important Notes

### Stopping processes correctly

The PinchTab daemon process name is `pinchtab-windows-amd64` (NOT `pinchtab`).
The browser is `brave`. Always stop with:

```powershell
Get-Process brave,pinchtab-windows-amd64 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

### PinchTab must be started via schtasks

Per the GUI launch rule, always use `schtasks /Run /TN "LaunchPinchTabGUI"` —
never run `pinchtab server` directly from a subshell. Direct subshell launches
are invisible desktop sessions that cause `0xc0000142` errors. The scheduled
task runs `pinchtab server`.

### Instance targeting

Each instance gets its own port (9868+ from `multiInstance.instancePortStart`).
Target a specific instance with `--server http://127.0.0.1:<port>` on any CLI
command. `pinchtab instances --json` lists id/profileName/port/status.
