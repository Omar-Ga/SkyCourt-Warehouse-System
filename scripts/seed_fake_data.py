#!/usr/bin/env python3
"""
Seed realistic domain data for SkyCourt Warehouse System.
Provides 500-1,000 authentic items, categories, suppliers, destinations,
purchase orders, leave orders, and immutable movement logs.

Usage:
    python scripts/seed_fake_data.py [--count 600] [--clean] [--verify]
"""
import argparse
import datetime
import os
import random
import sys

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.db_utils import get_db

# --- Domain Data Dictionaries ---

UNITS = [
    "عدد",
    "متر",
    "متر مربع",
    "لتر",
    "كيس",
    "كرتونة",
    "لفة",
    "طقم",
    "كيلو جرام",
    "علبة",
    "ماسورة",
    "لوح"
]

PARENT_CATEGORIES = {
    "كهرباء": [
        "كابلات وأسلاك",
        "مفاتيح وبرايز",
        "قواطع ولوحات توزيع",
        "إضاءة وليد بروفايل",
        "خراطيم ومواسير كهرباء",
        "إكسسوارات كهربائية"
    ],
    "سباكة وعزل": [
        "مواسير تغذية بولي بروبلين",
        "مواسير صرف PVC",
        "محابس ومحابس دفن",
        "خلاطات وأطقم صحية",
        "لوازم سباكة وجلب",
        "مواد عزل مائي وحراري"
    ],
    "مواد بناء وحدادة": [
        "أسمنت وجبس",
        "حديد تسليح وزوايا",
        "مسامير وفيشرات وصواميل",
        "شباك وأسياخ لحام",
        "طوب ورمل وسن"
    ],
    "نقاشة ودهانات": [
        "دهانات بلاستيك داخلية",
        "دهانات خارجية وسيليكون",
        "معجون وسيلر",
        "أدوات نقاشة (رولات وفرش)",
        "صنفرة وتيب وتغطية"
    ],
    "العدد والآلات": [
        "أدوات كهربائية (شنيور وصاروخ)",
        "أدوات يدوية (مفكات وبنس)",
        "أدوات قياس وموازين",
        "أسطوانات قطعية وتجليخ"
    ],
    "أمن وسلامة ومعدات موقع": [
        "مهمات وقاية شخصية (خوذ وأحذية)",
        "سلالم وسقالات",
        "طفايات حريق وخراطيم",
        "إشارات وشريط تحذيري"
    ]
}

PROVIDERS = [
    "شركة السويدي إلكتريك للكابلات",
    "مجموعة الشريف لأنظمة السباكة الحديثة",
    "شركة كيماويات البناء الحديث (CMB)",
    "شنايدر إلكتريك مصر",
    "شركة مصر للأسمنت والجبس",
    "حديد عز للدرفلة والتوزيع",
    "دهانات سايبس مصر",
    "دهانات جوتن العالمية",
    "رواد الهندسة للتجارة والتوريدات",
    "الأهرام للتجهيزات الفنية والعدد",
    "شركة النيل للأدوات الصحية والسباكة",
    "بوش مصر للمعدات والآلات الصناعية",
    "الشركة العالمية للعوازل والمستلزمات",
    "المؤسسة الفنية لتجارة الحديد والصلب",
    "شركة الأندلس للأجهزة الكهربائية"
]

DESTINATIONS = [
    "الموقع العام والورشة المركزية",
    "مشروع كمبوند بالم هيلز - فيلا 42",
    "مشروع كمبوند بالم هيلز - فيلا 88",
    "مشروع زايد ديونز - عمارة B4",
    "مشروع زايد ديونز - عمارة B7",
    "المبنى الإداري الجديد - التجمع الخامس",
    "مشروع زيزينيا المستقبل - مجمع الخدمات",
    "مول داون تاون - محلات الدور الأرضي",
    "مقر الشركة الرئيسي - المعادي",
    "مشروع ميفيدا - فيلا 105",
    "مشروع ميفيدا - فيلا 114",
    "مخزن فرعي رقم 2 - المنطقة الصناعية",
    "مشروع العاصمة الإدارية - الحي السكني R3",
    "مشروع العاصمة الإدارية - المبنى الوزاري",
    "مشروع مدينتي - مجموعة 110",
    "مشروع الرحاب - السوق التجاري الشرقي",
    "موقع أبراج العلمين الجديدة",
    "مشروع قرية لافيستا - الساحل الشمالي",
    "موقع فندق الماسة - التوسعات الغربية",
    "مركز صيانة وتجهيز المعدات - العاشر",
    "محطة محولات الكهرباء الرئيسية",
    "مشروع سكني قطامية هايتس - فيلا 18",
    "مجمع مدارس التجمع الدولي",
    "مبنى العيادات الطبية التخصصية",
    "المستودع اللوجستي المركزي - 6 أكتوبر"
]

EMPLOYEES = [
    "م. أحمد مصطفى",
    "م. تامر عبد الحميد",
    "م. كريم الشناوي",
    "م. هاني إبراهيم",
    "عماد صبحي (مشرف موقع)",
    "إسلام جودة (فني أول)",
    "سعد مهران (مسؤول التركيبات)",
    "محمود غريب (رئيس العمال)",
    "وليد العوضي (مشرف تشطيبات)",
    "ياسر عبد الدايم (مسؤول السباكة)",
    "هشام فاروق (مسؤول الكهرباء)",
    "عادل سلامة (مشرف النقاشة)",
    "سامح قاسم (مهندس مقيم)"
]

# Product Name Generation Templates by Category
ITEM_TEMPLATES = {
    "كابلات وأسلاك": [
        ("سلك معزول {size} مم سويدي", "متر", 8, 95),
        ("كابل نحاس شعر مرن {size} مم", "متر", 12, 140),
        ("كابل مدرع مسلح {size_cable} مم السويدي", "متر", 120, 850),
        ("سلك تليفون معزول {pairs} خط", "لفة", 180, 450),
        ("كابل شبكات انترنت كات {cat} أصلي", "لفة", 850, 2200),
        ("كابل إشارة وشيلد {size} مم", "متر", 25, 75)
    ],
    "مفاتيح وبرايز": [
        ("مفتاح إنارة {gang} خط بتشينو ماجيك", "عدد", 35, 95),
        ("بريزة كهرباء عادية شاسيه + وش بتشينو", "عدد", 40, 85),
        ("بريزة شوتكو ارث 16 أمبير معزولة", "عدد", 65, 140),
        ("مفتاح ديفياتوري سلم ماجيك", "عدد", 45, 110),
        ("مفتاح ديمر تحكم إضاءة 500 وات", "عدد", 120, 280),
        ("مفتاح تكييف ثنائي 32 أمبير مع لمبة", "عدد", 95, 210)
    ],
    "قواطع ولوحات توزيع": [
        ("قاطع تيار أوتوماتيك {amp} أمبير 1 فاز شنايدر", "عدد", 110, 240),
        ("قاطع تيار أوتوماتيك {amp_heavy} أمبير 3 فاز شنايدر", "عدد", 550, 1600),
        ("قاطع تفاضلي إيرث ليدج {amp} أمبير 30 مللي", "عدد", 850, 1950),
        ("لوحة توزيع كهرباء {ways} خط شنايدر فينوس", "عدد", 420, 1850),
        ("كونتاكتور {amp} أمبير ملف 220 فولت", "عدد", 380, 950)
    ],
    "إضاءة وليد بروفايل": [
        ("سبوت لايت ليد {watts} وات غاطس أبيض/أصفر", "عدد", 65, 185),
        ("بانل ليد 60*60 سم {watts_panel} وات كلاسيك", "عدد", 220, 480),
        ("شريط ليد بروفايل {watts_led} وات/متر لفة 5م", "لفة", 160, 390),
        ("عود ألومنيوم بروفايل ليد 2 متر دفن/لطش", "عدد", 75, 190),
        ("ترانس إلكتروني شريط ليد {amps_trans} أمبير 12فولت", "عدد", 140, 360),
        ("كشاف إضاءة واجهات ليد {watts_flood} وات خارجي ضد الماء", "عدد", 450, 1450)
    ],
    "خراطيم ومواسير كهرباء": [
        ("خرطوم بولين مصمت {diameter} مم لفة 50م", "لفة", 180, 380),
        ("خرطوم سوستة مرن {diameter} مم علاء الدين", "لفة", 120, 270),
        ("ماسورة كهرباء PVC صلب 3 متر {diameter} مم", "ماسورة", 28, 65),
        ("بواط توزيع تجميع مقاس {box_size} سم", "عدد", 35, 110)
    ],
    "إكسسوارات كهربائية": [
        ("شريط لحام عازل أصلي شكرتون (علبة 10 قطع)", "علبة", 65, 120),
        ("روزيتا توصيل نحاس مقاس {size} مم", "عدد", 12, 35),
        ("أفيز بلاستيك ربط كابلات مقاس {cable_tie} سم", "كيس", 45, 110),
        ("جلندات ربط كابلات بلاستيك مقاس {gland_size}", "كيس", 55, 140)
    ],
    "مواسير تغذية بولي بروبلين": [
        ("ماسورة بولي بروبلين 4 متر قطر {inch} الشريف", "ماسورة", 85, 340),
        ("ماسورة بولي معزولة حرارياً 4 متر {inch}", "ماسورة", 120, 480),
        ("لفة بولي كربوني مرن متعدد الطبقات قطر {inch}", "لفة", 750, 1900)
    ],
    "مواسير صرف PVC": [
        ("ماسورة صرف PVC رمادي 4 متر قطر {pipe_drain} بوصة", "ماسورة", 140, 520),
        ("ماسورة صرف أبيض سميك 4 متر قطر {pipe_drain} بوصة", "ماسورة", 190, 680),
        ("جلبة إصلاح صرف {pipe_drain} بوصة كبس", "عدد", 40, 115)
    ],
    "محابس ومحابس دفن": [
        ("محبس بولي بلية دفن بمقبض نيكل قطر {inch}", "عدد", 140, 380),
        ("محبس زاوية ألماني 1/2 بوصة نحاس ثقيل", "عدد", 85, 210),
        ("محبس سكينة إيطالي برونز قطر {inch_heavy}", "عدد", 320, 850),
        ("رداد عدم رجوع سوستة إيطالي {inch}", "عدد", 110, 290)
    ],
    "خلاطات وأطقم صحية": [
        ("خلاط مياه حوض شجرة قلب سيراميك إيديال", "طقم", 850, 2400),
        ("خلاط دش حائطي مع طقم سماعة ومسطرة", "طقم", 1100, 3100),
        ("محبس دفن خطين ساخن وبارد جروهي أصلي", "عدد", 950, 2800),
        ("سيفون حوض نيكل مرن تصريف سفلي", "عدد", 90, 220)
    ],
    "لوازم سباكة وجلب": [
        ("كوع بولي 90 درجة مقاس {inch} الشريف", "عدد", 15, 65),
        ("تي بولي متساوي مقاس {inch}", "عدد", 22, 85),
        ("جلبة بسن ذكر نحاس مقاس {inch}", "عدد", 35, 110),
        ("جلبة بسن أنثى نحاس مقاس {inch}", "عدد", 32, 105),
        ("بكرة تفلون أصلي عريض شريط مانع تسريب (علبة 10)", "علبة", 70, 130)
    ],
    "مواد عزل مائي وحراري": [
        ("بستلة عزل مائي سيكاتوب سيل 107 (25 كجم)", "كيس", 380, 720),
        ("برميل بتومين مؤكسد بارد عازل 180 لتر", "لتر", 1800, 3200),
        ("رول خيش قطران ممبرين 4 مم سمك مسلح", "لفة", 650, 1150),
        ("فوم بولي يوريثان عازل صوتي وفواصل 750 مل", "علبة", 110, 240)
    ],
    "أسمنت وجبس": [
        ("شيكارة أسمنت بورتلاندي عادي رتبة 42.5 (50 كجم)", "كيس", 140, 195),
        ("شيكارة أسمنت أبيض ممتاز سوبر سيناء 40 كجم", "كيس", 185, 245),
        ("شيكارة جبس المعمار زهرة سيناء 30 كجم", "كيس", 65, 95),
        ("شيكارة أديبوند 65 بوليمر معالجة خرسانة 5 كجم", "كيس", 220, 420)
    ],
    "حديد تسليح وزوايا": [
        ("سيخ حديد تسليح مشرشر قطر {rebar} مم طول 12م", "عدد", 280, 890),
        ("زاوية حديد صلب متساوي {angle} مم طول 6م", "عدد", 350, 980),
        ("خوصة حديد مبطط تخانة {flat_iron} مم 6م", "عدد", 180, 490),
        ("كمرة حديد مجرى U مقاس {channel} مم", "عدد", 680, 1950)
    ],
    "مسامير وفيشرات وصواميل": [
        ("مسمار سن صاج أسود مقاس {screw_size} مم (علبة 1000)", "علبة", 85, 160),
        ("فيشر بلاستيك رمادي مقاس {fischer_size} (كيس 100)", "كيس", 25, 60),
        ("مسمار جنش حديد صلب مجلفن مقاس {hook} مم", "كيس", 45, 95),
        ("تياش تسقيط مجلفن قلاووظ 1 متر مقاس {thread} مم", "عدد", 35, 85)
    ],
    "شباك وأسياخ لحام": [
        ("علبة سلك لحام حديد مقاس 3.2 مم جودوين (5 كجم)", "علبة", 240, 460),
        ("رول شبك سلك ممدد مباني مجلفن عرض 20 سم", "لفة", 95, 220),
        ("متر سلك منخل حديد غربال ناعم متين", "متر مربع", 45, 110)
    ],
    "طوب ورمل وسن": [
        ("ألف طوبة أحمر مفرغ مقاس 25*12*6 سم", "عدد", 1400, 2100),
        ("متر مكعب سن نمرة 1 ممتاز للخرسانة", "عدد", 320, 450),
        ("متر مكعب رمل حرش مغسول للبناء والمحارة", "عدد", 180, 280)
    ],
    "دهانات بلاستيك داخلية": [
        ("بستلة بلاستيك مط فينوماستيك جوتن 14 لتر", "لتر", 850, 1950),
        ("بستلة بلاستيك نصف لمعة سايتون سايبس 14 لتر", "لتر", 720, 1680),
        ("بستلة بلاستيك مقاوم للبكتيريا والغسيل ديلوكس", "لتر", 980, 2350),
        ("جالون دهان كيمابوكسي أرضيات إيبوكسي 4 كجم", "علبة", 650, 1450)
    ],
    "دهانات خارجية وسيليكون": [
        ("بستلة جوتاشيلد خارجي مقاوم للعوامل الجوية 14 لتر", "لتر", 1200, 2750),
        ("أنبوبة سيليكون مطاط شفاف مضاد للبكتيريا 300 مل", "علبة", 75, 165),
        ("أنبوبة سيليكون أكرليك أبيض فواصل محارة 300 مل", "علبة", 55, 120),
        ("علبة فوم بخاخ تثبيت ألمونيوم وأبواب 500 مل", "علبة", 95, 190)
    ],
    "معجون وسيلر": [
        ("شيكارة معجون حوائط جاهز سافيتو بوليمر 20 كجم", "كيس", 140, 240),
        ("بستلة معجون دايتون حوائط ناعم سايبس 15 كجم", "علبة", 180, 320),
        ("بستلة سيلر مائي مقاوم للرطوبة والأملاح 14 لتر", "لتر", 260, 480),
        ("جالون بادية زياتي تأسيس خشب وحديد 3 كجم", "علبة", 220, 420)
    ],
    "أدوات نقاشة (رولات وفرش)": [
        ("رول دهان بلاستيك فايبر 9 بوصة تركي أصلي", "عدد", 65, 145),
        ("فرشاة نقاشة شعر طبيعي كثيف عرض {brush} بوصة", "عدد", 35, 95),
        ("سكين معجون صلب مرن يد كاوتش مقاس {blade} سم", "عدد", 40, 95),
        ("طقم كف معجون ستانلس ستيل تركي 4 قطع", "طقم", 140, 310)
    ],
    "صنفرة وتيب وتغطية": [
        ("لفة شريط تيب ورقي حماية دهانات عرض 2 بوصة 40م", "لفة", 25, 55),
        ("رول صنفرة حوائط دوكو خشابي متدرج نمرة {grit}", "لفة", 180, 340),
        ("مشمع بلاستيك شفاف ثقيل تغطية أثاث وأرضيات 4*5م", "لوح", 45, 95)
    ],
    "أدوات كهربائية (شنيور وصاروخ)": [
        ("شنيور دقاق 13 مم 750 وات بوش أصلي", "عدد", 1850, 3400),
        ("صاروخ قطعية وتجليخ 9 بوصة 2200 وات بوش", "عدد", 3200, 5800),
        ("هيلتي تكسير وتخريم 4 كجم 850 وات ماكيتا", "عدد", 4100, 7500),
        ("شنيور فك وربط بطارية ليثيوم 18 فولت مع بطاريتين", "طقم", 2600, 4900)
    ],
    "أدوات يدوية (مفكات وبنس)": [
        ("طقم مفكات عادة وتست وصليبة معزول 1000 فولت (7 قطع)", "طقم", 280, 580),
        ("بنسة كلابة مقاس 10 بوصة كروم فاناديوم", "عدد", 120, 240),
        ("بنسة كهربائي معزولة 8 بوصة توتال كواليتي", "عدد", 95, 190),
        ("مفتاح فرنساوي مقاس {wrench} بوصة تايواني ثقيل", "عدد", 140, 320),
        ("شاكوش تخريم يد فايبر جلاس رأس صلب 500 جرام", "عدد", 85, 180)
    ],
    "أدوات قياس وموازين": [
        ("شريط قياس متري معدني أوتوماتيك طول {tape} متر", "عدد", 55, 130),
        ("ميزان مياه ألومنيوم مغناطيسي دقيق مقاس {level} سم", "عدد", 110, 280),
        ("جهاز قياس مسافات ليزر رقمي دقيق حتى 50 متر", "عدد", 1250, 2400)
    ],
    "أسطوانات قطعية وتجليخ": [
        ("أسطوانة قطعية حديد وصاج 9 بوصة بوش (علبة 25)", "علبة", 450, 850),
        ("أسطوانة ألماس قطعية رخام وخرسانة 4.5 بوصة كروان", "عدد", 120, 260),
        ("أسطوانة تجليخ وتلميع معادن 4.5 بوصة ألمانية", "عدد", 65, 135)
    ],
    "مهمات وقاية شخصية (خوذ وأحذية)": [
        ("خوذة سلامة موقع رأس فايبر بأربطة قابلة للضبط", "عدد", 75, 160),
        ("حذاء سلامة سيفتي جلد طبيعي نعل حديد مقاس {shoe}", "طقم", 450, 950),
        ("سترة فوسفورية عاكسة للضوء موقع برتقالي/أصفر", "عدد", 35, 75),
        ("نظارة حماية شفافة ضد الأتربة والرايش بولي كربونيت", "عدد", 30, 65),
        ("جوانتي عمل حماية جلد مقوى للأعمال الشاقة (دزينة)", "علبة", 120, 260)
    ],
    "سلالم وسقالات": [
        ("سلم ألومنيوم مفصلي متعدد الأوضاع 4*4 درجات (4.7م)", "عدد", 2400, 4800),
        ("كلبس سقالة حديد ثقيل دوار وثابت مقاس 2 بوصة", "عدد", 85, 190),
        ("لوح بونتي خشب سويد مشبع لسقالات البناء 4م", "لوح", 320, 650)
    ],
    "طفايات حريق وخراطيم": [
        ("طفاية حريق بودرة كيميائية جافة سعة 6 كجم بافاريا", "عدد", 950, 1850),
        ("طفاية حريق غاز ثاني أكسيد الكربون CO2 سعة 6 كجم", "عدد", 1600, 3100),
        ("خرطوم إطفاء حريق قماش مقوى 2.5 بوصة طول 30م", "لفة", 1850, 3400)
    ],
    "إشارات وشريط تحذيري": [
        ("رول شريط تحذيري مخطط أحمر وأبيض للمواقع 500م", "لفة", 95, 180),
        ("قمع مرور مرن عاكس فسفوري ارتفاع 75 سم كاوتشوك", "عدد", 110, 230),
        ("لوحة تحذيرية موقع معدنية عاكسة (ممنوع الدخول بدون مهمات)", "عدد", 85, 190)
    ]
}


def clean_database(conn):
    """Purges all domain data while preserving system users, remote settings, and migrations."""
    print("🧹 Cleaning all domain data from database...")
    cursor = conn.cursor()
    
    tables_to_purge = [
        "return_event_items",
        "return_events",
        "leave_order_rejection_events",
        "leave_order_items",
        "leave_orders",
        "purchase_order_items",
        "purchase_orders",
        "movement_logs",
        "operations",
        "items",
        "categories",
        "destinations",
        "providers",
        "units"
    ]
    
    cursor.execute("PRAGMA foreign_keys = OFF;")
    for table in tables_to_purge:
        try:
            cursor.execute(f"DELETE FROM {table};")
        except Exception as e:
            print(f"  Note: {table} delete skipped or failed: {e}")
            
    # Reset autoincrement sequences
    try:
        cursor.execute("DELETE FROM sqlite_sequence WHERE name NOT IN ('users', 'app_remote_settings', 'schema_migrations');")
    except Exception:
        pass
        
    cursor.execute("PRAGMA foreign_keys = ON;")
    conn.commit()
    print("✅ Domain data purged cleanly. System tables preserved.\n")


def generate_item_names(count=600):
    """Generates unique, realistic product items across subcategories."""
    items = []
    seen_names = set()
    
    # Value generators for template slots
    sizes = ["0.5", "1", "1.5", "2", "2.5", "3", "4", "6", "10", "16", "25", "35", "50", "70", "95"]
    sizes_cable = ["3*10+6", "3*16+10", "3*25+16", "3*35+16", "4*16", "4*25", "4*35", "4*50", "4*70"]
    pairs = ["2", "4", "10", "20", "30"]
    cats = ["6 UTP", "6A FTP", "7 SFTP"]
    gangs = ["1", "2", "3"]
    amps = ["10", "16", "20", "25", "32", "40", "50", "63"]
    amps_heavy = ["63", "80", "100", "125", "160", "200", "250"]
    ways = ["12", "18", "24", "36", "48"]
    watts = ["5", "7", "9", "12", "15", "18", "24"]
    watts_panel = ["40", "48", "60"]
    watts_led = ["10", "12", "14.4", "18"]
    amps_trans = ["5", "10", "15", "20", "30"]
    watts_flood = ["50", "100", "150", "200", "300"]
    diameters = ["16", "20", "25", "32", "40", "50"]
    box_sizes = ["10*10", "15*15", "20*20", "30*30"]
    cable_ties = ["15", "20", "25", "30", "40"]
    gland_sizes = ["PG9", "PG11", "PG13.5", "PG16", "PG21", "PG29"]
    inches = ["1/2", "3/4", "1", "1 1/4", "1 1/2", "2"]
    inches_heavy = ["1/2", "3/4", "1", "1 1/2", "2", "2 1/2", "3", "4"]
    pipe_drains = ["1.5", "2", "3", "4", "6"]
    rebars = ["8", "10", "12", "14", "16", "18", "22", "25"]
    angles = ["30*3", "40*4", "50*5", "60*6"]
    flat_irons = ["20*3", "30*3", "40*4", "50*5"]
    channels = ["100", "120", "140", "160"]
    screw_sizes = ["25*3.5", "35*3.5", "45*4.2", "55*4.2", "70*4.8"]
    fischer_sizes = ["6", "7", "8", "10", "12"]
    hooks = ["6", "8", "10", "12"]
    threads = ["6", "8", "10", "12"]
    brushes = ["1", "1.5", "2", "2.5", "3", "4"]
    blades = ["8", "10", "12", "14"]
    grits = ["80", "100", "120", "150", "180", "220", "320"]
    wrenches = ["8", "10", "12", "15"]
    tapes = ["3", "5", "8", "10"]
    levels = ["40", "60", "80", "100"]
    shoes = ["41", "42", "43", "44", "45"]
    
    subcat_names = list(ITEM_TEMPLATES.keys())
    
    while len(items) < count:
        subcat = random.choice(subcat_names)
        templates = ITEM_TEMPLATES[subcat]
        template, unit, min_cost, max_cost = random.choice(templates)
        
        # Format template with slot values
        name = template.format(
            size=random.choice(sizes),
            size_cable=random.choice(sizes_cable),
            pairs=random.choice(pairs),
            cat=random.choice(cats),
            gang=random.choice(gangs),
            amp=random.choice(amps),
            amp_heavy=random.choice(amps_heavy),
            ways=random.choice(ways),
            watts=random.choice(watts),
            watts_panel=random.choice(watts_panel),
            watts_led=random.choice(watts_led),
            amps_trans=random.choice(amps_trans),
            watts_flood=random.choice(watts_flood),
            diameter=random.choice(diameters),
            box_size=random.choice(box_sizes),
            cable_tie=random.choice(cable_ties),
            gland_size=random.choice(gland_sizes),
            inch=random.choice(inches),
            inch_heavy=random.choice(inches_heavy),
            pipe_drain=random.choice(pipe_drains),
            rebar=random.choice(rebars),
            angle=random.choice(angles),
            flat_iron=random.choice(flat_irons),
            channel=random.choice(channels),
            screw_size=random.choice(screw_sizes),
            fischer_size=random.choice(fischer_sizes),
            hook=random.choice(hooks),
            thread=random.choice(threads),
            brush=random.choice(brushes),
            blade=random.choice(blades),
            grit=random.choice(grits),
            wrench=random.choice(wrenches),
            tape=random.choice(tapes),
            level=random.choice(levels),
            shoe=random.choice(shoes)
        )
        
        # Disambiguate if needed
        if name in seen_names:
            suffixes = ["(فئة A)", "(درجة أولى)", "(توريد خاص)", "(معتمد للمشاريع)", "(موديل حديث)", "(مقاوم للحرارة)"]
            name = f"{name} {random.choice(suffixes)}"
            if name in seen_names:
                name = f"{name} #{random.randint(10, 999)}"
                
        seen_names.add(name)
        cost = round(random.uniform(min_cost, max_cost), 2)
        items.append({
            "name": name,
            "subcat_name": subcat,
            "unit": unit,
            "cost": cost
        })
        
    return items


def seed_data(conn, item_count=600):
    """Executes complete data generation and insertion."""
    cursor = conn.cursor()
    print(f"🚀 Seeding metadata and {item_count} items into SkyCourt Warehouse System...")
    
    # 1. Seed Units
    unit_map = {}
    for u in UNITS:
        cursor.execute("INSERT OR IGNORE INTO units (name) VALUES (?)", (u,))
        cursor.execute("SELECT id FROM units WHERE name = ?", (u,))
        unit_map[u] = cursor.fetchone()[0]
    print(f"  ✓ {len(unit_map)} units registered.")
    
    # 2. Seed Categories (Hierarchical)
    cat_map = {}
    subcat_map = {}
    for parent, children in PARENT_CATEGORIES.items():
        cursor.execute("INSERT OR IGNORE INTO categories (name, parent_id) VALUES (?, NULL)", (parent,))
        cursor.execute("SELECT id FROM categories WHERE name = ? AND parent_id IS NULL", (parent,))
        p_id = cursor.fetchone()[0]
        cat_map[parent] = p_id
        
        for child in children:
            cursor.execute("INSERT OR IGNORE INTO categories (name, parent_id) VALUES (?, ?)", (child, p_id))
            cursor.execute("SELECT id FROM categories WHERE name = ? AND parent_id = ?", (child, p_id))
            subcat_map[child] = cursor.fetchone()[0]
    print(f"  ✓ {len(cat_map)} parent categories and {len(subcat_map)} subcategories registered.")
    
    # 3. Seed Providers
    prov_map = {}
    for p in PROVIDERS:
        cursor.execute("INSERT OR IGNORE INTO providers (name) VALUES (?)", (p,))
        cursor.execute("SELECT id FROM providers WHERE name = ?", (p,))
        prov_map[p] = cursor.fetchone()[0]
    prov_ids = list(prov_map.values())
    print(f"  ✓ {len(prov_map)} suppliers registered.")
    
    # 4. Seed Destinations
    dest_map = {}
    for d in DESTINATIONS:
        cursor.execute("INSERT OR IGNORE INTO destinations (name) VALUES (?)", (d,))
        cursor.execute("SELECT id FROM destinations WHERE name = ?", (d,))
        dest_map[d] = cursor.fetchone()[0]
    dest_ids = list(dest_map.values())
    print(f"  ✓ {len(dest_map)} destinations registered.")
    
    # Ensure standard users exist
    cursor.execute("SELECT id, username FROM users")
    user_rows = cursor.fetchall()
    user_ids = {r[1]: r[0] for r in user_rows}
    admin_id = user_ids.get("admin", 1)
    office_id = user_ids.get("office", 2)
    warehouse_id = user_ids.get("warehouse", 3)
    
    # 5. Generate and Insert Items
    raw_items = generate_item_names(item_count)
    inserted_items = []
    
    print(f"  📦 Inserting {len(raw_items)} unique catalog items...")
    for idx, item in enumerate(raw_items, 1):
        u_id = unit_map.get(item["unit"], unit_map["عدد"])
        sub_id = subcat_map.get(item["subcat_name"], None)
        p_id = random.choice(prov_ids)
        
        # 85% active with initial inventory, 10% zero stock, 5% inactive/archived
        roll = random.random()
        if roll < 0.75:
            current_qty = random.randint(15, 350)
            status = "active"
        elif roll < 0.90:
            current_qty = random.randint(1, 15)
            status = "active"
        elif roll < 0.96:
            current_qty = 0
            status = "active"
        else:
            current_qty = random.randint(0, 10)
            status = random.choice(["inactive", "archived"])
            
        cursor.execute("""
            INSERT INTO items (name, unit_id, sub_category_id, provider_id, current_quantity, reserved_quantity, cost, status)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        """, (item["name"], u_id, sub_id, p_id, current_qty, item["cost"], status))
        
        item_id = cursor.lastrowid
        item["id"] = item_id
        item["unit_id"] = u_id
        item["unit_name"] = item["unit"]
        item["current_qty"] = current_qty
        item["provider_id"] = p_id
        inserted_items.append(item)
        
    print(f"  ✓ {len(inserted_items)} items created in catalog.")
    
    # 6. Insert Movement Logs for Initial Balances (Audit Trail Integrity)
    print("  📜 Writing initial stock movement audit logs...")
    base_time = datetime.datetime.now() - datetime.timedelta(days=45)
    for idx, item in enumerate(inserted_items):
        if item["current_qty"] > 0:
            log_time = base_time + datetime.timedelta(hours=idx % 720, minutes=random.randint(1, 59))
            cursor.execute("""
                INSERT INTO movement_logs (
                    timestamp, item_id, item_name, action_type, quantity_changed,
                    resulting_quantity, provider_id, cost_per_item, details,
                    user_id, actor_name, unit_name
                ) VALUES (?, ?, ?, 'إضافة', ?, ?, ?, ?, 'رصيد افتتاحي / جرد أولي وتوريد معتمد', ?, 'مدير المستودع', ?)
            """, (
                log_time.strftime("%Y-%m-%d %H:%M:%S"),
                item["id"],
                item["name"],
                item["current_qty"],
                item["current_qty"],
                item["provider_id"],
                item["cost"],
                warehouse_id,
                item["unit_name"]
            ))
            
    conn.commit()
    print("  ✓ Movement logs written for inventory balances.")
    
    # 7. Generate Purchase Orders (approx 40 POs)
    print("  📑 Generating Purchase Orders (POs) across draft, open, closed, void...")
    po_statuses = ["draft"] * 8 + ["open"] * 16 + ["closed"] * 12 + ["void"] * 4
    random.shuffle(po_statuses)
    
    for idx, status in enumerate(po_statuses, 1):
        po_num = f"PO-{datetime.datetime.now().year}-{idx:04d}"
        prov_name = random.choice(list(prov_map.keys()))
        prov_id = prov_map[prov_name]
        
        now = datetime.datetime.now()
        created_at = (now - datetime.timedelta(days=random.randint(5, 30))).strftime("%Y-%m-%d %H:%M:%S")
        
        if status == "draft":
            expires_at = None
            dispatched_at = None
            dispatched_by = None
            received_by = None
            closed_at = None
            voided_by = None
            voided_at = None
            void_reason = None
        elif status == "open":
            disp_dt = now - datetime.timedelta(days=random.randint(1, 7))
            dispatched_at = disp_dt.strftime("%Y-%m-%d %H:%M:%S")
            expires_at = (disp_dt + datetime.timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
            dispatched_by = office_id
            received_by = None
            closed_at = None
            voided_by = None
            voided_at = None
            void_reason = None
        elif status == "closed":
            disp_dt = now - datetime.timedelta(days=random.randint(10, 20))
            dispatched_at = disp_dt.strftime("%Y-%m-%d %H:%M:%S")
            expires_at = (disp_dt + datetime.timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
            dispatched_by = office_id
            received_by = warehouse_id
            closed_at = (disp_dt + datetime.timedelta(days=random.randint(2, 5))).strftime("%Y-%m-%d %H:%M:%S")
            voided_by = None
            voided_at = None
            void_reason = None
        elif status == "void":
            disp_dt = now - datetime.timedelta(days=random.randint(15, 25))
            dispatched_at = None
            expires_at = None
            dispatched_by = None
            received_by = None
            closed_at = None
            voided_by = office_id
            voided_at = (now - datetime.timedelta(days=random.randint(1, 10))).strftime("%Y-%m-%d %H:%M:%S")
            void_reason = random.choice([
                "إلغاء من المورد لعدم توافر الكمية المطلوبة",
                "تغيير مواصفات المشروع من قبل الاستشاري",
                "طلب شراء مكرر تم استبداله بأمر آخر",
                "ارتفاع الأسعار بشكل مبالغ فيه ورفض العرض"
            ])
            
        cursor.execute("""
            INSERT INTO purchase_orders (
                po_number, provider_id, provider_name, status, notes,
                created_by, created_at, expires_at, dispatched_at, dispatched_by,
                revision, received_by, closed_at, voided_by, voided_at, void_reason,
                currency, currency_scale, total_amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'EGP', 2, 0)
        """, (
            po_num, prov_id, prov_name, status,
            f"أمر شراء توريدات لصالح {random.choice(DESTINATIONS)}",
            office_id, created_at, expires_at, dispatched_at, dispatched_by,
            received_by, closed_at, voided_by, voided_at, void_reason
        ))
        po_id = cursor.lastrowid
        
        # Add 2-6 line items
        po_items_sample = random.sample(inserted_items, random.randint(2, 6))
        total_piasters = 0
        for it in po_items_sample:
            qty_req = random.randint(10, 100)
            qty_ord = qty_req
            unit_price_piasters = int(it["cost"] * 100)
            line_total = qty_ord * unit_price_piasters
            total_piasters += line_total
            qty_rec = qty_ord if status == "closed" else 0
            
            cursor.execute("""
                INSERT INTO purchase_order_items (
                    po_id, item_id, item_name, unit_id, unit_name,
                    line_description, requested_quantity, ordered_quantity,
                    unit_price, line_total, received_quantity
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                po_id, it["id"], it["name"], it["unit_id"], it["unit_name"],
                f"توريد بند مطابق للمواصفة القياسية",
                qty_req, qty_ord, unit_price_piasters, line_total, qty_rec
            ))
            
        # Update PO total_amount
        cursor.execute("UPDATE purchase_orders SET total_amount = ? WHERE id = ?", (total_piasters, po_id))
        
    print(f"  ✓ {len(po_statuses)} Purchase Orders generated.")
    
    # 8. Generate Leave Orders (approx 50 LOs)
    print("  📑 Generating Leave Orders (Disbursement Tickets)...")
    lo_statuses = ["open"] * 15 + ["closed"] * 25 + ["rejected"] * 8 + ["partially_returned"] * 2
    random.shuffle(lo_statuses)
    
    for idx, status in enumerate(lo_statuses, 1):
        order_num = f"LO-{datetime.datetime.now().year}-{idx:04d}"
        dest_name = random.choice(list(dest_map.keys()))
        dest_id = dest_map[dest_name]
        emp_name = random.choice(EMPLOYEES)
        
        now = datetime.datetime.now()
        created_at = (now - datetime.timedelta(days=random.randint(2, 20))).strftime("%Y-%m-%d %H:%M:%S")
        
        if status == "open":
            closed_by = None
            closed_at = None
            close_reason = None
            rejection_reason = None
            rejected_by = None
            rejected_at = None
        elif status == "closed":
            closed_by = warehouse_id
            closed_at = (now - datetime.timedelta(days=random.randint(1, 5))).strftime("%Y-%m-%d %H:%M:%S")
            close_reason = "تم الصرف بالكامل وتسليم المندوب بالموقع"
            rejection_reason = None
            rejected_by = None
            rejected_at = None
        elif status == "rejected":
            closed_by = None
            closed_at = None
            close_reason = None
            rejection_reason = random.choice([
                "الرصيد الفعلي بالمخزن لا يكفي الكمية المطلوبة بالكامل",
                "الأصناف المطلوبة محجوزة لأمر عمل طارئ آخر",
                "مواصفة الصنف المكتوبة بالطلب غير متطابقة مع العينة المطلوبة",
                "لم يحضر مندوب الاستلام المفوض من الموقع"
            ])
            rejected_by = warehouse_id
            rejected_at = (now - datetime.timedelta(days=random.randint(1, 4))).strftime("%Y-%m-%d %H:%M:%S")
        elif status == "partially_returned":
            closed_by = warehouse_id
            closed_at = (now - datetime.timedelta(days=random.randint(6, 12))).strftime("%Y-%m-%d %H:%M:%S")
            close_reason = "تم الصرف بالكامل وتسليم المندوب بالموقع"
            rejection_reason = None
            rejected_by = None
            rejected_at = None
            
        cursor.execute("""
            INSERT INTO leave_orders (
                order_number, employee_name, destination_id, destination_name,
                status, notes, created_by, created_at, revision,
                closed_by, closed_at, close_reason,
                rejection_reason, rejected_by, rejected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        """, (
            order_num, emp_name, dest_id, dest_name,
            status, f"إذن صرف مهمات ومواد تشغيل لـ {dest_name}",
            office_id, created_at,
            closed_by, closed_at, close_reason,
            rejection_reason, rejected_by, rejected_at
        ))
        lo_id = cursor.lastrowid
        
        # If rejected, insert rejection event
        if status == "rejected":
            cursor.execute("""
                INSERT INTO leave_order_rejection_events (
                    leave_order_id, reason, rejected_by, rejected_at, revision
                ) VALUES (?, ?, ?, ?, 0)
            """, (lo_id, rejection_reason, rejected_by, rejected_at))
            
        # Add 2-5 line items
        lo_items_sample = random.sample(inserted_items, random.randint(2, 5))
        for it in lo_items_sample:
            qty_req = random.randint(2, 20)
            if status in ("closed", "partially_returned"):
                qty_disp = qty_req
                qty_ret = random.randint(1, qty_disp) if status == "partially_returned" else 0
            else:
                qty_disp = 0
                qty_ret = 0
                
            cursor.execute("""
                INSERT INTO leave_order_items (
                    leave_order_id, item_id, item_name, unit_id, unit_name,
                    requested_quantity, dispensed_quantity, returned_quantity
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                lo_id, it["id"], it["name"], it["unit_id"], it["unit_name"],
                qty_req, qty_disp, qty_ret
            ))
            
    conn.commit()
    print(f"  ✓ {len(lo_statuses)} Leave Orders generated.")
    print("\n🎉 Database seeded successfully!")


def verify_database(conn):
    """Checks database integrity, row counts, and foreign keys."""
    cursor = conn.cursor()
    print("\n🔍 Running verification checks...")
    
    cursor.execute("PRAGMA integrity_check;")
    integ = cursor.fetchone()[0]
    print(f"  • Integrity Check: {integ}")
    
    cursor.execute("PRAGMA foreign_key_check;")
    fk_violations = cursor.fetchall()
    print(f"  • Foreign Key Violations: {len(fk_violations)}")
    if fk_violations:
        print(f"    ⚠️ Violations: {fk_violations}")
        
    tables = [
        "units", "categories", "destinations", "providers",
        "items", "movement_logs", "purchase_orders",
        "purchase_order_items", "leave_orders", "leave_order_items", "users"
    ]
    print("\n📊 Database Summary Metrics:")
    for t in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {t}")
            cnt = cursor.fetchone()[0]
            print(f"  • {t:<22}: {cnt:>6} rows")
        except Exception as e:
            print(f"  • {t:<22}: error ({e})")
            

def main():
    parser = argparse.ArgumentParser(description="Seed SkyCourt Warehouse with authentic fake domain data.")
    parser.add_argument("--count", type=int, default=600, help="Number of items to generate (default: 600)")
    parser.add_argument("--clean", action="store_true", help="Purge all existing domain data before seeding")
    parser.add_argument("--verify", action="store_true", help="Run verification checks on the database")
    args = parser.parse_args()
    
    conn = get_db()
    try:
        if args.clean:
            clean_database(conn)
            
        if not args.verify or args.clean or args.count:
            seed_data(conn, item_count=args.count)
            
        verify_database(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
