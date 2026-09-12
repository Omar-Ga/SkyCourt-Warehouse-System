import React from 'react';
import { PurchaseOrderDetail } from '../services/poService';
import { formatSafeDate } from '../services/statsService';

export const PrintablePurchaseOrder = React.forwardRef<HTMLDivElement, { order: PurchaseOrderDetail }>(({ order }, ref) => {
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open': return 'مفتوح بانتظار الاستلام بالمخزن';
      case 'closed': return 'مكتمل ومستلم بالكامل';
      case 'void': return 'ملغي';
      case 'expired': return 'منتهي الصلاحية';
      case 'draft': return 'مسودة قيد المراجعة';
      default: return status;
    }
  };

  return (
    <div ref={ref} style={{ padding: '20mm 18mm', direction: 'rtl', fontFamily: 'Cairo, "IBM Plex Sans Arabic", sans-serif', color: '#111827', backgroundColor: '#ffffff' }}>
      {/* 1. Official Letterhead Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #4B1E78', paddingBottom: '16px', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '900', color: '#4B1E78', margin: '0 0 4px 0', letterSpacing: '-0.5px' }}>
            سـكاي كـورت مـول — إدارة المشتريات والمخازن
          </h1>
          <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#6B7280', margin: 0 }}>
            SkyCourt Mall — Official Purchase & Procurement Document
          </p>
        </div>
        <div style={{ textAlign: 'left' }}>
          <img
            src="/assets/skycourt_logo_transparent.png"
            alt="SkyCourt Mall"
            style={{ height: '56px', width: 'auto', objectFit: 'contain' }}
          />
        </div>
      </div>

      {/* 2. Document Title and Metadata Box */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', marginBottom: '4px' }}>نوع المستند الرسمي</div>
          <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#111827', margin: 0 }}>
            أمر شراء وتوريد مواد
          </h2>
          <div style={{ marginTop: '8px', fontSize: '13px', color: '#374151' }}>
            <span style={{ fontWeight: 'bold' }}>اسم المورد المعتمد:</span> {order.provider_name}
          </div>
        </div>

        <div style={{ textAlign: 'left', minWidth: '220px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
            <span style={{ color: '#6B7280', fontWeight: 'bold' }}>رقم أمر الشراء:</span>
            <span style={{ fontWeight: '800', fontFamily: 'monospace', color: '#4B1E78' }}>{order.po_number}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
            <span style={{ color: '#6B7280', fontWeight: 'bold' }}>تاريخ الإرسال:</span>
            <span style={{ fontWeight: '600', color: '#111827' }}>{order.dispatched_at ? formatSafeDate(order.dispatched_at) : 'قيد الإعداد (مسودة)'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
            <span style={{ color: '#6B7280', fontWeight: 'bold' }}>تاريخ الانتهاء:</span>
            <span style={{ fontWeight: '600', color: '#111827' }}>{order.expires_at ? formatSafeDate(order.expires_at) : 'غير محدد'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#6B7280', fontWeight: 'bold' }}>حالة الأمر:</span>
            <span style={{ fontWeight: '700', color: '#4B1E78' }}>{getStatusLabel(order.status)}</span>
          </div>
        </div>
      </div>

      {/* 3. Items Detail Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '24px' }}>
        <thead>
          <tr style={{ backgroundColor: '#4B1E78', color: '#ffffff' }}>
            <th style={{ padding: '10px 12px', textAlign: 'right', border: '1px solid #4B1E78', borderRadius: '0' }}>#</th>
            <th style={{ padding: '10px 12px', textAlign: 'right', border: '1px solid #4B1E78' }}>الصنف والتوصيف الفني</th>
            <th style={{ padding: '10px 12px', textAlign: 'center', border: '1px solid #4B1E78' }}>الكمية المطلوبة</th>
            <th style={{ padding: '10px 12px', textAlign: 'center', border: '1px solid #4B1E78' }}>الكمية المعتمدة</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', border: '1px solid #4B1E78' }}>سعر الوحدة</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', border: '1px solid #4B1E78' }}>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((line, idx) => {
            const requested = Number(line.requested_quantity) || 0;
            const ordered = Number(line.ordered_quantity) || 0;
            const price = Number(line.unit_price) || 0;
            const lineTotal = ordered * price;

            return (
              <tr key={line.id} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                <td style={{ border: '1px solid #E5E7EB', padding: '10px 12px', textAlign: 'right', color: '#6B7280', fontWeight: 'bold' }}>
                  {idx + 1}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '10px 12px', fontWeight: '700', color: '#111827' }}>
                  {line.item_name}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '10px 12px', textAlign: 'center', color: '#4B5563', fontFamily: 'monospace' }}>
                  {requested}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '10px 12px', textAlign: 'center', fontWeight: 'bold', color: '#4B1E78', fontFamily: 'monospace' }}>
                  {requested !== ordered ? (
                    <span>
                      <span style={{ textDecoration: 'line-through', color: '#9CA3AF', marginRight: '4px' }}>{requested}</span>
                      <span>{ordered}</span>
                    </span>
                  ) : (
                    ordered
                  )}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '10px 12px', textAlign: 'left', fontFamily: 'monospace', color: '#374151' }}>
                  {price.toFixed(2)} {order.currency}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '10px 12px', textAlign: 'left', fontFamily: 'monospace', fontWeight: 'bold', color: '#111827' }}>
                  {lineTotal.toFixed(2)} {order.currency}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ backgroundColor: '#F3F4F6', fontWeight: 'bold' }}>
            <td colSpan={2} style={{ border: '1px solid #E5E7EB', padding: '12px', textAlign: 'right' }}>
              الإجمالي الكلي المعتمد للطلب:
            </td>
            <td style={{ border: '1px solid #E5E7EB', padding: '12px', textAlign: 'center', fontFamily: 'monospace', color: '#6B7280' }}>
              {order.items.reduce((s, i) => s + (Number(i.requested_quantity) || 0), 0)}
            </td>
            <td style={{ border: '1px solid #E5E7EB', padding: '12px', textAlign: 'center', fontFamily: 'monospace', color: '#4B1E78', fontSize: '13px' }}>
              {order.total_ordered_quantity}
            </td>
            <td style={{ border: '1px solid #E5E7EB', padding: '12px' }}></td>
            <td style={{ border: '1px solid #E5E7EB', padding: '12px', textAlign: 'left', fontFamily: 'monospace', color: '#4B1E78', fontSize: '14px', fontWeight: '900' }}>
              {order.total_amount} {order.currency}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* 4. Formal Verification & Signature Blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '48px', paddingTop: '24px', borderTop: '1px dashed #D1D5DB' }}>
        <div style={{ textAlign: 'center', padding: '12px', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', marginBottom: '36px' }}>إعداد موظف المشتريات / المكتب</div>
          <div style={{ borderTop: '1px solid #9CA3AF', width: '80%', margin: '0 auto', paddingTop: '6px', fontSize: '11px', color: '#374151' }}>التوقيع والتاريخ</div>
        </div>

        <div style={{ textAlign: 'center', padding: '12px', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', marginBottom: '36px' }}>فحص واستلام أمين المستودع</div>
          <div style={{ borderTop: '1px solid #9CA3AF', width: '80%', margin: '0 auto', paddingTop: '6px', fontSize: '11px', color: '#374151' }}>التوقيع وتاريخ الاستلام</div>
        </div>

        <div style={{ textAlign: 'center', padding: '12px', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', marginBottom: '36px' }}>اعتماد إدارة سكاي كورت والختم</div>
          <div style={{ borderTop: '1px solid #9CA3AF', width: '80%', margin: '0 auto', paddingTop: '6px', fontSize: '11px', color: '#374151' }}>الختم الرسمي</div>
        </div>
      </div>

      {/* 5. Document Security Notice */}
      <div style={{ marginTop: '32px', textAlign: 'center', fontSize: '10px', color: '#9CA3AF' }}>
        هذا المستند صادر إلكترونياً من نظام مستودعات سكاي كورت مول المركزي ولا يعتد به في حال وجود شطب أو تعديل يدوي غير معتمد.
      </div>
    </div>
  );
});
