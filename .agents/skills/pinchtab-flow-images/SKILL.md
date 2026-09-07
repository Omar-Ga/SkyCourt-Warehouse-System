---
name: pinchtab-flow-images
disable-model-invocation: true
description: >
  STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. Automate image generation on Google Flow (labs.google/fx/tools/flow) using
  PinchTab browser automation. Covers launching the browser, creating projects,
  selecting models, entering prompts, generating images, monitoring progress,
  and downloading default 1k or 2k upscaled images to the workspace.
  Designed as a drop-in replacement for built-in AI image generation in frontend
  workflows — the agent uses Google Flow to produce higher-quality images instead.
---

# Google Flow — PinchTab Automation Skill

## Overview

Google Flow is Google's AI creative studio for generating images.
This skill teaches agents how to drive it end-to-end via PinchTab CLI, from
launching the browser to delivering generated images inside a project.

**Primary use case**: When building websites or frontends with an AI agent,
use this skill instead of the agent's built-in image generation tool to
produce higher-quality images through Google Flow.

---

## Prerequisites

- PinchTab server must be running (use `schtasks /Run /TN "LaunchPinchTabGUI"`)
- A headed Brave instance on the `default_profile` named profile must be running
  (Google Flow plan is active on that account):
  `pinchtab instance start --mode headed --profile default_profile`
  (see `pinchtab-account-setup` skill for profile management)
- Active Google Flow plan on this account

---

## End-to-End Workflow

### Step 1 — Launch PinchTab & Navigate to Flow

```bash
# Ensure PinchTab is running (per GUI launch rule)
schtasks /Run /TN "LaunchPinchTabGUI"

# Wait for server health (retry up to 5 times with 2s intervals)
# Health endpoint requires auth token — a 401/403 response still means the server is UP

# Start a headed Brave instance on the default_profile named profile.
# multiInstance.strategy is "explicit" — nothing auto-launches, and
# `pinchtab nav` without a running instance returns Error 503.
pinchtab instance start --mode headed --profile default_profile

# Navigate to Google Flow
pinchtab nav https://labs.google/fx/tools/flow
```

### Step 2 — Create a New Project

After navigating to the Flow homepage, take a snapshot and find the "New project" button:

```bash
pinchtab snap
# Look for: button "add_2 New project"
pinchtab find "New project"
# Click the returned ref
pinchtab click <ref>
```

Wait 3 seconds for the project to load, then take a snapshot to confirm you're
inside the project editor.

### Step 3 — Dismiss Banners & Popups (If Present)

On first load, Flow may show promotional banners or an onboarding dialog.
Look for and dismiss these:

```bash
pinchtab snap
# Look for: button "close Dismiss Dismiss" or button "close Close"
# If found, click it. If not found, skip this step.
```

### Step 4 — Configure Generation Settings

The prompt bar sits at the bottom of the project editor. It contains:

```
[+ Create] [prompt textbox] [Agent toggle] [model pill] [→ Create]
```

#### Opening the Settings Popover

The **model pill** button shows the current configuration. Its label follows
this pattern:

- Image mode pill label: `"🍌 Nano Banana 2 crop_16_9 x2"`

To open the settings popover:

```bash
pinchtab find "Nano Banana"
# Returns the model pill ref
pinchtab focus <ref>
pinchtab press Enter
```

#### Image Settings Popover Layout

Once open, the popover shows these controls:

| Control | Options | How to Identify |
|---------|---------|-----------------|
| **Aspect Ratio** | `tab "crop_16_9 16:9"`, `tab "crop_landscape 4:3"`, `tab "crop_square 1:1"`, `tab "crop_portrait 3:4"`, `tab "crop_9_16 9:16"` | Tab elements with crop_ icon prefix |
| **Model Selector** | `button "🍌 Nano Banana 2 arrow_drop_down"` | Button with 🍌 emoji + arrow_drop_down |
| **Batch Size** | `tab "x1"`, `tab "x2"`, `tab "x3"`, `tab "x4"` | Tab elements: x1, x2, x3, x4 |
| **Credit Cost** | `link "0 credits"` | Link showing cost |

#### Selecting an Image Model

Click the model dropdown button (contains `arrow_drop_down`):

```bash
pinchtab snap
# Find: button containing "arrow_drop_down" AND "Nano Banana"
pinchtab click <ref>
```

This opens a menu with these options:

| Model Name | Menu Item Label | Best For |
|------------|----------------|----------|
| **Nano Banana Pro** | `menuitem "🍌 Nano Banana Pro"` | Highest quality images |
| **Nano Banana 2** | `menuitem "🍌 Nano Banana 2"` | Good balance of quality & speed (DEFAULT) |
| **Nano Banana 2 Lite** | `menuitem "🍌 Nano Banana 2 Lite"` | Fastest generation, lower quality |

```bash
pinchtab snap
# Click the desired model menuitem
pinchtab click <ref>
```

**Default**: If the user does not specify a model, use **Nano Banana 2**.

#### Selecting Batch Size

```bash
pinchtab snap
# Find the desired batch tab: "x1", "x2", "x3", or "x4"
pinchtab click <ref>
```

#### Closing the Settings Popover

```bash
pinchtab press Escape
```

---

## ⚠️ CRITICAL — How to Enter Prompts

Google Flow uses a **React contenteditable div**, NOT a standard HTML input.
The standard `pinchtab fill` command **WILL NOT WORK** — it sets the DOM value
directly but bypasses React's synthetic event system, leaving React's internal
state empty and the submit button inactive.

### ✅ Correct Method (ALWAYS use this)

```bash
# 1. Find the prompt textbox
pinchtab find "What do you want to create"
# Returns the textbox ref

# 2. Focus it
pinchtab focus <ref>

# 3. Insert text via keyboard events (fires React's input listeners)
pinchtab keyboard inserttext "your prompt here"

# 4. Verify the text was entered (optional but recommended)
pinchtab snap
# Confirm the textbox val now contains your prompt text
```

### ❌ NEVER Do This

```bash
# This WILL NOT WORK on Google Flow:
pinchtab fill <ref> "your prompt here"
```

---

## Step 5 — Submit Generation

After entering the prompt and configuring settings:

```bash
# Option A: Press Enter while the prompt textbox is focused
pinchtab press Enter

# Option B: Click the submit button
pinchtab find "arrow_forward Create"
pinchtab click <ref>
```

---

## Step 6 — Monitor Generation Progress

After submitting, images go through a generation pipeline. Monitor progress:

```bash
# Wait a few seconds then check text
Start-Sleep -Seconds 5
pinchtab text
```

**Progress indicators in page text**:
- `XX%` (e.g., `17%`, `47%`, `53%`) — Generation in progress
- `warning Failed` — This text appears as a CSS icon label on card templates during generation; it does NOT necessarily mean actual failure. Check for the `XX%` progress indicator alongside it.
- **No percentage visible + "Generated image" in snapshot** — Generation complete

**Polling strategy**:
1. Wait 5 seconds after submission, take first reading
2. If percentage visible, wait 15 seconds between polls
3. Generation typically completes in 20–40 seconds for images
4. Confirm completion: `pinchtab snap` should show `image "Generated image"` nodes without any `XX%` text

---

## Step 7 — Downloading & Upscaling Images

There are **three ways** to download generated images from Google Flow.

---

### ⚡ Method A: Direct Attribute URL Download (FASTEST — 1 Tool Call, Zero UI Clicks)

By extracting the `src` attribute of the generated `image` node via `pinchtab attr`, you get the direct authenticated media endpoint. Using `pinchtab download`, the image downloads directly to your exact target workspace directory in **1 tool call**.

#### 1K Original Direct Download
```bash
# 1. Extract the media URL from the image node
pinchtab attr <image_ref> src
# Output: /fx/api/trpc/media.getMediaUrlRedirect?name=588a8b48-02fb-46e3-886f-6e0159af53aa

# 2. Download directly to your target file path via authenticated session
pinchtab download "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=..." -o "path/to/my_image.jpeg"
```

* **Speed**: Instant (~1 second)
* **Tool calls**: 2 calls for 4 images (batchable!)
* **Prerequisite**: `security.allowDownload: true` in `config.json`

---

### 🌟 Method B: Detail Viewer Loop (RECOMMENDED FOR 2K UPSCALING — Fastest Batch Upscale)

When you need **2K Upscaling** across multiple images in a batch, entering Detail View (`/edit/<id>`) is significantly faster than canvas context menus because **the 2K Upscaled option is on the 1st level popover (no hover submenus)** and you can cycle through images using `ArrowRight`.

```bash
# 1. Open the first image in Detail View
pinchtab click <card_ref> --wait-nav

# 2. Click Download toolbar button
pinchtab click <download_ref>  # or: pinchtab find "Download" -> pinchtab click <ref>

# 3. Select 2K Upscaled (immediately visible on 1st level popover — no hover needed!)
pinchtab snap
pinchtab click <2k_upscaled_ref>  # menuitem "2K Upscaled"

# 4. Press Right Arrow key to switch instantly to the next image in the project!
pinchtab press ArrowRight

# 5. Repeat steps 2-4 for all remaining images in the batch!
```

* **Why it's faster**: Eliminates mouse hover triggers, eliminates 3-level flyout submenus, and lets you trigger upscaling for an entire 4-image batch in seconds using simple `Download` -> `2K` -> `ArrowRight` keystrokes.

---

### Method C: Canvas 3-Dots Menu (Alternative Single Image UI Download)

Useful for downloading or upscaling a single isolated image directly from the canvas grid without opening the detail viewer.

```bash
# 1. Hover over the image card to reveal 3-dots menu
pinchtab hover <card_ref>
pinchtab snap

# 2. Click 3-dots button on that card
pinchtab click <more_vert_ref>
pinchtab snap

# 3. Hover over "download Download" to reveal resolution sub-flyout
pinchtab hover <download_ref>
pinchtab snap

# 4. Click "2K Upscaled" or "1K Original size"
pinchtab click <resolution_ref>
```

---

### Moving Downloads to Workspace Root

Downloaded files land in `~/Downloads` (`$env:USERPROFILE\Downloads`). Move them into the active workspace root:

```powershell
Get-ChildItem "$env:USERPROFILE\Downloads" | Sort-Object CreationTime -Descending | Select-Object -First <count> | Copy-Item -Destination ".\public\images\" -Force
```

---

## Element Identification Strategy

**Refs (`e0`, `e19`, etc.) are NOT stable across page loads.** The numeric
suffix changes depending on how many images, banners, or dynamic elements
are on screen.

### How to Reliably Find Elements

Always use **semantic matching** via `pinchtab find` or label pattern matching
in `pinchtab snap` output:

| Element | Find Query | Snap Pattern |
|---------|-----------|--------------|
| Prompt textbox | `pinchtab find "What do you want to create"` | `textbox val="What do you want to create?"` |
| Model pill | `pinchtab find "Nano Banana"` | `button "🍌 Nano Banana ... crop_... x..."` |
| Submit button | `pinchtab find "arrow_forward Create"` | `button "arrow_forward Create"` |
| Add media (+) | `pinchtab find "add_2 Create"` | `button "add_2 Create"` |
| Agent toggle | `pinchtab find "Agent"` | `button "Agent"` |
| New project | `pinchtab find "New project"` | `button "add_2 New project"` |
| Go Back | `pinchtab find "Go Back"` | `button "arrow_back Go Back"` |
| Clear prompt | `pinchtab find "Clear prompt"` | `button "close Clear prompt"` |
| All Media sidebar | `pinchtab find "All Media"` | `button "dashboard All Media"` |
| Images filter | `pinchtab find "View images"` | `button "image View images"` |

---

## Quick Reference — Full Image Generation & Download Sequence

```bash
# 1. Navigate to Flow & Create Project
pinchtab nav https://labs.google/fx/tools/flow
pinchtab snap
pinchtab find "New project"
pinchtab click <ref>
Start-Sleep -Seconds 3

# 2. Enter Prompt & Submit
pinchtab find "What do you want to create"
pinchtab focus <ref>
pinchtab keyboard inserttext "A beautiful futuristic website banner"
pinchtab press Enter

# 3. Monitor Progress
Start-Sleep -Seconds 15
pinchtab text

# 4. Download Images (Choose Method A or B)
# Method A (Fastest 1K Direct Download):
pinchtab attr <image_ref> src
pinchtab download "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=..." -o "my_image.jpeg"

# Method B (Fastest 2K Upscaling Loop):
# Open image 1 in Detail View -> Click Download -> Click 2K Upscaled -> Press ArrowRight to next image!
pinchtab click <card_ref> --wait-nav
pinchtab click <download_ref>
pinchtab click <2k_upscaled_ref>
pinchtab press ArrowRight
```

---

## Known Quirks & Gotchas

1. **`fill` does not work on the prompt bar** — Always use `focus` + `keyboard inserttext`
2. **"warning Failed" text during generation** — This is a CSS icon class label on card templates, not an actual error. Real progress is tracked via `XX%` percentages.
3. **Optimal Download Choices**: For 1K images, always use Method A (`pinchtab attr` + `pinchtab download`) for 1-call instant downloads. For 2K batch upscaling, use Method B (Detail View + `ArrowRight` loop) to avoid nested hover menus.
4. **2K Upscaling takes 10–15 seconds** — Toast notification will confirm `"Upscaling complete, your image has been downloaded!"`.
5. **Refs shift dynamically** — Never hardcode ref numbers. Always use `pinchtab find` or match labels from `pinchtab snap`.
6. **Settings popover blocks interaction** — Always `pinchtab press Escape` after changing settings before trying to interact with the prompt bar.

---

## Future Additions (Planned)

- [ ] Image editing / inpainting flows
- [ ] Character creation and management
- [ ] Tools gallery integration
- [ ] Batch operations across multiple prompts
