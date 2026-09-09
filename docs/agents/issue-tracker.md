# Issue Tracker

This repository uses GitHub Issues as its issue tracker.

## Repository

- GitHub repository: `Omar-Ga/SkyCourt-Warehouse-System`
- CLI: `gh`
- PRs as a request surface: off by default

## Skills Workflow

Skills that create or update work items should use GitHub Issues through the `gh` CLI.

- Create issues in dependency order when tickets have blocking relationships.
- Use native GitHub blocking relationships when supported.
- Otherwise include a clear `Blocked by` section in the issue body.
- Do not close or modify a parent issue when publishing child tickets unless explicitly requested.

## Ticketing

`to-tickets` publishes one issue per approved ticket, creating blockers first so later issues can reference their identifiers. Each issue should describe user-visible behavior and testable acceptance criteria rather than implementation layers.

## Pull Requests

Pull requests are not treated as an issue-request surface by default. Work should originate from GitHub Issues unless the repository configuration is intentionally changed.
