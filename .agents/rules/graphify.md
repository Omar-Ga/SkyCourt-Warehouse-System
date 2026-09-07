---
trigger: always_on
description: Consult the graphify knowledge graph at graphify-out/ for codebase exploration, refactoring, impact analysis, and architecture questions.
---

## graphify

This project has a graphify knowledge graph scoped to **app UI database run.py** only.
Agent config, docs, memory, and skills are intentionally excluded from the graph.

The graph always lives at `graphify-out/` in the **project root** when built correctly via the `/graphify` skill workflow.

Rules:
- **Codebase Exploration & Refactoring Impact**: Before modifying shared logic, refactoring APIs, tracing side effects, or implementing new features, when `graphify-out/graph.json` exists, use Graphify (`query_graph`, `shortest_path`, `get_node`) to map caller chains, dependencies, and side effects before editing code.
- **Architecture & Code Questions**: When `graphify-out/graph.json` exists, first run `graphify query "<question>"` (CLI) or `query_graph` (MCP). Use `graphify path "<A>" "<B>"` / `shortest_path` for relationships and `graphify explain "<concept>"` / `get_node` for focused concepts. These return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output.
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context
- After modifying code files in this session, run `graphify update` from the project root to keep the graph current (AST-only, no API cost)
- **Build rule:** Always build via the `/graphify <your_dirs>` skill workflow — never via raw `graphify <dirs>` CLI. The skill outputs to the project root `graphify-out/`. The raw CLI outputs to a subdirectory, which breaks querying from the project root.
