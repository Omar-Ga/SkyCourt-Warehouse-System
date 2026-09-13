#!/usr/bin/env bash
set -e

PROJECT_DIR="/home/omar/Code Projects/SkyCourt-Warehouse-System"
cd "$PROJECT_DIR"

export TERM=dumb
export PAGER=cat

echo "Resuming OpenCode Pre-Production Audit with GPT-5.6 Sol (Variant: High)..."
echo "Target Session: ses_f64323a98ffeDJgRnlGmk3QR4i"
echo "Work order: ./work_order_preprod_audit.md"
echo "Timestamp: $(date -Iseconds)"

opencode run \
  -s ses_f64323a98ffeDJgRnlGmk3QR4i \
  -m agentrouter/gpt-5.6-sol \
  --variant high \
  --thinking \
  "The internet connection dropped temporarily and has been restored. Please continue your comprehensive pre-production audit of the warehouse codebase and complete AUDIT_REPORT.md per the work order in ./work_order_preprod_audit.md." 2>&1 | tee -a opencode_audit.log

echo ""
echo "=== AUDIT COMPLETED AT $(date -Iseconds) ==="
echo "Audit report and session log are saved in AUDIT_REPORT.md and opencode_audit.log."
echo "Keeping session alive for review. Press Ctrl+C or close this window when done."
sleep 86400
