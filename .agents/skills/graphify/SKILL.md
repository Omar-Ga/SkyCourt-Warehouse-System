---
name: graphify
description: Use an existing Graphify knowledge graph to navigate code and documents, plan cross-file features, assess change impact, debug dependencies, and guide refactoring or implementation. Also build, update, query, and export graphs when requested. Prefer direct source reads for simple localized edits or when graph retrieval adds no value.
---

# Graphify for development

Use the graph to find the smallest useful set of source files and relationships for the user's task. Verify consequential findings in current source and tests before planning or editing. Continue through implementation and validation when requested; graph exploration is a supporting step.

## Choose the appropriate route

- **Coding, planning, debugging, or refactoring:** follow the workflow below; read [development.md](references/development.md) for impact and planning details.
- **Questions, query, path, explain, or affected:** read [query.md](references/query.md).
- **Explicit build or justified first-time indexing:** read [build.md](references/build.md). Use the current directory unless a path was supplied. A missing graph does not require a build for ordinary coding.
- **Refresh or cluster-only:** read [update.md](references/update.md).
- **Other explicit operations:** read only the relevant reference: [GitHub and merge](references/github-and-merge.md), [exports](references/exports.md), [add and watch](references/add-watch.md), or [hooks](references/hooks.md). Transcription and semantic extraction are linked from the build guide.
- **Help only:** show the relevant supported usage and stop; do not build or mutate the graph.

## Development workflow

1. **Choose the cheapest useful entry.** For a known file and a local change, read it directly. For unfamiliar or cross-file work, look for `graphify-out/graph.json` at the project root or the explicit graph path. Reuse it without loading the whole graph or report into conversation.
2. **Establish trust.** Confirm the graph belongs to this checkout. Check freshness for the relevant scope using its manifest and current files; a clean Git status or graph timestamp alone does not prove freshness. Include new, deleted, and untracked files. Use [update.md](references/update.md) when this affects retrieval. Unknown freshness means the graph is a navigation hint.
3. **Retrieve a bounded slice.** Start with exact symbols or domain terms from the request/source and `graphify query "terms" --budget 1500`. Use `path` for a connection and `affected` for impact where direction is trustworthy. Expand vocabulary only after weak results. See [query.md](references/query.md).
4. **Verify and act.** Read the implicated source sections, callers, contracts, and relevant tests. Distinguish graph observations, source-confirmed facts, and proposed changes. Implement or plan according to the user's scope.
5. **Close the loop.** Run checks appropriate to the change. Refresh the index when needed for subsequent work; avoid rebuilding after every edit. Save only durable, verified discoveries or corrections when they will improve future navigation.

## Accuracy and context discipline

- Source code, current configuration, and tests establish current behavior. EXTRACTED edges are structural evidence; INFERRED and AMBIGUOUS edges are leads. Missing edges or no matching nodes do not prove absence of behavior.
- Check graph direction and relation semantics before asserting callers, callees, dependency order, or blast radius. An undirected path establishes connectivity only unless original direction is verified separately.
- Graphs may miss dynamic dispatch, framework wiring, generated code, unsupported languages, and files excluded from indexing. Search source when these matter.
- Do not read the full vocabulary, graph JSON, reports, or every reference by default. Prefer bounded output, targeted source ranges, and reuse of already retrieved context.
- If a targeted query and one refined query do not locate useful evidence, switch to `rg` and direct reads. Broaden retrieval only to resolve a concrete remaining uncertainty.
- Never describe an output token cap or zero-cost AST extraction as the total task cost. Measure savings against ordinary targeted search, including skill context, tool output, source verification, and index maintenance.
- Use installed CLI capabilities; check `graphify --help` once if uncertain. Do not assume slash-command flags are CLI subcommands. Do not install hooks, watchers, integrations, or upgrades as a side effect of navigation.
