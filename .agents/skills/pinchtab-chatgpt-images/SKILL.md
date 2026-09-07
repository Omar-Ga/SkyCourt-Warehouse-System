---
name: pinchtab-chatgpt-images
disable-model-invocation: true
description: >
  STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. Automate image generation on ChatGPT (chatgpt.com) using PinchTab browser automation.
  Covers multi-account rate limit rotation across profiles (profile_1, profile_2, profile_3, profile_4),
  opening the composer tools menu, activating 'Create image' mode, entering prompts via
  contenteditable keyboard input, configuring aspect ratios (1:1, 3:4, 9:16, 4:3, 16:9),
  tracking generation completion, downloading full-resolution images, and prompt engineering
  best practices for OpenAI's latest image generation model (gptimage2 / DALL-E 3 / GPT-4o).
---

# ChatGPT Image Generation — PinchTab Automation Skill

## Overview

This skill teaches agents how to drive **ChatGPT's native image generator** (`gptimage2` / DALL-E 3 / GPT-4o Image Gen) end-to-end via the PinchTab CLI.

**Primary use cases**:
* Generating high-fidelity imagery, UI assets, logos, icons, 3D renders, and illustrations for projects.
* Rotating through multiple registered accounts to bypass server-side image quotas (~3–5 images per tier window).
* Extracting native full-resolution PNG image files directly into the workspace in 1 tool call.

---

## Prerequisites & Architecture

1. **PinchTab Server**: Must be running via Task Scheduler (GUI session):
   ```powershell
   schtasks /Run /TN "LaunchPinchTabGUI"
   ```
2. **Brave Browser & Named Profiles**:
   PinchTab is configured to drive Brave using isolated named profile directories. Example registered profiles:
   
   | Profile Name | Profile ID | Account Role | Port Range |
   | :--- | :--- | :--- | :--- |
   | **`profile_1`** | `prof_sample1` | Primary Account | `9868` |
   | **`profile_2`** | `prof_sample2` | Backup / Secondary Account | `9870` |
   | **`profile_3`** | `prof_sample3` | Workflow Account | `9872` |
   | **`profile_4`** | `prof_sample4` | Failover Account | `9874` |

3. **Instance Targeting Rule**:
   Always pass `--server http://127.0.0.1:<port>` on all commands to target the specific running instance and prevent spawning unintended blank browsers.

---

## Multi-Account Quota Rotation Strategy

ChatGPT enforces an account-level rate limit (typically ~3 to 5 images per cooldown window depending on server load).

### Failover Protocol:
1. Start with the primary profile (e.g. `profile_1`).
2. When ChatGPT triggers a quota limit (*"You've reached your image creation limit"*, *"Get Plus"*, or disabled prompt submission):
   ```bash
   # 1. Stop current exhausted instance
   pinchtab instance stop <currentInstanceId>

   # 2. Start next account profile in rotation
   pinchtab instance start --mode headed --profile profile_2
   # (Rotation pool: profile_1 -> profile_2 -> profile_3 -> profile_4)

   # 3. Retrieve new port from instance list
   pinchtab instances --json
   ```
3. Target the new port, navigate to `https://chatgpt.com/`, and seamlessly resume generating the remaining required images.

---

## End-to-End Generation Workflow

### Step 1 — Start Instance & Navigate

```bash
# Check if an instance is already active
pinchtab instances --json

# If not running, launch a headed instance
pinchtab instance start --mode headed --profile profile_1

# Navigate to ChatGPT
pinchtab --server http://127.0.0.1:<port> nav https://chatgpt.com/ --snap
```

---

### Step 2 — Open the Tools Popover (`+` Button)

The `+` button in the ChatGPT composer opens the tools and attachments menu:

```bash
# Click the '+' composer button
pinchtab --server http://127.0.0.1:<port> click "#composer-plus-btn" --snap-diff
```

*(Alternative selector: `[aria-label="Add files and more"]`)*.

---

### Step 3 — Select "Create image" Mode

Inside the floating `<div class="z-50 popover">` menu, click the `Create image` item:

```bash
pinchtab --server http://127.0.0.1:<port> click "text:Create image" --snap-diff
```

**Expected UI State**:
* The popover closes automatically.
* `#prompt-textarea` embeds the tool token badge: `Create image\n`.
* The send button activates as `button "Send prompt"`.
* An "Explore ideas" preset carousel appears above the composer.

---

### Step 4 — Enter Prompt Text via Keyboard Events

> [!CAUTION]
> **CRITICAL INPUT RULE**: `#prompt-textarea` is a React `contenteditable="true"` element. Standard `pinchtab fill` bypasses React's synthetic event listeners and leaves the composer state empty. **ALWAYS** use `focus` followed by `keyboard inserttext`.

```bash
# 1. Focus the prompt textarea
pinchtab --server http://127.0.0.1:<port> focus "#prompt-textarea"

# 2. Insert prompt text via keyboard events
pinchtab --server http://127.0.0.1:<port> keyboard inserttext "A modern 3D isometric app icon of a glowing holographic mechanical hummingbird hovering above a matte obsidian metallic base. Translucent frosted glass wings with delicate cyan and gold fiber-optic circuits visible inside. Clean minimalist aesthetic, Apple Human Interface Guidelines style, soft ambient occlusion shadows, centered on a neutral solid slate grey background. Aspect ratio: 1:1."
```

---

### Step 5 — Configure Aspect Ratios

Aspect ratios can be specified using either of two methods:

#### Method A: In-Prompt Specification (Recommended for New Generations)
Include the aspect ratio directly in the prompt text:
* `Aspect ratio: 1:1` (Square — `1254 x 1254` px)
* `Aspect ratio: 16:9` (Widescreen — `1672 x 941` px)
* `Aspect ratio: 9:16` (Vertical Story / Mobile Poster)
* `Aspect ratio: 4:3` (Standard Landscape)
* `Aspect ratio: 3:4` (Standard Portrait)

#### Method B: Aspect Ratio UI Tool (Lightbox / In-Place Re-Framing)
When viewing an already generated image in fullscreen lightbox view:
1. Click the **Aspect ratio** button in the top toolbar:
   ```bash
   pinchtab --server http://127.0.0.1:<port> click "[aria-label='Aspect ratio']" --snap-diff
   ```
2. Select desired preset from the popup menu:
   * `[aria-label="Square 1:1"]`
   * `[aria-label="Portrait 3:4"]`
   * `[aria-label="Story 9:16"]`
   * `[aria-label="Landscape 4:3"]`
   * `[aria-label="Widescreen 16:9"]`
3. Selecting an option automatically triggers an in-place edit request that re-renders the image into that exact framing.

---

### Step 6 — Submit & Monitor Generation Progress

```bash
# Submit the prompt
pinchtab --server http://127.0.0.1:<port> click "button[aria-label='Send prompt']" --snap-diff
```

**Monitoring Strategy**:
1. After clicking send, ChatGPT displays a `button "Stop answering"` while generating.
2. Wait ~12–20 seconds.
3. Poll with `pinchtab --server http://127.0.0.1:<port> snap`.
4. Generation is complete when `Stop answering` disappears and the response shows `image "Generated image: <Title>"`.

---

### Step 7 — Direct Full-Resolution Download (1 Tool Call)

ChatGPT does not require complex multi-step UI download clicks. Every generated image node contains the direct authenticated media endpoint in its `src` attribute.

```bash
# 1. Extract the authenticated estuary media URL from the image node
pinchtab --server http://127.0.0.1:<port> attr <image_ref> src
# Example output: https://chatgpt.com/backend-api/estuary/content?id=file_000000001c3081f5...&sig=...

# 2. Download directly to your target destination path
pinchtab --server http://127.0.0.1:<port> download "<extracted_url>" -o "path/to/my_image.png"
```

* **Output format**: Lossless full native resolution PNG (`~1254x1254` for 1:1, `~1672x941` for 16:9).
* **Speed**: Instant (~1 second), 1 tool call, zero browser download dialogs.

---

## `gptimage2` Prompting Guide & Best Practices

OpenAI's latest image generation models parse grammar, prepositional semantics, and contextual hierarchy.

### 1. Natural Language vs. "Tag Salad"
* ❌ **Avoid**: `cyberpunk warrior, glowing sword, 8k, unreal engine 5, masterpiece, trending on artstation, photorealistic`
* ✅ **Use**: `A cinematic medium shot of a cyberpunk street warrior standing in a rain-soaked Tokyo alley at night. She holds an energy katana that casts a vibrant cyan neon glow across her carbon-fiber tactical jacket and the wet asphalt reflections.`

### 2. The "Photorealistic" Paradox
* Do not use the word `"photorealistic"` when asking for authentic photographs (it triggers 3D CGI plastic rendering styles).
* Instead, specify real photographic parameters:
  * Camera & Film: `35mm film shot on Kodak Portra 400`, `editorial studio photography`
  * Lenses & Optics: `85mm prime lens at f/1.8`, `shallow depth of field with soft creamy bokeh`, `90mm macro lens`
  * Lighting: `softbox key light with golden hair rim lighting`, `overcast diffused soft lighting`

### 3. In-Image Typography Rules
* Always put exact text inside double quotes: `"EXACT TEXT"`.
* Specify typography style: `clean bold sans-serif lettering`, `embossed gold serif script`, `glowing red neon cursive`.
* Ensure high background contrast: `printed in crisp black typography on a matte white surface`.
* Keep strings short (1–4 words yields the highest fidelity).

### 4. Preventing Color & Trait Bleeding (Spatial Anchoring)
When multiple subjects or colors exist in the scene, separate them into distinct spatial zones:
* *Example*: `On the left side of the table sits an emerald-green ceramic mug. On the right side, completely separated, rests an orange leather-bound notebook.`

---

## Production-Ready Exemplar Prompts

### Example 1: Modern 3D App Icon / UI Graphic Asset
```text
A 3D isometric app icon representing cloud security. The icon features a stylized, frosted glass cloud container with smooth rounded edges, floating above a sleek matte obsidian rounded-square base. Inside the translucent cloud, a glowing golden metallic padlock is visible with soft internal illumination. Clean Apple Human Interface Guidelines aesthetic, vibrant accent lighting with soft ambient occlusion shadows, smooth claymorphic and glassmorphic materials, centered on a neutral solid light grey background. Aspect ratio: 1:1.
```

### Example 2: High-End Commercial Product Photography
```text
A high-end commercial studio product photograph of an amber glass skincare serum bottle with a matte black dropper cap. The bottle rests on a wet, dark charcoal slate pedestal surrounded by subtle, crystal-clear water ripples. Soft directional studio key lighting from the upper left illuminates the golden-honey liquid inside, casting subtle amber caustic light refractions onto the slate. Minimalist composition, ultra-clean reflections, shot on a 90mm macro lens at f/4 with soft background falloff. Aspect ratio: 1:1.
```

### Example 3: Editorial Character Portrait (35mm Film)
```text
An editorial fashion portrait of a 28-year-old woman with natural freckles, dark brown wavy hair, and subtle confident expression. She is wearing a structured forest-green wool coat with an oversized collar. Studio setting with a warm beige canvas backdrop. Softbox key lighting on her face with a subtle golden rim light catching the edge of her hair and cheekbone. Authentic 35mm film aesthetic, Kodak Portra 400 color tones, natural skin texture with visible fine pores, captured with an 85mm prime lens at f/1.8. Aspect ratio: 9:16.
```

### Example 4: Cinematic Widescreen Sci-Fi Environment
```text
A wide cinematic concept art keyframe of a futuristic botanical greenhouse inside a brutalist concrete colony on Mars. Massive geometric glass geodesic domes reveal the red Martian landscape and twin moons in the twilight sky outside. Inside, lush bioluminescent terraced flora emit soft emerald and violet light. A lone astronaut in a worn white EVA suit stands on an elevated metallic walkway in the midground, observing the plants. Volumetric mist catching the twilight beams, dramatic atmospheric depth. Aspect ratio: 16:9.
```

---

## Quick Reference Summary Table

| Action | Command / Target | Purpose |
| :--- | :--- | :--- |
| **Open Tools Menu** | `pinchtab click "#composer-plus-btn"` | Opens the composer popover |
| **Activate Image Tool** | `pinchtab click "text:Create image"` | Embeds `Create image` token badge |
| **Insert Prompt** | `pinchtab focus "#prompt-textarea" && pinchtab keyboard inserttext "<prompt>"` | Inputs prompt firing React events |
| **Send Prompt** | `pinchtab click "button[aria-label='Send prompt']"` | Submits generation |
| **Aspect Ratio Tool** | `pinchtab click "[aria-label='Aspect ratio']"` | Opens 1:1, 3:4, 9:16, 4:3, 16:9 dropdown |
| **Direct Download** | `pinchtab attr <image_ref> src && pinchtab download "<url>" -o "<path>"` | Downloads full native PNG (1 call) |
| **Quota Failover** | `pinchtab instance stop <id> && pinchtab instance start --mode headed --profile <next>` | Rotates to next account |
