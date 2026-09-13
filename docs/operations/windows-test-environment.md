# Windows Test Environment & SSH Access

This document details the local test environment and direct SSH connection configured for remote debugging, deploying, and inspecting `WarehouseApp.exe` builds on the physical Windows test workstation.

---

## 1. Remote Host Details

### Primary Test PC (`windows-test-pc`)
- **Host Alias:** `windows-test-pc`
- **IP Address:** `192.168.1.121`
- **Username:** `Eng Mhmd` *(Local Windows user account)*
- **Authentication:** SSH Key-based (`~/.ssh/id_ed25519`)
- **Port:** `22` (Standard OpenSSH Server on Windows)
- **App Directory on Remote:** `C:\Users\Eng Mhmd\Desktop\wapp\`

### Secondary Test PC (`man-pc`)
- **Host Alias:** `man-pc`
- **IP Address:** `192.168.1.103`
- **Username:** `man-pc` *(Local Windows user account)*
- **Authentication:** SSH Key-based (`~/.ssh/id_ed25519`)
- **Port:** `22` (Standard OpenSSH Server on Windows)
- **App Directory on Remote:** `C:\Users\man-pc\Desktop\wapp\`

---

## 2. SSH Configuration (`~/.ssh/config`)

The following host entries are configured in `~/.ssh/config`:

```ssh-config
Host windows-test-pc
    HostName 192.168.1.121
    User "Eng Mhmd"
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking no

Host man-pc
    HostName 192.168.1.103
    User "man-pc"
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking no
```

---

## 3. Standard Operational Commands

Agents and operators can interact with the Windows test machine directly without manual flash drives or passwords:

### Run Remote Commands
```bash
# Using SSH host alias:
ssh windows-test-pc "whoami"

# Or explicit command:
ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519 "Eng Mhmd"@192.168.1.121 "whoami"
```

### Deploy / Copy Files (SCP)
```bash
# Copy new build zip to Desktop:
scp dist_release/WarehouseApp-Windows/WarehouseApp-Windows.zip windows-test-pc:"C:\Users\Eng Mhmd\Desktop\WarehouseApp-Windows.zip"

# Or using explicit parameters:
scp -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519 dist_release/WarehouseApp-Windows/WarehouseApp-Windows.zip "Eng Mhmd"@192.168.1.121:"C:\\Users\\Eng Mhmd\\Desktop\\WarehouseApp-Windows.zip"
```

### Unpack & Launch Remotely
```bash
# Extract build:
ssh windows-test-pc "powershell -NoProfile -Command \"Expand-Archive -Path 'C:\Users\Eng Mhmd\Desktop\WarehouseApp-Windows.zip' -DestinationPath 'C:\Users\Eng Mhmd\Desktop\wapp' -Force\""

# Stop existing running instance:
ssh windows-test-pc "taskkill /F /IM WarehouseApp.exe /T 2>nul || exit 0"

# Launch application:
ssh windows-test-pc "cd /d \"C:\Users\Eng Mhmd\Desktop\wapp\" && WarehouseApp.exe"
```

### Port Forwarding / Tunnels (If Needed)
To forward the remote Flask port (`5070`) locally to inspect through your local browser:
```bash
ssh -L 5070:127.0.0.1:5070 windows-test-pc
```
