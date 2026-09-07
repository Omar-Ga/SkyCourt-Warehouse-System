---
name: pinchtab-stealth-score
disable-model-invocation: true
description: "STRICTLY OFF BY DEFAULT. Only invoke this skill when the user explicitly requests PinchTab or pinchtab by name in their prompt. Do NOT activate implicitly for general browsing, web searching, or scraping. Run the PinchTab stealth-score sweep against 15 bot-detection / fingerprint sites (sannysoft, rebrowser, deviceandbrowserinfo, iphey, whoer, browserscan, pixelscan, fingerprint-scan, incolumitas, fvision, amiunique, browserleaks, creepjs, coveryourtracks, fingerprint-demo). Starts a Docker PinchTab container per browser (chrome / cloak / both), spawns a blind agent that drives PinchTab through plain-English per-site playbooks, captures structured metrics, prints a side-by-side comparison highlighting divergent metrics, and appends to history.jsonl for cross-session tracking. Use when asked to 'run stealth score', 'compare cloak vs chrome detection', 'measure stealth', or '/pinchtab-stealth-score'."
---

# PinchTab Stealth Score

Drive PinchTab through a list of public bot-detection sites under each browser
(`chrome`, `cloak`, or `both`), and collect the metrics that matter
most for analyst comparison. The Docker plumbing rebuilds the PinchTab image
from current source so you're benchmarking the working tree.

The shape is the same as `/pinchtab-opt`: one container per run, one blind
agent that reads English playbooks and drives PinchTab through `./scripts/pt`,
records per-site metrics, and the orchestrator summarizes.

## Argument Parsing

- `/pinchtab-stealth-score` → default to `both`
- `/pinchtab-stealth-score chrome` → chrome only
- `/pinchtab-stealth-score cloak` → cloak only
- `/pinchtab-stealth-score both` → run both sequentially

Anything else → print this section and abort.

## Site Catalogue

The agent processes the sites listed in `tests/stealth-score/sites/index.md`
(currently 15). The list is dynamic — to add or remove sites you only edit
that index and the matching `<id>.md` playbook. The skill itself doesn't hard-
code site names.

Current sites (15) — `sannysoft`, `rebrowser`, `deviceandbrowserinfo`, `iphey`,
`whoer`, `browserscan`, `pixelscan`, `fingerprint-scan`, `incolumitas`,
`fvision`, `amiunique`, `browserleaks` (multi-page: canvas+webgl+fonts+tls),
`creepjs`, `coveryourtracks`, `fingerprint-demo`.

Expected duration: ~12-15 min per browser once images are cached, so a `both`
run takes ~25-30 min plus first-time image build (~10 min for cloak).

## Path Resolution

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
SCORE_DIR="$PROJECT_ROOT/tests/stealth-score"
RESULTS_DIR="$SCORE_DIR/results"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$RESULTS_DIR"
```

## Prerequisites

Docker must be running.

```bash
docker info >/dev/null 2>&1 || { echo "Docker not running"; exit 1; }
```

If port 9867 on the host is already taken (e.g. a native PinchTab server), free
it first — both the chrome and cloak containers bind 9867:

```bash
pinchtab daemon stop 2>&1 || true
sleep 2
pkill -9 -f "pinchtab " 2>/dev/null || true
```
