# Core workflow audit — 10 September 2026

## Verdict

**Do not release to the junior operators yet.** The ordinary transactions work, and the visual foundation is usable, but a lost response can create duplicate disbursement requests, order forms cannot select most of a 1,000-item inventory, and several screens misrepresent the actual workflow state. Address those issues before adding features or commissioning a broad redesign.

This is an expert walkthrough for lightly trained users, not an observed user study. No actual operator has accepted this version. Application code was not changed.

## Environment and method

- Audited the existing, uncommitted working tree, including its ongoing UI changes. Commit identifier is recorded in [database evidence](core-workflow-audit-2026-09-10/database-evidence.json); that commit alone does not reproduce the dirty checkout.
- Production Vite frontend build, served by the Flask development server on port 5081; local SQLite with migrations 1–3. Browser reports Chrome 152 on Linux; primary viewport 1366 × 768. This is not the packaged Windows/PyWebView runtime.
- Synthetic inventory: 1,000 active items, one supplier, destination, unit, parent category and subcategory; one zero-stock item. Opening balances were seeded directly and intentionally have no opening movement logs. Order history was small and created during the audit, so large historical-order/report volumes remain untested.
- Office used `127.0.0.1:5081`; Warehouse used `localhost:5081`, isolating their cookies. Both origins were explicitly allowed; authentication, role checks, origin checks, and CSRF remained enabled.
- The harness explicitly selects `/tmp/skycourt-audit/audit.db`, overrides remote credentials with inert values, and asserts the SQLite database filename before serving. No application startup or production seeding commands were used. All browser transactions targeted that isolated server.
- Playwright MCP exercised visible controls before source inspection of the relevant flow. Keyboard activation was used extensively after normal actionability waits stalled on early clicks; those stalls are not counted as product latency or proven click defects. One controlled double-click check used a visible button with actionability checks bypassed.
- Network interruption tests used Playwright routing: abort before dispatch, or forward to the local server and discard its successful response. The latter reproduces an uncertain transaction outcome; it is not a real cloud outage test.
- Evidence includes [screenshots and harness](core-workflow-audit-2026-09-10/), [database snapshot](core-workflow-audit-2026-09-10/database-evidence.json), and [backend test output](core-workflow-audit-2026-09-10/pytest.txt). The harness is specific to this checkout and disposable audit database; rerunning it against the same file retains existing transactions and reprovisions test users.

## Workflow coverage

“Transaction passed” means the observed operation and its records were correct. It does not override the usability failures in the same row.

| Scenario | Result | Evidence / qualification |
|---|---|---|
| Office login and role navigation | Passed, limited | Office and Warehouse received different navigation and independent authenticated sessions. No full role-security audit. |
| Find an older inventory item for an order | **Failed** | Both creation selectors expose 100 items; items 1–900 cannot be selected. Dashboard search can find the deliberately named older items. F02. |
| Create PO draft → dispatch → Warehouse receipt | Transaction passed; UX failed | PO-000001: draft, open, closed; item 1000 changed 100 → 110; one linked +10 movement, actor Warehouse. F03/F06 affect clarity. |
| Create disbursement → Warehouse fulfillment | Transaction passed; UX failed | LO-000001 reserved 6, then deducted 6; Office showed closed and 6 outstanding. Direct commit from summary row; misleading quantity labels. F04/F06. |
| Reject → Office reads reason → resubmit → fulfill | Transaction passed; UX failed | LO-000002 rejected with mandatory reason, resubmitted, fulfilled. Rejection text visible; status blank and headline quantity wrong; no correction editor. F04/F09. |
| Partial return → remaining full return | Passed, with validation caveat | LO-000002 returned 2, then remaining 2; partial state and history updated; final remaining 0. F07 covers excessive input. |
| Over-limit return input | **Failed UX; stock bound held** | Entering 5 when maximum was 4 immediately changed the field to 4. Earlier entering 7 against 6 then submitting recorded 6. F07. |
| Empty PO submission | Passed validation, limited localization | Browser blocked required supplier/item/quantity/price fields. Native browser validation was English in this browser locale. |
| Excess stock request | Passed validation | 111 requested against 110 did not create an order; correcting to 6 succeeded. Source also confirms available-stock validation. |
| Blank rejection reason | Passed | Confirm rejection disabled until a reason was supplied. |
| Request lost before server receives it → retry | Passed recovery, poor message | Form retained entered data; retry created one request. Error was `Failed to fetch`. F08. |
| Successful create response lost → unchanged retry | **Failed, release blocker** | LO-000004 and LO-000005 created for one intended 3-unit request; fresh operation key on retry. F01. |
| Successful return response lost → unchanged retry | Passed | LO-000004 return reused the same key; exactly one return event of 1, with 2 remaining. |
| Rapid double-click on create | Passed in controlled test | With response delayed 300 ms, one POST and one row for `اختبار نقر مزدوج ثان`. An earlier harness attempt failed; excluded from this result. |
| Cross-operator list freshness | Passed eventually; noticeable delay | Three samples took 8.3–14.9 seconds after Warehouse was foregrounded. F05. |
| Detail window stays open while other operator fulfills | **Failed** | LO-000003 list changed to closed; open detail still showed open/zero dispensed and lacked return action after 16 seconds. F05. |
| Cancel/Escape and reopen a new request | **Failed clarity** | Previously typed recipient reappeared even after explicit Cancel. F10. |
| Keyboard modal navigation | **Failed** | Opening focus stayed on background trigger; Tab after last submit control left dialog. F10. |
| Stock and audit reconciliation | Passed for exercised transactions | Final item 1000: 100 opening +10 receipt −14 issues +11 returns = 107; reservations 3. No negative stock, FK violations or unfinished operations; integrity check `ok`. |
| Multi-line atomic rollback / competing stock deduction | Automated coverage only | Existing transaction/idempotency tests passed. Browser multi-line failure and competing-last-unit scenarios not completed; no browser acceptance claim. |
| Expired/revoked session while editing | Not completed in browser | A harness restart reprovisioned Office and it returned to login on 401, but that is not a controlled expiry/unsaved-work test. Existing auth tests passed. |
| Print purchase order | **Blocked / unverified** | Print action stalled Playwright. Subsequent Escape/tab commands also stopped responding. Cannot distinguish native print-preview blocking from an app issue; no physical or PDF print acceptance. |
| Real cloud outage, latency, packaged desktop, actual users | **Blocked / unverified** | No dedicated staging cloud endpoint, packaged workstation test, or available operators. |

## Prioritized findings

### F01 — P1 / release blocker: retry can duplicate a disbursement request

**Reproduce:** Fill a valid request for 3 units. Forward its POST to the server but abort delivery of the successful response. The form shows `Failed to fetch`; press Submit again without changing anything.

**Observed:** First response was 201 for LO-000004. First key `ee580d2e-f311-4cd4-9bb7-f08994b3471f`; retry key `6e697aec-3604-4543-af45-51cc395514b5`. The database and list then contained LO-000004 and LO-000005 for the same recipient/item/quantity. The two requests reserved 6 units rather than the intended 3. [Screenshot](core-workflow-audit-2026-09-10/duplicate-orders.png).

**Impact:** A normal recovery action duplicates warehouse work and reservations. Server idempotency does not help when the client generates a fresh key.

**Source:** `UI/src/services/leaveOrderService.ts:91` generates `crypto.randomUUID()` inside every create call; the creation form does not retain a submission key.

**Correction:** Retain one key and immutable payload for an unresolved submission, including retries. Explain uncertain outcomes in Arabic and resolve the previous attempt before allowing an edited submission. Reuse the same pattern across mutations after checking each caller; do not blindly assume all retries have this defect. The return form already passed the unchanged-retry test.

### F02 — P1 / release blocker above 100 items: order item selectors truncate the inventory

**Reproduce:** With 1,000 active items, open either creation form and try to select `لمبة اختبار رئيسية` (item 1). It exists and dashboard search finds it, but the order selector cannot.

**Observed:** Both selectors contained one placeholder plus 100 options, IDs 1000 through 901, with no search or next-page control.

**Source:** `UI/src/components/CreatePOModal.tsx:31` and `UI/src/components/CreateLeaveOrderModal.tsx:34` request only `page_size: 100`. The latter explicitly documents this limitation.

**Impact:** Core work is impossible for 90% of this fixture inventory. Even the available 100-item native dropdown is laborious for junior users.

**Correction:** Use searchable, paginated item selection for every line, showing unit and available stock where relevant. Verify selection beyond the first page and retained selections across queries. Do not merely increase the fixed limit.

### F03 — P1 / release blocker for trustworthy operation: dashboard invents follow-up work

**Reproduce:** Open Office dashboard with no orders or movements. Later complete the only PO and revisit it.

**Observed:** Empty database showed named employee activity and PO-2024-0159, PO-2024-0147, and ISS-2024-0068. After real activity existed, real movement rows replaced sample activity, but fabricated follow-up orders remained when corresponding live data was absent. A new draft PO was called open and awaiting management approval. [Dashboard screenshot](core-workflow-audit-2026-09-10/office-dashboard.png).

**Source:** `UI/src/pages/office/OfficeDashboard.tsx`, including fallback sections around lines 354–400 and 490 onward.

**Impact:** Users cannot trust what requires action or whether a transaction happened. The approval wording also implies a stage outside the current digital workflow.

**Correction:** Remove sample operational data from production rendering. Show explicit empty states and use actual status/actionability rules. Keep demonstration content confined to explicitly identified demo fixtures.

### F04 — P2 / major: requested quantities are labeled as already dispensed

**Reproduce:** Create a 4-unit request, then reject it and view Office details.

**Observed:** List `إجمالي المنصرف` and detail `الكمية المصروفة` both show 4, while the item row correctly shows 0. Rejected status is blank in detail despite appearing in the list. [Screenshot](core-workflow-audit-2026-09-10/rejected.png).

**Source:** `UI/src/pages/LeaveOrders.tsx:169` and `UI/src/components/LeaveOrderDetailModal.tsx:139` display `total_quantity` as dispensed. Detail status rendering does not cover all current states.

**Correction:** Distinguish requested, reserved, dispensed, returned and outstanding quantities. Use the existing actual-dispensed aggregate and label every current lifecycle state. Check open, rejected, canceled, fulfilled, partial-return and full-return examples.

### F05 — P2 / major: detail windows contradict refreshed lists

**Reproduce:** Keep Office details for an open request visible. Fulfill it in Warehouse. Return to Office and wait through a list polling cycle.

**Observed:** After 16 seconds the list showed closed, but LO-000003 details still showed open and no return action. [Screenshot](core-workflow-audit-2026-09-10/stale-detail.png). Separate creation-to-Warehouse visibility samples were 8.3, 14.9 and 14.9 seconds.

**Source:** List queries poll every 15 seconds; detail queries have stale time but no corresponding interval in `UI/src/hooks/useLeaveOrders.ts`.

**Correction:** Keep visible details consistent with updates to their list entity, with revision-aware refresh that preserves unsaved edits. Give operators a clear “last updated” or refresh affordance. Decide the acceptable cross-workstation delay with operators before adding a new transport; a wholesale real-time rewrite is not established as necessary.

### F06 — P2 / major: stock commitment does not support physical verification

**Reproduce:** In Warehouse, activate `صرف وإغلاق` from a ticket row. Separately open PO receipt confirmation.

**Observed:** Disbursement commits immediately from a row containing recipient and totals, without showing item names. A separate View action exists but is optional. PO confirmation shows supplier/count/total/revision, not line names or quantities, and calls the operation “ذرية”.

**Source:** `UI/src/pages/DisbursementTickets.tsx:19`, `UI/src/components/POReceiptModal.tsx:16`.

**Impact:** A junior operator can record physical stock movement without checking which items are involved. Technical wording adds effort without helping their decision.

**Correction:** Put item names, units and per-line quantities into the final physical-verification step. Use an explicit business action such as confirming actual receipt/hand-over. Remove revision and transaction terminology from normal user instructions.

### F07 — P2 / major: return input silently changes the user's quantity

**Reproduce:** On a return with 4 outstanding, enter 5. The field immediately becomes 4 without an explanation. On an earlier 6-outstanding return, entering 7 then confirming recorded 6.

**Source:** `UI/src/components/ReturnModal.tsx:41` clamps values; it also uses integer parsing.

**Impact:** The recorded amount can differ from the operator's intended input without a validation decision. The stock limit held, but clarity failed.

**Correction:** Keep the entered value visible, explain the allowed maximum, and block submission until corrected. Reject fractional quantities consistently for this integer-only inventory. Preserve the successful “return all remaining” shortcut.

### F08 — P2 / major: error and recovery language is too technical

**Reproduce:** Abort a valid request using the network fault scenario. Inspect a normally fulfilled request.

**Observed:** Network error is `Failed to fetch`; fulfilled closure reason is `Fulfilled by warehouse`. Form data survives the network error, which is good, but there is no explanation of whether the operation was saved or how to retry safely. [Network screenshot](core-workflow-audit-2026-09-10/network-error.png), [fulfilled detail](core-workflow-audit-2026-09-10/returns.png).

**Correction:** Provide Arabic, actionable messages distinguishing validation, definite rejection, and uncertain submission outcomes. Translate system-generated closure reasons. Keep technical codes in diagnostics.

### F09 — P2 / missing recovery capability: rejected request cannot be corrected in place

**Reproduce:** Reject an incorrect item with reason “الصنف المطلوب تالف، يرجى اختيار بديل”; view it in Office.

**Observed:** Reason is visible and resend works, but only resend/cancel/close actions are offered. There is no way to choose the requested alternative here; resend submits the same lines. The endpoint supports resubmission input, but the UI sends revision and notes only.

**Impact:** The displayed recovery choices do not solve the concrete rejection reason. Canceling and reentering a new request is possible but duplicates typing and loses the obvious correction chain.

**Correction:** Offer an explicit correction-and-resend flow, or a clearly linked replacement request. Preserve the original rejection history. Also assess PO draft editing: the observed draft detail offers send/cancel/print but no edit, although current domain docs say drafts are editable. Do not mark every possible procurement enhancement as required.

### F10 — P2 / major: modal keyboard behavior and cancellation are inconsistent

**Reproduce:** Open a new request with keyboard, type a recipient, cancel, then open “new” again. Tab past its final control.

**Observed:** Old recipient reappears after Cancel or Escape, without a draft/resume explanation. Initial focus remains on the background trigger, and Tab leaves the dialog. Shared Modal has Escape/backdrop dismissal but no focus trap or focus restoration.

**Impact:** Users may reuse details from an abandoned request inadvertently. Keyboard users can navigate behind the overlay.

**Correction:** Define Cancel versus saved draft/resume behavior explicitly. Move focus into the dialog, contain it, restore it on close, associate labels with controls, and give nested modals distinct titles. Verify pending-submission dismissal separately; not tested here.

### F11 — P2 / major: transaction times are shown without Cairo conversion

**Reproduce:** Create a PO/request and compare its time to the server's Cairo-local log.

**Observed:** PO created at approximately 15:46 Cairo displayed `12:46:02`; request details similarly displayed UTC wall time without timezone context. This audit ran on a machine configured for Africa/Cairo. PO detail renders the raw timestamp string. Arabic dates are not proof of timezone conversion.

**Correction:** Parse server UTC timestamps explicitly and display Africa/Cairo consistently, including lists, details, movement history and printed documents. Test dates near midnight and daylight-saving transitions.

### F12 — P3 / polish: attractive layout, but weak secondary text and inconsistent emphasis

**Observed visually:** At 1366 × 768 the purple brand, right sidebar, grouped forms and tabular return history provide a coherent foundation. Some captions/placeholders are very pale and small; the dashboard search box is cramped while decorative metric cards use substantial space. “Close window” is styled as a primary purple action alongside the actual workflow actions. A long return detail requires internal scrolling. These are visual observations, not a measured contrast-compliance audit.

**Correction:** Prioritize readable text, a wider inventory search, fewer competing primary actions, and consistent Arabic dates/numerals/currency. Test actual workstation scaling before redesigning the whole application. Additional viewport and 200% zoom checks remain outstanding because browser control stalled at printing.

## Performance measurements

All timings were measured inside the Playwright action code using elapsed wall time or browser navigation entries; MCP tool round-trip time was excluded. No artificial CPU/network throttling was applied except in explicitly named fault/double-click scenarios. Three samples are exploratory measurements, not production percentiles.

| Operation | Samples (ms) | Interpretation |
|---|---|---|
| Authenticated reload → Office action button visible | 86, 76, 66 | Warm reload/shell readiness; not cold executable startup or all dashboard data loaded. |
| DOMContentLoaded on those reloads | 26.6, 28.6, 17.3 | Local build/server only. |
| Dashboard search → matching option visible | 803, 791, 790 | Three distinct older items from a 1,000-item inventory; search works beyond page one. |
| Valid disbursement submit → Office row visible | 41, 36, 48 | Fast local writes with small order history. |
| Foreground Warehouse after creation → matching row visible | 8,332, 14,882, 14,871 | Polling dominates perceived hand-off delay. Background polling is disabled; this is not simultaneous physical-workstation timing. |

Build passed in 1.70 seconds. Main JavaScript bundle was 523.96 kB uncompressed / 151.83 kB gzip, with a Vite chunk-size warning. The warning alone does not establish a user-facing performance problem. Cold startup, cloud latency, large order histories, printer behavior and low-spec workstation responsiveness remain unqualified.

## Existing automated checks and documentation drift

- Frontend `npm test`: **4 test files passed**. These are not end-to-end usability tests.
- Backend `pytest tests --ignore=tests/test_pinchtab_automated_suite.py -q`: **132 passed, 1 failed, 1 skipped**, 6.68 seconds. The ignored suite depends on PinchTab and was not invoked.
- Failure: `test_sync_status_preserves_last_error_even_when_connected` calls sync status outside the app request context, attempts the configured remote connection and gets sandbox DNS failure. This test did not use the browser harness's local database. It is an isolation/environment failure requiring correction or explicit qualification, not proof that a user transaction failed. The network attempt failed; no remote test writes occurred.
- Automated transaction tests cover rollback and conditional concurrency. Their pass does not establish every browser workflow, physical process, or packaged environment.
- The current `CONTEXT.md` and migration 003 describe digital Office-created requests, Warehouse fulfillment, PO drafts, 30-day dispatched expiry, and full receipt. Those are consistent with the paths observed here.
- `docs/specs/two-operator-overhaul-spec.md` retains older barcode, role, partial-receipt and 48-hour assumptions. `docs/operations/two-workstation-cutover-and-release-qualification.md` claims all gates and operator sign-offs passed while describing schema version 2 and superseded flows. Treat these as historical claims, not acceptance for this checkout. Replace them with current, evidenced acceptance records before release.
- Incidental configuration observation: `app/config.py` contains a literal cloud auth token. Its value is intentionally not reproduced here. Review credential distribution and rotate any exposed credential before release; this audit did not assess exploitability or change credentials.

## Smallest recommended fix batch and retest order

1. **Prevent duplicate creates and restore inventory reachability:** F01 and F02. Add browser regressions for dropped successful responses, unchanged retries, edited payload recovery, rapid submits, and choosing an item outside page one.
2. **Make the app tell the truth:** F03–F05 and F11. Remove sample work, correct quantity/status semantics and timestamps, refresh visible details. Rerun the complete Office → Warehouse → Office lifecycle with both sessions open.
3. **Make physical actions and recovery understandable:** F06–F10. Review exact item lines before commit, explain invalid quantities and failures, support correction of rejected requests, and make cancellation/keyboard behavior predictable.
4. **Finish release qualification:** Resume print-preview/PDF and actual printer checks, controlled session expiry during an unfinished form, multi-line browser failures, small-screen/zoom checks, staging cloud outage/recovery and representative workstation timing. Then observe each real operator doing purchase/receipt and disbursement/rejection/return without coaching.

For the observed user trial, record unaided task completion, assistance, hesitation and recovery errors. Do not substitute this audit's findings or a passing automated suite for operator acceptance. No additional broad feature set or visual redesign is justified by the evidence yet.
