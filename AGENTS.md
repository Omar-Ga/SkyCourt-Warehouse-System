# SkyCourt Warehouse System - Agent Instructions

## Operational Invariants

### 1. Database & Persistence Rules
- **Database Instance:** `skycourt-warehouse-v2`
- **Connection URL:** `libsql://skycourt-warehouse-v2-omargamal.aws-eu-west-1.turso.io`
- **Authoritative Writer:** The cloud-hosted LibSQL database is the sole authoritative writer. All schema changes and mutations execute directly against this endpoint.
- **Offline Gating:** Offline synchronization and embedded local replicas are permanently abandoned (ADR 0001, ADR 0002). Offline stock mutations are strictly gated (HTTP 503 `OFFLINE_MUTATION_GATED` or `DATABASE_UNAVAILABLE`).
- **100% Digital Identification:** Barcodes are completely deprecated across the entire system. Items, Purchase Orders, and Leave Orders are identified digitally by numeric IDs and human-readable references (e.g., PO-000042, LO-000042).

### 2. Knowledge Graph (Graphify)
- Scoped to `app`, `UI`, `database`, and `run.py` only. Agent config, docs, memory, and skills are excluded.
- The knowledge graph lives at `graphify-out/` in the project root.
- **Codebase Exploration & Refactoring:** Before modifying shared logic, refactoring APIs, or tracing side effects, inspect `graphify-out/graph.json` via Graphify (`query_graph`, `shortest_path`, `get_node`) or CLI (`graphify query`).
- **AST Auto-Sync:** Post-tool execution hook `.agents/hooks.json` automatically syncs the graph AST via `.agents/scripts/sync-graphify.sh` upon file edits.

## Agent Skills & Workflow

### Issue Tracker
Issues live in GitHub Issues for `Omar-Ga/SkyCourt-Warehouse-System`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage Labels
This repository uses the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain Documentation
Single-context project documentation uses root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`. Always consult `CONTEXT.md` before making domain changes.
