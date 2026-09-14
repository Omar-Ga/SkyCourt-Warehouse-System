import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import React from 'react';
import { renderToString } from 'react-dom/server';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic module container
let Table: React.ComponentType<any>;
let resolveColumnAlignment: (align?: 'right' | 'center' | 'left') => string;

// Contrast ratio helper using WCAG 2.1 Relative Luminance specification
function sRGBtoLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Milestone M2 Adversarial Challenge: Table.tsx & Primary Green Tokens', () => {
  before(async () => {
    // Compile Table.tsx and its dependency EmptyState.tsx into CommonJS bundle
    const tablePath = path.resolve(__dirname, '../src/components/Table.tsx');
    const result = await esbuild.build({
      entryPoints: [tablePath],
      bundle: true,
      write: false,
      format: 'cjs',
      external: ['react', 'react-dom', 'lucide-react'],
    });

    const code = result.outputFiles[0].text;
    const mod: { exports: { Table?: React.ComponentType<any>; resolveColumnAlignment?: (a?: any) => string } } = { exports: {} };
    const fn = new Function('require', 'module', 'exports', code);
    fn(require, mod, mod.exports);

    assert.ok(mod.exports.Table, 'Table component must be exported');
    assert.ok(mod.exports.resolveColumnAlignment, 'resolveColumnAlignment must be exported');

    Table = mod.exports.Table;
    resolveColumnAlignment = mod.exports.resolveColumnAlignment;
  });

  describe('Challenge Dimension 1: Generic Typing, Render Callbacks & Edge KeyFields', () => {
    interface InventoryRow {
      id: number;
      name: string;
      stock: number;
      category: { id: number; title: string };
      is_active?: boolean;
    }

    test('Generic typing: renders complex object rows with custom render callbacks', () => {
      const renderCalls: { val: unknown; row: InventoryRow; idx: number }[] = [];
      const columns = [
        {
          key: 'id',
          header: 'المعرف',
          align: 'center' as const,
        },
        {
          key: 'category',
          header: 'الفئة',
          render: (val: any, row: InventoryRow, idx: number) => {
            renderCalls.push({ val, row, idx });
            return React.createElement('span', { className: 'cat-badge' }, row.category.title);
          },
        },
        {
          key: 'stock',
          header: 'الرصيد',
          align: 'left' as const,
        },
      ];

      const data: InventoryRow[] = [
        { id: 101, name: 'لوح خشب زان', stock: 50, category: { id: 1, title: 'أخشاب' }, is_active: true },
        { id: 102, name: 'مسامير صلب 5 سم', stock: 1200, category: { id: 2, title: 'تثبيت' }, is_active: false },
      ];

      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'id',
        })
      );

      assert.equal(renderCalls.length, 2, 'Render callback should have been invoked for each row');
      assert.equal(renderCalls[0].row.id, 101);
      assert.equal(renderCalls[0].idx, 0);
      assert.equal(renderCalls[1].row.id, 102);
      assert.equal(renderCalls[1].idx, 1);
      assert.ok(html.includes('cat-badge'), 'Custom badge markup should be in the rendered HTML');
      assert.ok(html.includes('أخشاب'));
      assert.ok(html.includes('تثبيت'));
    });

    test('Falsy keyField (id = 0) resolves to 0 without fallback to row index', () => {
      const columns = [{ key: 'name', header: 'الاسم' }];
      const data = [
        { id: 0, name: 'العنصر الافتراضي الصفري' },
        { id: 42, name: 'عنصر قياسي' },
      ];

      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'id',
        })
      );

      assert.ok(html.includes('العنصر الافتراضي الصفري'));
      assert.ok(html.includes('عنصر قياسي'));
    });

    test('Nullish keyField falls back safely to index string without throwing', () => {
      const columns = [{ key: 'label', header: 'الوصف' }];
      const data = [
        { id: null, label: 'قيمة فارغة' },
        { id: undefined, label: 'قيمة غير معرّفة' },
      ];

      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'id',
        })
      );

      assert.ok(html.includes('قيمة فارغة'));
      assert.ok(html.includes('قيمة غير معرّفة'));
    });

    test('Row interaction: cursor-pointer applied only when onRowClick is provided', () => {
      const columns = [{ key: 'name', header: 'الاسم' }];
      const data = [{ id: 1, name: 'اختبار النقر' }];

      const htmlWithoutClick = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'id',
        })
      );
      assert.ok(!htmlWithoutClick.includes('cursor-pointer'), 'Should not have cursor-pointer without onRowClick');

      const htmlWithClick = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'id',
          onRowClick: () => {},
        })
      );
      assert.ok(htmlWithClick.includes('cursor-pointer'), 'Must have cursor-pointer with onRowClick');
    });

    test('Dynamic rowClassName generates contextual row styling', () => {
      const columns = [{ key: 'status', header: 'الحالة' }];
      const data = [
        { id: 1, status: 'critical', text: 'حرج' },
        { id: 2, status: 'normal', text: 'طبيعي' },
      ];

      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'id',
          rowClassName: (row: any) => (row.status === 'critical' ? 'bg-danger-50 text-danger-700' : 'bg-white'),
        })
      );

      assert.ok(html.includes('bg-danger-50 text-danger-700'), 'Critical row class must be present');
    });
  });

  describe('Challenge Dimension 2: Column Alignment Resolution & Width Enforcement', () => {
    test('resolveColumnAlignment resolves right, center, left, undefined, and unknown gracefully', () => {
      assert.equal(resolveColumnAlignment('right'), 'text-right');
      assert.equal(resolveColumnAlignment('center'), 'text-center');
      assert.equal(resolveColumnAlignment('left'), 'text-left');
      assert.equal(resolveColumnAlignment(undefined), 'text-right', 'Undefined should default to RTL right-align');
      assert.equal(resolveColumnAlignment('justify' as any), 'text-right', 'Invalid alignment should default to right');
      assert.equal(resolveColumnAlignment('' as any), 'text-right', 'Empty string should default to right');
    });

    test('Rendered <th> and <td> tags inherit exact alignment classes and width styles', () => {
      const columns = [
        { key: 'rightCol', header: 'يمين', align: 'right' as const, width: '200px' },
        { key: 'centerCol', header: 'وسط', align: 'center' as const, width: '15%' },
        { key: 'leftCol', header: 'يسار', align: 'left' as const },
        { key: 'defaultCol', header: 'افتراضي' },
      ];
      const data = [
        { id: 1, rightCol: 'قيمة 1', centerCol: 'قيمة 2', leftCol: 'قيمة 3', defaultCol: 'قيمة 4' },
      ];

      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'id',
        })
      );

      // Verify th alignment
      assert.ok(html.includes('py-3.5 px-4 font-bold text-xs tracking-tight text-right'));
      assert.ok(html.includes('py-3.5 px-4 font-bold text-xs tracking-tight text-center'));
      assert.ok(html.includes('py-3.5 px-4 font-bold text-xs tracking-tight text-left'));

      // Verify width styles on th
      assert.ok(html.includes('width:200px'));
      assert.ok(html.includes('width:15%'));

      // Verify td alignment
      assert.ok(html.includes('py-3.5 px-4 text-xs text-ink-900 text-right'));
      assert.ok(html.includes('py-3.5 px-4 text-xs text-ink-900 text-center'));
      assert.ok(html.includes('py-3.5 px-4 text-xs text-ink-900 text-left'));
    });
  });

  describe('Challenge Dimension 3: 5-Row Pulsing Skeleton Loader & Loading Bounds', () => {
    const columns = [
      { key: 'code', header: 'الكود', align: 'right' as const },
      { key: 'status', header: 'الحالة', align: 'center' as const },
      { key: 'qty', header: 'الكمية', align: 'left' as const },
    ];

    test('When isLoading=true, renders exactly 5 pulsing skeleton rows by default', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data: [],
          keyField: 'code',
          isLoading: true,
        })
      );

      // Match all tr elements with class animate-pulse
      const skeletonRows = html.match(/<tr [^>]*class="animate-pulse"/g);
      assert.ok(skeletonRows, 'Skeleton rows must be present');
      assert.equal(skeletonRows.length, 5, 'Default skeleton row count must be exactly 5');

      // Verify pulsing cells inside skeleton rows
      const skeletonCells = html.match(/<td [^>]*class="py-3.5 px-4 [^"]*"/g);
      assert.ok(skeletonCells);
      assert.equal(skeletonCells.length, 5 * 3, '5 rows * 3 columns = 15 cells total');

      // Verify alignment-specific skeleton bars
      assert.ok(html.includes('mx-auto w-12'), 'Center skeleton bar has mx-auto w-12');
      assert.ok(html.includes('w-16'), 'Left skeleton bar has w-16');
      assert.ok(html.includes('w-3/4'), 'Right skeleton bar has w-3/4');
    });

    test('Custom skeletonRows prop renders exact requested number of rows', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data: [],
          keyField: 'code',
          isLoading: true,
          skeletonRows: 8,
        })
      );

      const skeletonRows = html.match(/<tr [^>]*class="animate-pulse"/g);
      assert.equal(skeletonRows?.length, 8, 'Should render exactly 8 skeleton rows');
    });

    test('Edge case: 0 or negative skeletonRows handles gracefully without crash', () => {
      const htmlZero = renderToString(
        React.createElement(Table, {
          columns,
          data: [],
          keyField: 'code',
          isLoading: true,
          skeletonRows: 0,
        })
      );
      assert.ok(!htmlZero.includes('animate-pulse'), 'Should render 0 skeleton rows for 0');

      const htmlNegative = renderToString(
        React.createElement(Table, {
          columns,
          data: [],
          keyField: 'code',
          isLoading: true,
          skeletonRows: -5,
        })
      );
      assert.ok(!htmlNegative.includes('animate-pulse'), 'Should render 0 skeleton rows for negative count');
    });

    test('When isLoading=true, data rows and empty state are strictly suppressed', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data: [{ code: 'PO-999', status: 'نشط', qty: 100 }],
          keyField: 'code',
          isLoading: true,
          emptyTitle: 'لا توجد بيانات',
        })
      );

      assert.ok(!html.includes('PO-999'), 'Data row must NOT be rendered when isLoading=true');
      assert.ok(!html.includes('لا توجد بيانات'), 'Empty state must NOT be rendered when isLoading=true');
    });
  });

  describe('Challenge Dimension 4: Empty State Display & Custom Action Hooks', () => {
    const columns = [
      { key: 'id', header: 'المعرف' },
      { key: 'desc', header: 'البيان' },
    ];

    test('When data is empty, renders default EmptyState with full column span', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data: [],
          keyField: 'id',
          isLoading: false,
        })
      );

      assert.ok(html.includes('colSpan="2"'), 'Must span all 2 columns');
      assert.ok(html.includes('لا توجد بيانات للعرض'), 'Default empty title must be present');
      assert.ok(html.includes('لم يتم العثور على أي عناصر مسجلة'), 'Default description must be present');
    });

    test('Custom empty title, description, and action button are rendered', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data: [],
          keyField: 'id',
          isLoading: false,
          emptyTitle: 'لا توجد أذونات صرف معلقة',
          emptyDescription: 'اضغط على الزر أدناه لإنشاء إذن صرف جديد للمستودع.',
          emptyActionLabel: 'إنشاء إذن جديد',
          emptyOnAction: () => {},
        })
      );

      assert.ok(html.includes('لا توجد أذونات صرف معلقة'));
      assert.ok(html.includes('اضغط على الزر أدناه'));
      assert.ok(html.includes('إنشاء إذن جديد'));
      assert.ok(html.includes('bg-primary-600'), 'Action button should use primary-600 styling');
    });

    test('Custom emptyState ReactNode replaces EmptyState component entirely', () => {
      const customNode = React.createElement('div', { id: 'my-custom-empty-view' }, 'محتوى مخصص فارغ تماماً');
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data: [],
          keyField: 'id',
          emptyState: customNode,
        })
      );

      assert.ok(html.includes('my-custom-empty-view'));
      assert.ok(html.includes('محتوى مخصص فارغ تماماً'));
      assert.ok(!html.includes('لا توجد بيانات للعرض'), 'Default EmptyState must not appear');
    });
  });

  describe('Challenge Dimension 5: Pagination Bounds & RTL Directional Chevrons', () => {
    const columns = [{ key: 'num', header: 'الرقم' }];
    const data = [{ num: 1 }];

    test('No pagination footer when pagination prop is omitted', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'num',
        })
      );
      assert.ok(!html.includes('الصفحة'), 'No page summary rendered when pagination is omitted');
    });

    test('Single page with items: renders item count summary but hides previous/next buttons', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'num',
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalItems: 8,
            onPageChange: () => {},
          },
        })
      );

      const cleanHtml = html.replace(/<!--.*?-->/g, '');
      assert.ok(cleanHtml.includes('إجمالي النتائج: <strong class="text-ink-900">8</strong>'));
      assert.ok(cleanHtml.includes('الصفحة <strong class="text-ink-900">1</strong> من <strong class="text-ink-900">1</strong>'));
      assert.ok(!cleanHtml.includes('السابق'), 'Previous button should NOT be rendered when totalPages <= 1');
      assert.ok(!cleanHtml.includes('التالي'), 'Next button should NOT be rendered when totalPages <= 1');
    });

    test('Multi-page on First Page: Previous button is disabled with ChevronRight; Next button is enabled with ChevronLeft', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'num',
          pagination: {
            currentPage: 1,
            totalPages: 4,
            totalItems: 40,
            onPageChange: () => {},
          },
        })
      );

      const cleanHtml = html.replace(/<!--.*?-->/g, '');
      assert.ok(cleanHtml.includes('الصفحة <strong class="text-ink-900">1</strong> من <strong class="text-ink-900">4</strong>'));

      // Check Previous button is disabled
      assert.ok(html.includes('disabled=""'), 'At least one button must be disabled');
      assert.ok(html.includes('السابق'));
      assert.ok(html.includes('التالي'));

      // Lucide icon check: ChevronRight renders for Previous (RTL backwards is right)
      // ChevronLeft renders for Next (RTL forwards is left)
      assert.ok(html.includes('lucide-chevron-right'), 'Previous button must render ChevronRight in RTL');
      assert.ok(html.includes('lucide-chevron-left'), 'Next button must render ChevronLeft in RTL');
    });

    test('Multi-page on Last Page: Previous button enabled, Next button disabled', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'num',
          pagination: {
            currentPage: 4,
            totalPages: 4,
            totalItems: 40,
            onPageChange: () => {},
          },
        })
      );

      // Verify buttons rendered and Next button is disabled
      const buttons = html.match(/<button [^>]*>/g);
      assert.ok(buttons && buttons.length === 2);
      // Button 1 (Previous) should not be disabled; Button 2 (Next) should be disabled
      assert.ok(!buttons[0].includes('disabled=""'), 'Previous button must NOT be disabled on page 4 of 4');
      assert.ok(buttons[1].includes('disabled=""'), 'Next button MUST be disabled on page 4 of 4');
    });

    test('Multi-page on Middle Page: Both Previous and Next buttons are enabled', () => {
      const html = renderToString(
        React.createElement(Table, {
          columns,
          data,
          keyField: 'num',
          pagination: {
            currentPage: 2,
            totalPages: 4,
            totalItems: 40,
            onPageChange: () => {},
          },
        })
      );

      const buttons = html.match(/<button [^>]*>/g);
      assert.ok(buttons && buttons.length === 2);
      assert.ok(!buttons[0].includes('disabled=""'), 'Previous must be enabled');
      assert.ok(!buttons[1].includes('disabled=""'), 'Next must be enabled');
    });
  });

  describe('Challenge Dimension 6: Primary Green Color Tokens, WCAG Contrast & Purge Verification', () => {
    test('tailwind.config.js primary green is centered at #1E7D46 and brand.violet is deprecated', () => {
      const tailwindPath = path.resolve(__dirname, '../tailwind.config.js');
      const content = fs.readFileSync(tailwindPath, 'utf8');

      assert.ok(content.includes("600: '#1E7D46'"), "primary-600 must be '#1E7D46'");
      assert.ok(content.includes("green: '#1E7D46'"), "brand.green must be '#1E7D46'");
      assert.ok(content.includes('Deprecated'), 'brand.violet should be marked deprecated');
    });

    test('index.css declares --color-primary as RGB 30, 125, 70 (#1E7D46)', () => {
      const cssPath = path.resolve(__dirname, '../src/index.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      assert.ok(css.includes('--color-primary: 30, 125, 70;'), '--color-primary must be RGB 30, 125, 70');
      // Line count under 60
      const lineCount = css.trim().split('\n').length;
      assert.ok(lineCount < 60, `index.css line count (${lineCount}) must be strictly under 60 lines`);
    });

    test('WCAG 2.1 Contrast Ratio of #1E7D46 meets or exceeds AA standard (>= 4.5:1 for normal text, >= 3:1 for large)', () => {
      const brandGreen = '#1E7D46';
      const pureWhite = '#FFFFFF';
      const canvasBg = '#F5F8F7';
      const primary50 = '#F0FDF4';

      // 1. White text on primary green button (#FFFFFF on #1E7D46)
      const contrastBtn = getContrastRatio(pureWhite, brandGreen);
      assert.ok(contrastBtn >= 4.5, `Contrast on primary button (${contrastBtn.toFixed(2)}:1) must meet AA (>= 4.5:1)`);

      // 2. Primary green text on surface canvas (#1E7D46 on #F5F8F7)
      const contrastCanvas = getContrastRatio(brandGreen, canvasBg);
      assert.ok(contrastCanvas >= 4.5, `Contrast on canvas (${contrastCanvas.toFixed(2)}:1) must meet AA (>= 4.5:1)`);

      // 3. Primary green text on light tint background (#1E7D46 on #F0FDF4)
      const contrastTint = getContrastRatio(brandGreen, primary50);
      assert.ok(contrastTint >= 4.5, `Contrast on primary-50 tint (${contrastTint.toFixed(2)}:1) must meet AA (>= 4.5:1)`);
    });

    test('Zero instances of legacy classes (btn-primary, btn-outline, etc.) or active brand-violet in UI/src', () => {
      const srcDir = path.resolve(__dirname, '../src');
      const legacyPattern = /\b(btn-primary|btn-outline|btn-danger|brand-violet)\b/;

      const violations: string[] = [];
      function scanDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.css'))) {
            const text = fs.readFileSync(fullPath, 'utf8');
            if (legacyPattern.test(text)) {
              violations.push(fullPath);
            }
          }
        }
      }

      scanDir(srcDir);
      assert.equal(violations.length, 0, `Found legacy class / violet violations in: ${violations.join(', ')}`);
    });

    test('Zero instances of Eastern Arabic-Indic numerals [٠-٩] across UI/src', () => {
      const srcDir = path.resolve(__dirname, '../src');
      const arabicIndicPattern = /[\u0660-\u0669]/;

      const violations: string[] = [];
      function scanDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.css') || entry.name.endsWith('.html'))) {
            const text = fs.readFileSync(fullPath, 'utf8');
            if (arabicIndicPattern.test(text)) {
              violations.push(fullPath);
            }
          }
        }
      }

      scanDir(srcDir);
      assert.equal(violations.length, 0, `Found Arabic-Indic numerals in: ${violations.join(', ')}`);
    });
  });
});
