# Planning and implementation

## Plan a cross-file change

Map the requested behavior to current entry points, contracts, and owning modules with a bounded query. Inspect relevant communities only when subsystem boundaries are unclear. Verify the interfaces in source before using this map to sequence work.

A useful plan identifies the files/components likely to change, existing behavior to preserve, dependency order where established, compatibility or migration concerns, and validation that would demonstrate success. Label proposed relationships as proposals. Community membership, centrality, or a shortest path cannot determine implementation order by themselves.

## Implement or refactor

Before changing a shared symbol, use `affected` with relevant relation filters and a small depth to find candidate callers. Check the graph's direction; if it is undirected, verify original direction in retained edge metadata and source, or use source references directly. Do not silently convert undirected connectivity into directed evidence.

Inspect the actual definition, callers, data contracts, and existing tests. Include runtime configuration, route registration, dependency injection, and generated interfaces when applicable; they may be absent from the graph. For a rename or deletion, search the old identifier directly even if impact traversal returned nothing.

After editing, validate the affected behavior with appropriate checks. Graph connectivity is not a test result. Refresh once at a useful boundary if further graph navigation depends on the new state.

## Debug a dependency or behavior

Start from the failing entry point, exception symbol, or observed behavior. Use graph paths to narrow candidate files, then confirm execution using source, logs, reproduction, and tests as appropriate. Do not infer runtime causality from a static path. Follow the project's debugging workflow when applicable.

## Check whether retrieval paid off

Evaluate realistic tasks: a known-file edit should avoid graph overhead; an unfamiliar feature plan should locate relevant contracts; a shared-symbol change should find verified callers; a stale or empty graph result should fall back promptly. Record actual context/tool usage when available, time, relevant files found, and important missed dependencies. Compare with targeted `rg` and source reads on the same task. A benchmark against reading the whole corpus is not evidence of savings over normal development.
