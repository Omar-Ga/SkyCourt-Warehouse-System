param(
    [string]$Profile = "default_profile",
    [string]$Url = ""
)

$bravePath = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"

# Resolve baseDir from config.json if present, otherwise default to local AppData
$configFile = "$env:APPDATA\pinchtab\config.json"
$baseDir = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\PinchTab User Data"

if (Test-Path $configFile) {
    try {
        $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
        if ($cfg.profiles.baseDir) {
            $baseDir = [System.Environment]::ExpandEnvironmentVariables($cfg.profiles.baseDir)
        }
    } catch {}
}

# Check if target is a direct folder or named profile in baseDir
$targetDir = Join-Path $baseDir $Profile
if (-not (Test-Path $targetDir)) {
    # If prof_<id> subfolder exists matching profile name or ID
    $matching = Get-ChildItem -Path $baseDir -Directory -Filter "*$Profile*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($matching) {
        $targetDir = $matching.FullName
    }
}

# Stop active PinchTab daemon and Brave instances to release profile lock
Get-Process brave,pinchtab-windows-amd64 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Launch standalone Brave without remote debugging / automation flags
$argList = "`"--user-data-dir=$targetDir`""
if ($Url) {
    $argList += " `"$Url`""
}

Start-Process -FilePath $bravePath -ArgumentList $argList
Write-Host "Opened standalone Brave session for profile '$Profile' ($targetDir)" -ForegroundColor Green
Write-Host "Complete your sign-in/sign-up in Brave, then close the window before resuming PinchTab." -ForegroundColor Yellow
