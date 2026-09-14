# SkyCourt Warehouse System
# Pre-Production Architectural & Resilience Audit

**Audit date:** 2026-09-13  
**Target:** PyWebView + Flask + React/Vite + Turso/LibSQL cloud deployment  
**Scope:** `app/`, `database/`, `UI/src/`, `tests/`, `UI/tests/`, and deployment/staging tooling
**Status:** Updated after critical-showstopper implementation

## Executive Summary

### Verdict: CONDITIONAL GO for staging qualification; NO-GO for general production rollout

The critical implementation work is now present and verified locally. Production database access fails closed when the LibSQL driver, credentials, or remote connection are unavailable; local SQLite is explicitly test-only. Stock mutations require operation keys, order lifecycle services apply the online mutation gate, movement logs have database-level append-only triggers, staging rehearsal requires a disposable clone, and ambiguous legacy open Leave Orders migrate to `reconciliation` rather than fabricated fulfillment.

The system remains **NO-GO for general production deployment** until real Turso/LibSQL concurrency, network-partition, commit-uncertainty, and workstation/PyWebView qualification tests are executed. The frontend build still emits a 565.12 kB minified chunk warning, and no browser-level component suite is configured.

**Confidence:** High for the locally verified implementation and SQLite test behavior; medium for remote-driver behavior because no live Turso mutation test was executed in this session.

## Implemented Critical Controls

- `app/models/db_utils.py` no longer silently falls back to in-memory SQLite when LibSQL is unavailable. Local SQLite requires `TESTING=True` or `SKYCOURT_ALLOW_LOCAL_SQLITE_TESTS=1`, and stock mutations require a positively authenticated LibSQL wrapper outside tests.
- `app/services/item_service.py` and `app/routes/items_routes.py` require nonblank operation keys for item creation, manual stock adjustments, and the primitive stock mutation path.
- All purchase-order transitions and all Leave Order transitions now invoke the authoritative-online mutation gate.
- `database/schema.sql` and migration 004 define update/delete triggers that reject movement-log tampering.
- `database/migrations/003_digital_two_operator_workflow.sql` preserves ambiguous legacy open orders as `reconciliation` and does not fabricate dispensed quantities.
- `app/staging.py` requires a distinct explicit clone target, rejects production/source identity matches, and applies migrations only to the clone. `app/main.py` requires `--clone-target` for the Flask staging command; the standalone tool does likewise.
- `UI/src/pages/ItemsManagement.tsx` no longer contains the unused `handleBack` function, allowing strict TypeScript compilation.

## Residual Risks and Follow-Up Work

### HIGH

- Business services still do not uniformly use `run_in_transaction`; remote transient conflicts and uncertain commit outcomes need real-driver qualification and a reconciliation strategy before enabling automatic retries.
- PO receipt remains full-receipt-only and cannot represent short delivery/line-out dispositions; this is a domain workflow gap not addressed by the critical-showstopper work order.
- Manual Leave Order close remains unavailable (`app/services/leave_order_service.py:232-233`), so the documented outstanding-return closure workflow is incomplete.
- Some Leave Order transitions still need affected-row checks on every parent update, especially rejection, resubmission, and return.
- API error paths still expose raw exception details in several responses (`app/main.py:148-185`, `252-262`).
- The UI creates fresh operation keys in several modal actions, so uncertain-response retries are not uniformly stable even though create PO/Leave Order flows persist keys.

### MEDIUM/LOW

- UI search is not consistently debounced or cancellable, and the adaptive heartbeat refetches all active queries (`UI/src/hooks/useAdaptiveSyncHeartbeat.ts:52-68`).
- The initial UI bundle is 565.12 kB minified.
- Operational list pages need explicit retry controls and stronger separation of network errors from genuine empty states.
- UI status filters, real-time stock-headroom feedback, quantity integer handling, touch targets, and modal accessibility still have gaps documented in the original audit.
- Production secrets should fail startup when persistence is unavailable rather than falling back to an ephemeral key.

## Verification

| Check | Result |
|---|---|
| `.venv/bin/pytest -q` | **PASS: 144 passed** |
| `npm test` in `UI/` | **PASS: 134 passed** |
| `npx tsc -p tsconfig.app.json --noEmit` in `UI/` | **PASS** |
| `npm run lint` in `UI/` | **PASS** |
| `npm run build` in `UI/` | **PASS with 565.12 kB chunk warning** |
| `python -m compileall -q app tests scripts` | **PASS** |
| Live Turso/LibSQL tests | Not executed |
| Browser/PyWebView E2E | Not executed; no browser runner configured |

## Release Gate

1. Run the full suite in a clean environment with pinned dependencies.
2. Execute two-connection concurrent stock and order-transition tests against the real LibSQL/Turso engine.
3. Verify missing driver, missing credentials, local targets, timeouts, remote 503s, and uncertain commits all fail closed without duplicate work.
4. Run staging rehearsal against a disposable remote-compatible clone and confirm the source database is unchanged.
5. Test direct movement-log update/delete attempts against the production-compatible engine.
6. Resolve the residual PO short-receipt, manual-close, row-count, safe-error-response, and UI retry gaps.

Until these gates pass, the correct production decision remains **NO-GO**.
