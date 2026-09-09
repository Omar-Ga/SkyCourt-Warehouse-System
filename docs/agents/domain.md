# Domain Documentation

This is a single-context repository.

## Layout

- `CONTEXT.md` contains the current domain vocabulary, business rules, architectural boundaries, and important invariants for the whole project.
- `docs/adr/` contains Architecture Decision Records for decisions that affect the system's structure or long-term behavior.

## Consumer Rules

Before planning or changing behavior:

1. Read `CONTEXT.md` when it exists.
2. Read ADRs relevant to the area being changed.
3. Treat explicit ADR decisions as constraints unless the user asks to revisit them.
4. Use the project's domain vocabulary in plans, tickets, code, and documentation.
5. If a change contradicts an ADR, identify the conflict and propose a new ADR or superseding decision.
6. Keep `CONTEXT.md` focused on stable shared understanding; do not use it as a task checklist.
7. Record durable architectural decisions in a new ADR rather than only in an issue or implementation note.

## ADR Format

Use a numbered Markdown file under `docs/adr/` with:

- Title
- Status
- Context
- Decision
- Consequences

ADRs should explain why a decision was made and what alternatives were rejected when that context is useful.
