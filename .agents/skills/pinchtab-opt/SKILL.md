---
name: pinchtab-opt
disable-model-invocation: true
description: "STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. Run the PinchTab optimization loop (Docker, 3 blind subagents on the runner's HIGH model, 108 steps across 47 groups) against chrome, cloak, ghost-chrome, or all three providers. Pass `setup` (optionally followed by a provider or `all`) to run only the setup test (native binary, single subagent forced to the runner's LOW model) that validates the fresh-install OOTB flow per provider. Use when asked to 'run optimization', 'run the opt loop', 'benchmark the agent', '/pinchtab-opt', '/pinchtab-opt cloak', '/pinchtab-opt ghost-chrome', '/pinchtab-opt setup', '/pinchtab-opt setup all', or 'test pinchtab agent'."
---

# PinchTab Optimization Loop

Two independent modes selected by the argument. They use different runtimes, different models, and answer different questions — only one runs per invocation.

Think of the arg surface as a matrix: **mode × provider**. Model role is fixed by mode (not user-selectable).

| Mode | Providers | Runtime | Model role | Asks |
|---|---|---|---|---|
| **Optimization** (default) | `chrome` (default), `cloak`, `ghost-chrome`, `all` | Docker, 3 parallel subagents | `HIGH` (default/strong) | how few browser ops does the agent need across 108 steps vs baseline |
| **Setup** (`setup` keyword) | `chrome` (default), `cloak`, `ghost-chrome`, `all` | native binary, 1 subagent | `LOW` (small/fast) | can an agent go zero→working from the skill docs alone (OOTB doc-quality gate) |

## Model roles

This skill names model tiers abstractly so any runner (Claude, OpenAI, …) can map them at launch time:

- **`LOW`** — small/fast/cheap model. Used by the setup test because a weak model passing is the actual doc-quality signal; a strong model passing is unsurprising.
- **`HIGH`** — the runner's default/strong model. Used by the optimization benchmark because we want the realistic agent performance, not a deliberately handicapped run.

Suggested mappings (pick whatever the runner has available at the time it executes):

| Runner | `LOW` | `HIGH` |
|---|---|---|
| Claude Code | Haiku (e.g. `claude-haiku-4-5`) | inherit parent (Opus / Sonnet) |
| OpenAI Agents | `gpt-*-mini` tier | `gpt-*` flagship tier |
| Other | smallest capable model | default/best model |

The thresholds below were calibrated for Claude Haiku 4.5 as `LOW`; if you use a different `LOW`, recalibrate the token / tool-call numbers on the first run.

## Argument Parsing

`/pinchtab-opt [setup] [chrome|cloak|ghost-chrome|all]`

Positional args, in order. The first token is either a provider (optimization mode) or the literal `setup` keyword (setup mode); if `setup`, the second token is the provider.

**Optimization mode** (default — no `setup` keyword):
- `/pinchtab-opt` → opt on chrome
- `/pinchtab-opt chrome` → opt on chrome
- `/pinchtab-opt cloak` → opt on CloakBrowser
- `/pinchtab-opt ghost-chrome` → opt on ghost-chrome (Chrome image, ghost-chrome config)
- `/pinchtab-opt all` → opt on chrome, then cloak, then ghost-chrome

**Setup mode** (when first token is `setup`):
- `/pinchtab-opt setup` → setup on chrome (default)
- `/pinchtab-opt setup chrome` → setup on chrome
- `/pinchtab-opt setup cloak` → setup on cloak
- `/pinchtab-opt setup ghost-chrome` → setup on ghost-chrome
- `/pinchtab-opt setup all` → setup on each of the three, in order

Legacy `both` is **removed** (no alias) — use `all` for multi-provider runs. Anything else → print this section and abort.

## Path Resolution

All paths are relative to the **project root** (git root):

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
TOOLS_DIR="$PROJECT_ROOT/tests/tools"
OPT_DIR="$PROJECT_ROOT/tests/optimization"
SETUP_DIR="$PROJECT_ROOT/tests/optimization-setup"
```

The optimization subagents must run with `$TOOLS_DIR` as their working directory because `./scripts/pt` and `./scripts/runner` live there. The setup subagent runs with `$PROJECT_ROOT` as its working directory and builds a native binary.

`up.sh` / `down.sh` live in `$OPT_DIR`.
