#!/usr/bin/env bash
set -e

PROJECT_DIR="/home/omar/Code Projects/SkyCourt-Warehouse-System"
cd "$PROJECT_DIR"

export TERM=dumb
export PAGER=cat
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

echo "Dispatching OpenCode Turn 2 (Execution) with GPT-5.6 Sol (Variant: High)..."
echo "Target Session: ses_f64323a98ffeDJgRnlGmk3QR4i"
echo "Work Order: ./work_order_execution.md"
echo "Timestamp: $(date -Iseconds)"

opencode run \
  -s ses_f64323a98ffeDJgRnlGmk3QR4i \
  -m agentrouter/gpt-5.6-sol \
  --variant high \
  --thinking \
  --auto \
  "Read and execute all instructions in ./work_order_execution.md" 2>&1 | tee opencode_execution.log

echo ""
echo "=== EXECUTION COMPLETED AT $(date -Iseconds) ==="
echo "Execution summary saved in IMPLEMENTATION_SUMMARY.md and opencode_execution.log."
echo "Keeping session alive for review. Press Ctrl+C or close this window when done."
sleep 86400
