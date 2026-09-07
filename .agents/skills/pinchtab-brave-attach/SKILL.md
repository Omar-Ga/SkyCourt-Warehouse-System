---
name: pinchtab-brave-attach
disable-model-invocation: true
description: >
  STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. Alternative to pinchtab-account-setup. Drive an ALREADY-RUNNING, ALREADY-LOGGED-IN
  Brave profile with PinchTab by attaching over CDP, instead of signing into a
  dedicated isolated Chrome directory. Use this when the task needs the user's real
  browser identity (existing site logins, real cookies, real extensions) and does NOT
  need stealth or fingerprint control. Covers why Chrome cannot do this, the exact
  launch/attach commands, the stale-tab failure mode that must be handled, and when to
  prefer the isolated-profile skill instead.
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

# PinchTab — Attach to a Live Brave Profile

This skill is an **alternative**, not a replacement, for `pinchtab-account-setup`.
Both are valid. Pick per task using the decision table below.

## Choose the right skill first

| Need | Use |
|---|---|
| The user's real logins, real cookies, real extensions | **this skill** |
| Zero manual sign-in step, works on any account already in Brave | **this skill** |
| Stealth, fingerprint spoofing, `cloak` provider, `--fingerprint-*` | `pinchtab-account-setup` |
| Parallel/disposable/isolated automation, many instances | `pinchtab-account-setup` |
| Headless operation | `pinchtab-account-setup` |
| Google Chrome specifically (not Brave) | `pinchtab-account-setup` — attach is impossible, see below |

## Why this works on Brave but not on Chrome

Chrome 136+ refuses DevTools remote debugging on the default user-data directory.
Verified on Chrome 151.0.7922.138:

| Launch | Chrome 151 | Brave 151.1.93.136 |
|---|---|---|
| `--remote-debugging-port=P` (implicit default dir) | **BLOCKED** | **OPEN** |
| `--user-data-dir="<the real User Data>" --remote-debugging-port=P` | **BLOCKED** | **OPEN** |
| `--user-data-dir="<fresh throwaway dir>" --remote-debugging-port=P` | OPEN | OPEN |

Chrome's exact stderr when blocked:

```
DevTools remote debugging requires a non-default data directory. Specify this using --user-data-dir.
```

Consequences:

- No CDP tool can attach to a real Chrome profile. Not PinchTab, not Playwright, not
  Puppeteer. This is a Chrome security mitigation, not a PinchTab limitation.
- Brave did not adopt that patch, so Brave's real profile is attachable.
- `--profile-directory` does **not** change the outcome on Chrome. It is still the
  default data directory, so it is still refused.

> Note: `pinchtab-account-setup` states that Failed Approach #3 fails because of
> "Chrome process delegation." Delegation is real but secondary — the port would never
> open on Chrome even with zero Chrome processes running, because of the block above.

## PinchTab has no Brave provider — and does not need one

`pinchtab doctor browsers` reports exactly three providers:

```
chrome, cloak, ghost-chrome
```

There is no `brave` provider. That does not matter, because:

1. `pinchtab bridge --cdp-attach <url>` only needs a CDP endpoint. It does not care
   which Chromium is behind it.
2. On Windows, discovery is not implemented anyway (`SKIP chrome_present: chrome
   discovery not implemented on windows`), so PinchTab relies on `browser.binary`,
   which accepts any Chromium binary path including `brave.exe`.

Use `--remote-browser-name brave` purely as a label for `pinchtab bridges list`.

## Setup

### 1. Launch Brave with the debug port — from the very first launch

```powershell
& "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" `
  --remote-debugging-port=9222 --profile-directory="Default"
```

Two rules that are not optional:

- **The flag must be present on the first launch.** If Brave is already running
  without it, launching again with it just delegates to the existing process and the
  port never opens. This is the delegation problem, and it applies to Brave too.
- **Always pass `--profile-directory`.** Omit it and Brave shows the profile-picker
  screen and waits for a human click.

The repo already ships a launcher that does the port part:
`bridge/launch_brave_rp.bat`. It accepts a profile argument but never forwards it to
`brave.exe` — fix that if you want deterministic profile selection.

Best long-term setup: add `--remote-debugging-port=9222` to the Brave shortcut you
normally click. Then the port is always available, one Brave serves both PinchTab and
Playwright MCP, and there is no launch ceremony.

Find profile-to-account mapping in `Local State`:

```powershell
$b = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"
(Get-Content "$b\Local State" -Raw | ConvertFrom-Json).profile.info_cache.PSObject.Properties |
  ForEach-Object { "{0,-12} name='{1}'" -f $_.Name, $_.Value.name }
```

### 2. Verify CDP before involving PinchTab

Always confirm the endpoint first. This isolates Brave problems from PinchTab problems.

```powershell
Invoke-RestMethod "http://127.0.0.1:9222/json/version"
```

Expect a `webSocketDebuggerUrl`. If this fails, stop — do not attach.

### 3. Attach the bridge

```powershell
pinchtab bridge --cdp-attach http://127.0.0.1:9222 `
  --port 9872 --bind 127.0.0.1 --remote-browser-name brave
```

Healthy startup banner:

```
PinchTab  bridge
  listen    starting 127.0.0.1:9872
  security  ELEVATED
```

If it prints `security LOCKED`, the config did not load and `eval`/`cookies` will be
denied. Check `pinchtab config validate`.

`schtasks` is **not** required for bridge mode. A plain hidden `Start-Process` works
and does not hit `0xc0000142`. The `pinchtab_gui_launch` rule applies to
`pinchtab server` in headed mode, not to `bridge --cdp-attach`.

### 4. Drive it

```powershell
pinchtab --server http://127.0.0.1:9872 nav <url> --snap
pinchtab --server http://127.0.0.1:9872 click <ref> --snap-diff
```

All normal PinchTab commands and refs work unchanged. See the `pinchtab` skill.

## CRITICAL: the stale-tab failure mode

This is the single biggest source of flakiness and you must handle it explicitly.

PinchTab pins itself to one CDP target ID. On a profile a human is also using, that
tab will eventually be closed by the human. When that happens **every** command fails
and PinchTab does **not** recover on its own:

```
Error 500: inspect title: context deadline exceeded
Error 500: inspect url: context deadline exceeded
Error 504: resolve topmost dialog: resolve top frame: context deadline exceeded
Request failed: Post ".../tabs/<DEAD_ID>/navigate": context deadline exceeded
```

Diagnosing is easy: raw CDP stays perfectly healthy while PinchTab is wedged.

```powershell
# raw CDP fine (many targets) but pinchtab wedged => stale pinned target
(Invoke-RestMethod "http://127.0.0.1:9222/json/list") | Where-Object type -eq page |
  Select-Object title,url
```

**Recovery — re-pin to a live tab:**

```powershell
$S = "http://127.0.0.1:9872"
$tabs = (Invoke-RestMethod "$S/tabs" -Headers @{Authorization="Bearer $env:PINCHTAB_TOKEN"}).tabs
pinchtab --server $S tab $tabs[0].id     # re-pins, everything works again
```

**Required discipline:** at the start of every run, and after any long pause, list
tabs and explicitly `pinchtab tab <id>` onto a known-live tab. Never assume the
previously pinned tab still exists.

## Other confirmed gotchas

- **Raise timeouts.** Default `timeouts.actionSec: 15` is too low for real pages.
  `youtube.com/account` exceeded it and wedged the pinned tab. Use ~30 for attach work.
- **Window title is rewritten** to `[PinchTab :9872]`. Cosmetic, but it looks alarming.
- **Stealth is unavailable.** `--fingerprint-*` and cloak flags cannot be injected into
  an already-running browser. For logged-in work you want the real fingerprint anyway.
  If a task needs stealth scoring, switch to `pinchtab-account-setup`.
- **`server.port` must be a STRING in config.json.** A number fails to parse:
  `json: cannot unmarshal number into Go struct field ServerConfig.server.port of type string`.
  So `"port": "9867"` is correct and `"port": 9867` is a hard error.
- **You are automating the user's real browser.** Every action touches real logged-in
  sessions. Never clear cookies, never mass-close tabs, never sign anything out. Restore
  any tab you navigate away from.

## Isolating experiments from the user's real config

Use `PINCHTAB_CONFIG` to test without touching `%APPDATA%\pinchtab\config.json`:

```powershell
$t = "$env:TEMP\pt-brave"; New-Item -ItemType Directory "$t\state" -Force | Out-Null
@{
  server  = @{ port = "9875"; bind = "127.0.0.1"; token = "temptoken"; stateDir = "$t\state" }
  browser = @{ binary = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" }
  security = @{ allowEvaluate = $true; allowCookies = $true; allowedDomains = @("*")
    attach = @{ enabled = $true; allowHosts = @("127.0.0.1","localhost","::1")
                allowSchemes = @("ws","wss","http","https") } }
} | ConvertTo-Json -Depth 12 | Set-Content "$t\config.json" -Encoding UTF8

$env:PINCHTAB_CONFIG = "$t\config.json"; $env:PINCHTAB_TOKEN = "temptoken"
pinchtab config validate
```

Requires `security.attach.enabled: true`, which the main config already sets.

## Teardown

```powershell
Get-CimInstance Win32_Process -Filter "Name='pinchtab-windows-amd64.exe'" |
  Where-Object { $_.CommandLine -match 'cdp-attach' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# close Brave gracefully so exit_type stays "Normal" (avoids the crash-restore bubble)
Get-Process brave | Where-Object MainWindowHandle -ne 0 | ForEach-Object { $_.CloseMainWindow() }
```

Never `Stop-Process -Force` the user's Brave. Use `CloseMainWindow()`.

## Verified working reference run

```
pinchtab bridge --cdp-attach http://127.0.0.1:9360 --port 9875 --remote-browser-name brave
  -> security ELEVATED ; health {"status":"ok","version":"0.15.1"}
  -> /tabs showed the user's real pre-existing tab
  -> nav https://en.wikipedia.org/wiki/Wikipedia
  -> title: [PinchTab :9875] Wikipedia - Wikipedia
  -> url:   https://en.wikipedia.org/wiki/Wikipedia
```

Tested against Brave 151.1.93.136 + PinchTab 0.15.1 on Windows.
