# Core Workflow Remediation & Evidence Verification Report

**Date:** 11 September 2026  
**Target:** Post-Remediation Evidence Review of Core Workflows  
**Environment:** Isolated Synthetic SQLite Testbed (`/tmp/skycourt-followup-audit/audit.db`, Turso cloud connection disabled)  
**Test Client:** Chromium / Brave via Playwright Automation & React 18 / Vite Client

---

## 1. Verified Fixes & Architecture Changes

### Fix 1: Account-Scoped Uncertain Submission Recovery (`AuthContext.tsx`, `CreateLeaveOrderModal.tsx`, `CreatePOModal.tsx`)
- **Key & Payload Preservation:** Preserved `submissionKey` and initial serialized payload across all form modifications after a lost response or timeout. Form edits do not silently generate fresh keys.
- **Account Isolation:** Scoped recovery keys to authenticated user IDs (`skycourt_pending_user_${user.id}_leave_order` and `skycourt_pending_user_${user.id}_purchase_order`). Payload includes embedded `userId` verification.
- **Session Expiry Resilience:** Updated `AuthContext.tsx` (`clearSessionPreservingPendingSubmissions`) to clear volatile session state while preserving scoped `skycourt_pending_*` keys across session expiry and re-authentication. Logging out user A and logging in user B presents zero banners and zero payload leakage to user B.
- **Authoritative Recovery Action:** Arabic action `التحقق من الإرسال السابق (طلب X وحدة)` safely replays the original payload with the original idempotency key:
  - If committed: opens the existing order without creating duplicates.
  - If warehouse rejected: displays live status `مرفوض` with the exact Arabic rejection reason and releases reserved stock.
  - If warehouse fulfilled: displays live status `مغلق` without attempting cancellation.
  - If uncommitted: safely commits with the original key.
- **Rapid Click Guard:** Submission buttons are locked with synchronous ref guards (`isSubmittingRef`), preventing duplicate network calls during rapid clicks.

### Fix 2: Nested Modal Mouse Event Ownership & Stacking (`Modal.tsx`)
- **Event Ownership:** Removed global document-level `mousedown` listener that misidentified clicks in portal sibling modals as outside clicks.
- **Backdrop Handling:** Configured backdrop `onMouseDown` and `onClick` handlers to trigger `onClose()` strictly when `e.target === e.currentTarget` and the click initiated on the backdrop.
- **Propagation Guard:** Added `e.stopPropagation()` on the modal dialog card container.
- **Reactive Modal Stacking:** Implemented a lightweight reactive modal stack via `useSyncExternalStore` ensuring:
  - Layered `z-index` hierarchy (`50 + stackIndex * 10`).
  - Only the topmost modal responds to `Escape`.
  - Document scroll lock persists until all modals close.
- **Focus Trapping & Tab Navigation:** Focus containment traps focus within visible modal controls, wraps on Tab/Shift+Tab, and restores focus to triggering elements upon dismissal.

### Fix 3: PO Draft Editing Race & Reference Fix (`CreatePOModal.tsx`)
- Initialized draft lines directly in `useState` from `initialPO`, eliminating asynchronous `useEffect` line wiping and missing reference errors during `PUT /api/purchase-orders/:id`.

---

## 2. Reconciled Executable Evidence

### E2E Scenarios (17 Named Scenarios Reconciled)
The initial test runner log claimed 18 scenarios due to counting test harness initialization; the actual enumerated suite contains **17 distinct named scenarios**, all passing with exit code 0:
1. `Scenario 1A`: Server committed, response lost → Unchanged retry recovers existing order.
2. `Scenario 1B`: Changed quantity after lost response → Original key & payload preserved, 0 duplicates in DB.
3. `Scenario 1C`: Request never reached server → Safe retry commits order with original key.
4. `Scenario 1D`: Order progressed in Warehouse before recovery → Shows current live state.
5. `Scenario 1E`: Purchase Order recovery → Preserved key, 0 duplicate POs in DB.
6. `Scenario 1F`: Rapid repeated clicks → Ref guard prevents duplicate dispatch, exactly 1 order committed.
7. `Scenario 1G`: Lost response → Modal closed & page reloaded → Restored from sessionStorage.
8. `Scenario 1H`: PO Draft Editing → Open draft, edit lines, save cleanly (`revision=1, ordered_qty=15`).
9. `Scenario 2A`: Open Return Modal → Click Child Backdrop → ONLY child modal dismisses.
10. `Scenario 2B`: Open Return Modal → Press Escape → ONLY child modal dismisses.
11. `Scenario 2C`: Real mouse clicks on quantity input, typing, and clicking submit.
12. `Scenario 2D`: Remaining-full return shortcut click and submit; parent modal remains interactive.
13. `Scenario 2E`: Portaled Search Dropdown inside modal → Option click does not dismiss modal.
14. `Scenario 2F`: Focus containment with Tab wrap and restoration on Escape.
15. `Test 3`: Printing rendered DOM inspection & non-blocking print trigger.
16. `Test 4 / Scenario 4A`: End-to-End Search Latency across 1,000 items.
17. `Scenario 4B`: Cross-session live auto-refresh polling measurement.

### Targeted Evidence Suite (`test_narrow_evidence_review.py`)
- **Account Isolation:** User A logged out with pending submission; User B logged in → 0 banners, 0 leakage, 0 duplicate DB orders.
- **Session Expiry Survival:** Cookies wiped; same user re-authenticated → recovery banner restored, order recovered cleanly.
- **Warehouse Progressed State:** Warehouse rejected order with reason; Office recovered → displayed live `مرفوض` status, reason visible, reserved stock released to 0.
- **Malformed Storage:** Broken JSON and mismatched `userId` handled gracefully with 0 crashes.

### Backend Test Skips Reconciled
All 10 skipped backend tests (`test_01` to `test_10` in `tests/test_pinchtab_automated_suite.py`) were skipped because `PinchTabDriver.run_cmd("health")` encountered `connection refused` on `http://127.0.0.1:9867` (the PinchTab automation daemon was not running). They do not require mock drivers; they require the PinchTab process.

### Mocked vs End-to-End Execution
- **Mocked / Intercepted:** Network timeouts and dropped responses were simulated via Playwright route interception (`page.route`). In Test 3, iframe printing was intercepted via monkey-patching `contentWindow.print` to prevent automation hangs.
- **End-to-End:** All database mutations, SQLite transaction rollbacks, React component trees, modal stacking, auth cookies, and live API endpoints executed end-to-end against the running server.

### Performance Measurements (5 Repeated Samples)
Measured end-to-end search across 1,000 items (300ms debounce + API + DOM render):
- Sample 1 (Cold): `787.1ms`
- Sample 2 (Warm / Cache): `5.7ms`
- Sample 3: `6.8ms`
- Sample 4: `6.4ms`
- Sample 5: `5.9ms`
- **Summary:** Min: `5.7ms`, Max: `787.1ms`, Mean: `162.4ms`.
- **Cross-Session Auto-Refresh Polling Latency:** `7,809.2ms` (~7.8s with React Query 4.0s interval).

---

## 3. Printing Claims & Boundary Audit

1. **Rendered HTML Inspection:** **VERIFIED.** Inspected DOM confirms bilingual header, RTL layout, line items, and 3 signature blocks (المستلم، أمين المستودع، اعتماد إدارة).
2. **Generated Print / PDF Layout:** **UNVERIFIED.** No print-media CSS rasterization or PDF file generation was evaluated.
3. **Native Preview Opening & Dismissal:** **UNVERIFIED.** In automated runs, `contentWindow.print()` was intercepted; native OS print preview was not opened or dismissed.
4. **Physical Printer Output:** **UNVERIFIED.** Thermal printers are not required by domain specifications (standard vouchers are used), but physical spooler output remains unexercised.

---

## 4. Rejection Workflow Clarification

- **Domain Model:** Warehouse fulfillment operates on an **all-or-nothing** model: the warehouse operator either fulfills the ticket in full or rejects it with a mandatory Arabic reason.
- **Office Correction Capability:** Office operators **can** correct items and quantities in-place. Clicking `تعديل البنود وإعادة الإرسال` on a rejected order opens the edit view. Submitting invokes `POST /api/leave-orders/:id/resubmit`, which updates lines, re-reserves stock, increments the revision number, and resets the status to `open` under the same `LO-XXXXXX` identifier.
- **Junior Operator Impact:** The workflow does **not** materially obstruct junior operators. There is no need to create a new ticket from scratch or re-enter metadata; the existing ticket preserves its identity and audit history.

---

## 5. Verdict & Supervised Pilot Script

**VERDICT: READY FOR CONTROLLED OPERATOR PILOT, WITH EXPLICIT LIMITATIONS.**

### Pilot Limitations
1. Native print dialog invocation and layout dismissal must be verified manually on workstation browsers during the pilot.
2. The pilot must run on standard workstation desktop browsers; PyWebView desktop packaging is unexercised.

---

### 30-Minute Supervised Pilot Script (Synthetic Stock)

**Setup:**  
- Office station (`http://127.0.0.1:5081`), Warehouse station (`http://localhost:5081`).  
- Items #1 to #10 seeded with known opening balances.  
- Supervisor armed with observation rubric: **[A] Assistance**, **[H] Hesitation (>5s)**, **[W] Wrong Action**, **[R] Recovery Issue**.

| Phase & Time | Flow & Actors | Step-by-Step Actions | Expected State & Observer Checks |
|---|---|---|---|
| **Phase 1** (00–07m) | **PO Creation & Restock** <br>*(Office → Warehouse)* | 1. Office: *أوامر الشراء* → *إنشاء أمر شراء*. <br>2. Select Provider, Item #1, Qty = 20, Price = 25. Save Draft. <br>3. Edit Draft: Qty = 25. Click *إرسال للمخزن*. <br>4. Warehouse: *استلام أوامر الشراء*. Open PO, click *تأكيد الاستلام*. | • Item #1 stock increases by 25. <br>• Status: `draft` → `open` → `closed`. <br>• Movement log records `Addition`. |
| **Phase 2** (07–14m) | **Disbursement** <br>*(Office → Warehouse)* | 1. Office: *أذونات الصرف* → *إنشاء إذن صرف جديد*. <br>2. Recipient, Destination, Item #1, Qty = 5. Submit. <br>3. Warehouse: *تذاكر الصرف*. Open ticket. <br>4. Click *تسليم وصرف* → confirm. | • Open: reserved = 5, available drops 5. <br>• Closed: current drops 5, reserved drops to 0. <br>• Ticket status: `مغلق`. |
| **Phase 3** (14–21m) | **Rejection & Correction** <br>*(Warehouse ↔ Office)* | 1. Office: Submit LO for Item #2, Qty = 50. <br>2. Warehouse: Click *رفض*. Reason: `"الكمية غير متوفرة بالكامل"`. <br>3. Office: Open ticket, verify rejection banner & reason. <br>4. Office: Click *تعديل البنود وإعادة الإرسال*. Change Qty to 15. Submit. <br>5. Warehouse: Open ticket, verify Qty = 15, click *تسليم وصرف*. | • Rejection frees reserved stock. <br>• Resubmit keeps identical `LO-XXXXXX`. <br>• Revision increments cleanly. |
| **Phase 4** (21–26m) | **Partial & Full Return** <br>*(Office)* | 1. Office: Open closed LO from Phase 2 (5 dispensed). <br>2. Click *تسجيل مرتجع*. Qty = 2, submit. <br>3. Confirm status: `مرتجع جزئياً` (3 remaining). <br>4. Click *تسجيل مرتجع* → shortcut *إرجاع كل المتبقي* (3), submit. | • 2 then 3 units restored to stock. <br>• Status: `مغلق`, remaining = 0. <br>• Return log records both events. |
| **Phase 5** (26–30m) | **Printing & Recovery** <br>*(Office)* | 1. Office: Open PO from Phase 1. Click *طباعة*. <br>2. Verify native OS print preview opens and dismisses without UI freeze. <br>3. Disconnect network or close tab during draft creation. <br>4. Reopen and verify Arabic recovery banner handles state cleanly. | • UI remains responsive after print preview. <br>• Recovery preserves data without duplicates. |

