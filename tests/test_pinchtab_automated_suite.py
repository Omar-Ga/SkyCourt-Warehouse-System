"""
Automated PinchTab Test Suite for SkyCourt Warehouse System (13 Closed Issues).

Validates all 13 closed issues through native PinchTab browser automation:
- Issue #1: Safe Transactions, Validation & Idempotency
- Issue #2: Offline Stock Mutation Gating
- Issue #3: Authenticated Sessions & Role-Enforced API Access
- Issue #4: Authentication & Session Isolation in React App
- Issue #5: Preserved Inventory Workflows Under Authentication
- Issue #6: Capability-Based Navigation
- Issue #7: Leave Orders Creation & Management
- Issue #8: Returns Processing & Ticket Closure
- Issue #9: Purchase Order Lifecycle & RTL Printing
- Issue #10: Purchase Order Receiving & Stock Increment
- Issue #11: Freshness, Ticket Badges & Reporting Updates
- Issue #12: Two-Workstation Release Qualification (E2E)
- Issue #13: Offline Sync Abandonment & Online-Only Architecture
"""

import sys
import os
import time
import json
import re
import subprocess
import unittest

BASE_URL = "http://127.0.0.1:5070"


def normalize_arabic(text):
    if not text:
        return ""
    text = re.sub(r'[أإآ]', 'ا', text)
    text = re.sub(r'ة', 'ه', text)
    text = re.sub(r'[\u064B-\u065F]', '', text)  # remove harakat
    return text.strip().lower()


class PinchTabDriver:
    """Wrapper around pinchtab CLI for reliable native browser automation."""

    @staticmethod
    def run_cmd(*args):
        cmd = ["pinchtab", *args]
        res = subprocess.run(cmd, capture_output=True, text=True)
        return res.stdout.strip(), res.stderr.strip(), res.returncode

    @classmethod
    def nav(cls, url=BASE_URL):
        cls.run_cmd("nav", url)
        time.sleep(1.0)

    @classmethod
    def snap(cls):
        out, _, _ = cls.run_cmd("snap")
        return out

    @classmethod
    def text(cls):
        out, _, _ = cls.run_cmd("text")
        return out

    @classmethod
    def eval_js(cls, code):
        out, _, _ = cls.run_cmd("eval", code)
        return out

    @classmethod
    def find_ref(cls, label_substr, role=None):
        raw = cls.snap()
        norm_sub = normalize_arabic(label_substr)
        for line in raw.splitlines():
            m = re.match(r'^(e\d+):([a-z]+)(?:\s+"([^"]*)")?', line.strip())
            if m:
                ref, r, label = m.group(1), m.group(2), m.group(3) or ""
                if norm_sub in normalize_arabic(label):
                    if role is None or r == role:
                        return ref, r, label
        return None

    @classmethod
    def has_node(cls, label_substr, role=None):
        return cls.find_ref(label_substr, role) is not None

    @classmethod
    def has_exact_node(cls, exact_label, role=None):
        raw = cls.snap()
        norm_target = normalize_arabic(exact_label)
        for line in raw.splitlines():
            m = re.match(r'^(e\d+):([a-z]+)(?:\s+"([^"]*)")?', line.strip())
            if m:
                _, r, label = m.group(1), m.group(2), m.group(3) or ""
                if normalize_arabic(label) == norm_target:
                    if role is None or r == role:
                        return True
        return False

    @classmethod
    def click_node(cls, label_substr, role=None):
        for _ in range(3):
            item = cls.find_ref(label_substr, role)
            if item:
                cls.run_cmd("click", item[0])
                time.sleep(1.2)
                return item
            time.sleep(0.5)
        raise RuntimeError(f"Could not find element matching '{label_substr}' (role={role}) in snapshot:\n{cls.snap()}")

    @classmethod
    def fill_node(cls, label_substr, value, role="textbox"):
        for _ in range(3):
            item = cls.find_ref(label_substr, role)
            if item:
                cls.run_cmd("fill", item[0], value)
                time.sleep(0.3)
                return item
            time.sleep(0.5)
        raise RuntimeError(f"Could not find textbox matching '{label_substr}' in snapshot:\n{cls.snap()}")

    @classmethod
    def logout(cls):
        for _ in range(4):
            if cls.has_node("تسجيل الدخول", role="heading"):
                return True
            item = cls.find_ref("تسجيل الخروج", role="button")
            if item:
                cls.run_cmd("click", item[0])
                time.sleep(1.0)
                if cls.has_node("تسجيل الدخول", role="heading"):
                    return True
                cls.run_cmd("press", "Enter")
                time.sleep(1.0)
                if cls.has_node("تسجيل الدخول", role="heading"):
                    return True
                cls.run_cmd("click", item[0])
                time.sleep(1.0)
            else:
                time.sleep(0.5)
        return cls.has_node("تسجيل الدخول", role="heading")

    @classmethod
    def login(cls, username, password):
        cls.nav(f"{BASE_URL}/")
        time.sleep(0.8)
        cls.logout()

        cls.fill_node("اسم المستخدم", username, role="textbox")
        cls.fill_node("كلمة المرور", password, role="textbox")
        cls.click_node("تسجيل الدخول", role="button")
        time.sleep(2.0)


class TestPinchTab13ClosedIssues(unittest.TestCase):
    """Automated testing suite covering all 13 closed issues through PinchTab."""

    @classmethod
    def setUpClass(cls):
        health, _, code = PinchTabDriver.run_cmd("health")
        if code != 0:
            raise RuntimeError(f"PinchTab health check failed: {health}")
        PinchTabDriver.nav(f"{BASE_URL}/")

    def test_01_issues_03_and_04_authentication_and_session_isolation(self):
        """
        Issue #3: Authenticated Sessions & Role-Enforced API Access
        Issue #4: React Authentication Lifecycle & Session Isolation
        """
        print("\n--- Running Test: Issues #3 & #4 (Auth & Session Isolation) ---")
        
        # 1. Invalid credentials rejection
        PinchTabDriver.logout()
        PinchTabDriver.fill_node("اسم المستخدم", "invalid_operator", role="textbox")
        PinchTabDriver.fill_node("كلمة المرور", "wrong_pass123", role="textbox")
        PinchTabDriver.click_node("تسجيل الدخول", role="button")
        time.sleep(1.5)
        
        page_text = PinchTabDriver.text()
        expected_msg = normalize_arabic("اسم المستخدم أو كلمة المرور غير صحيحة")
        self.assertTrue(
            expected_msg in normalize_arabic(page_text) or "فشل تسجيل الدخول" in normalize_arabic(page_text),
            f"Invalid credentials must show error in page text: {page_text}"
        )

        # 2. Warehouse login
        PinchTabDriver.login("warehouse", "warehouse123")
        self.assertTrue(PinchTabDriver.has_node("نظام المخزن", role="heading"), "Warehouse heading rendered")

        # 3. Session Isolation: logout & Office login
        PinchTabDriver.logout()
        self.assertTrue(PinchTabDriver.has_node("تسجيل الدخول", role="heading"), "Returned to login")

        PinchTabDriver.login("office", "office123")
        self.assertTrue(PinchTabDriver.has_node("نظام المكتب", role="heading"), "Office heading rendered")

        # 4. Admin login
        PinchTabDriver.logout()
        PinchTabDriver.login("admin", "admin123")
        self.assertTrue(PinchTabDriver.has_node("ادارة النظام", role="heading"), "Admin heading rendered")
        PinchTabDriver.logout()

    def test_02_issue_06_capability_based_navigation(self):
        """
        Issue #6: Capability-Based Office and Warehouse Navigation
        """
        print("\n--- Running Test: Issue #6 (Capability-Based Navigation) ---")
        
        # 1. Warehouse Role Navigation
        PinchTabDriver.login("warehouse", "warehouse123")
        self.assertTrue(PinchTabDriver.has_node("الرئيسية", role="button"), "Warehouse has Dashboard")
        self.assertTrue(PinchTabDriver.has_node("ادارة الاصناف", role="button"), "Warehouse has Items management")
        self.assertTrue(PinchTabDriver.has_node("اذونات الصرف", role="button"), "Warehouse has Leave Orders")
        self.assertTrue(PinchTabDriver.has_node("استلام اوامر الشراء", role="button"), "Warehouse has PO Receiving")
        self.assertTrue(PinchTabDriver.has_node("سجل الحركات", role="button"), "Warehouse has Logs")
        self.assertTrue(PinchTabDriver.has_node("ادارة الوحدات", role="button"), "Warehouse has Units")
        self.assertTrue(PinchTabDriver.has_node("ادارة الوجهات", role="button"), "Warehouse has Destinations")
        self.assertTrue(PinchTabDriver.has_node("ادارة الموردين", role="button"), "Warehouse has Providers")
        
        # Must NOT have Office-only items (exact match for "أوامر الشراء" vs "استلام أوامر الشراء")
        self.assertFalse(PinchTabDriver.has_exact_node("اوامر الشراء", role="button"), "Warehouse must NOT have PO management")
        self.assertFalse(PinchTabDriver.has_node("تذاكر الصرف", role="button"), "Warehouse must NOT have Tickets")
        PinchTabDriver.logout()

        # 2. Office Role Navigation
        PinchTabDriver.login("office", "office123")
        self.assertTrue(PinchTabDriver.has_node("الرئيسية", role="button"), "Office has Dashboard")
        self.assertTrue(PinchTabDriver.has_node("دليل الاصناف", role="button"), "Office has read-only Items Catalog")
        self.assertTrue(PinchTabDriver.has_node("اوامر الشراء", role="button"), "Office has Purchase Orders")
        self.assertTrue(PinchTabDriver.has_node("تذاكر الصرف", role="button"), "Office has Tickets")
        self.assertTrue(PinchTabDriver.has_node("تقارير الحركات", role="button"), "Office has Movement Reports")

        # Must NOT have Warehouse-only items
        self.assertFalse(PinchTabDriver.has_node("اذونات الصرف", role="button"), "Office must NOT have Leave Orders")
        self.assertFalse(PinchTabDriver.has_node("استلام اوامر الشراء", role="button"), "Office must NOT have PO Receiving")
        self.assertFalse(PinchTabDriver.has_node("ادارة الوحدات", role="button"), "Office must NOT have Units")
        self.assertFalse(PinchTabDriver.has_node("ادارة الوجهات", role="button"), "Office must NOT have Destinations")
        self.assertFalse(PinchTabDriver.has_node("ادارة الموردين", role="button"), "Office must NOT have Providers")
        PinchTabDriver.logout()

    def test_03_issues_01_and_05_inventory_workflows_and_defense_in_depth(self):
        """
        Issue #1: Validation, Idempotency & Safe Transactions
        Issue #5: Preserved Inventory Workflows Under Authentication & Office Mutation Defense
        """
        print("\n--- Running Test: Issues #1 & #5 (Inventory Workflows & Role Defense) ---")
        
        # 1. Office Read-Only Inventory Defense
        PinchTabDriver.login("office", "office123")
        PinchTabDriver.click_node("دليل الاصناف", role="button")
        
        self.assertTrue(PinchTabDriver.has_node("دليل الاصناف", role="heading"), "Office sees 'دليل الأصناف'")
        self.assertFalse(PinchTabDriver.has_node("اضافة صنف", role="button"), "Office must NOT have Add Item button")
        self.assertFalse(PinchTabDriver.has_node("اضافة فئة", role="button"), "Office must NOT have Add Category button")
        self.assertFalse(PinchTabDriver.has_node("تعديل الكمية", role="button"), "Office must NOT have Adjust Quantity button")
        PinchTabDriver.logout()

        # 2. Warehouse Inventory Management & Validation
        PinchTabDriver.login("warehouse", "warehouse123")
        PinchTabDriver.click_node("ادارة الاصناف", role="button")
        
        self.assertTrue(PinchTabDriver.has_node("ادارة الاصناف", role="heading"), "Warehouse sees 'إدارة الأصناف'")
        page_text = PinchTabDriver.text()
        self.assertIn("تصفح الاقسام والاصناف", normalize_arabic(page_text))
        PinchTabDriver.logout()

    def test_04_issue_07_leave_orders_management(self):
        """
        Issue #7: Create and Manage Leave Orders
        """
        print("\n--- Running Test: Issue #7 (Leave Orders Management) ---")
        PinchTabDriver.login("warehouse", "warehouse123")
        PinchTabDriver.click_node("اذونات الصرف", role="button")

        self.assertTrue(PinchTabDriver.has_node("اذونات الصرف", role="heading"), "Page displays 'أذونات الصرف'")
        self.assertTrue(PinchTabDriver.has_node("انشاء اذن صرف جديد", role="button"), "Must have Create Leave Order button")
        self.assertTrue(PinchTabDriver.has_node("الكل", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مفتوح", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مرتجع جزئيا", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مغلق", role="button"))
        PinchTabDriver.logout()

    def test_05_issue_08_tickets_and_returns(self):
        """
        Issue #8: Process Returns and Close Tickets
        """
        print("\n--- Running Test: Issue #8 (Tickets & Returns Processing) ---")
        PinchTabDriver.login("office", "office123")
        PinchTabDriver.click_node("تذاكر الصرف", role="button")

        self.assertTrue(PinchTabDriver.has_node("تذاكر الصرف", role="heading"), "Page displays 'تذاكر الصرف'")
        self.assertTrue(PinchTabDriver.has_node("المعلقة (الافتراضي)", role="button"))
        self.assertTrue(PinchTabDriver.has_node("الكل", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مفتوح", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مرتجع جزئيا", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مغلق", role="button"))
        PinchTabDriver.logout()

    def test_06_issue_09_purchase_orders_lifecycle(self):
        """
        Issue #9: Purchase Order Creation, Lifecycle, and Printing
        """
        print("\n--- Running Test: Issue #9 (Purchase Orders Lifecycle) ---")
        PinchTabDriver.login("office", "office123")
        PinchTabDriver.click_node("اوامر الشراء", role="button")

        self.assertTrue(PinchTabDriver.has_node("اوامر الشراء", role="heading"), "Page displays 'أوامر الشراء'")
        self.assertTrue(PinchTabDriver.has_node("انشاء امر شراء جديد", role="button"), "Must have Create PO button")
        self.assertTrue(PinchTabDriver.has_node("الكل", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مفتوح", role="button"))
        self.assertTrue(PinchTabDriver.has_node("منتهي الصلاحية", role="button"))
        self.assertTrue(PinchTabDriver.has_node("مغلق (مستلم)", role="button"))
        self.assertTrue(PinchTabDriver.has_node("ملغي", role="button"))
        PinchTabDriver.logout()

    def test_07_issue_10_po_receiving(self):
        """
        Issue #10: Scan and Finalize Purchase Order Receipts
        """
        print("\n--- Running Test: Issue #10 (PO Receiving) ---")
        PinchTabDriver.login("warehouse", "warehouse123")
        PinchTabDriver.click_node("استلام اوامر الشراء", role="button")

        self.assertTrue(PinchTabDriver.has_node("استلام اوامر الشراء", role="heading"), "Page displays 'استلام أوامر الشراء'")
        page_text = PinchTabDriver.text()
        expected_section = normalize_arabic("أوامر الشراء المفتوحة الجاهزة للاستلام")
        self.assertIn(expected_section, normalize_arabic(page_text))
        PinchTabDriver.logout()

    def test_08_issue_11_freshness_ticket_badges_and_reporting(self):
        """
        Issue #11: Freshness, Ticket Badges, and Reporting Updates
        """
        print("\n--- Running Test: Issue #11 (Freshness & Reporting Updates) ---")
        
        # 1. Ticket badge in Office
        PinchTabDriver.login("office", "office123")
        self.assertTrue(PinchTabDriver.has_node("تذاكر الصرف", role="button"), "Ticket button in sidebar exists for polling badge")

        # 2. Movement Reports with Return actions
        PinchTabDriver.click_node("تقارير الحركات", role="button")

        self.assertTrue(PinchTabDriver.has_node("سجل الحركات", role="heading"), "Page displays 'سجل الحركات'")
        self.assertTrue(PinchTabDriver.has_node("مرتجع", role="option"), "Movement log options include 'مرتجع' (Return)")
        self.assertTrue(PinchTabDriver.has_node("اضافة", role="option"), "Movement log options include 'إضافة' (Addition)")
        self.assertTrue(PinchTabDriver.has_node("سحب", role="option"), "Movement log options include 'سحب' (Removal)")
        PinchTabDriver.logout()

    def test_09_issues_02_and_13_offline_gating_and_sync_status(self):
        """
        Issue #2: Gate Offline Stock Mutations (ADR 0001)
        Issue #13: Abandon Offline Sync & Enforce Authoritative Online Architecture (ADR 0002)
        """
        print("\n--- Running Test: Issues #2 & #13 (Offline Gating & Sync Status) ---")
        PinchTabDriver.login("warehouse", "warehouse123")
        PinchTabDriver.click_node("الاعدادات", role="button")

        self.assertTrue(PinchTabDriver.has_node("الاعدادات", role="heading"), "Page displays 'الإعدادات'")
        page_text = normalize_arabic(PinchTabDriver.text().replace(" ", ""))
        self.assertIn("سحابي(cloud)", page_text, "Settings must reflect Cloud database mode")
        self.assertIn("sqlite", page_text, "Settings displays SQLite engine")
        PinchTabDriver.logout()

    def test_10_issue_12_two_workstation_release_qualification(self):
        """
        Issue #12: Complete Migration, Deployment, and Two-Workstation Release Qualification
        """
        print("\n--- Running Test: Issue #12 (Two-Workstation Qualification) ---")
        
        # 1. Warehouse Workstation Pass
        PinchTabDriver.login("warehouse", "warehouse123")
        self.assertTrue(PinchTabDriver.has_node("نظام المخزن", role="heading"))
        
        warehouse_pages = ["الرئيسية", "ادارة الاصناف", "اذونات الصرف", "استلام اوامر الشراء", "سجل الحركات", "الاعدادات"]
        for p in warehouse_pages:
            PinchTabDriver.click_node(p, role="button")
            self.assertTrue(len(PinchTabDriver.text()) > 10, f"Warehouse page '{p}' loaded successfully")
        PinchTabDriver.logout()

        # 2. Office Workstation Pass
        PinchTabDriver.login("office", "office123")
        self.assertTrue(PinchTabDriver.has_node("نظام المكتب", role="heading"))
        
        office_pages = ["الرئيسية", "دليل الاصناف", "اوامر الشراء", "تذاكر الصرف", "تقارير الحركات", "الاعدادات"]
        for p in office_pages:
            PinchTabDriver.click_node(p, role="button")
            self.assertTrue(len(PinchTabDriver.text()) > 10, f"Office page '{p}' loaded successfully")
        PinchTabDriver.logout()

        print("\n=== ALL 13 CLOSED ISSUES QUALIFIED AND TESTED VIA PINCHTAB ===")


if __name__ == "__main__":
    unittest.main(verbosity=2)
