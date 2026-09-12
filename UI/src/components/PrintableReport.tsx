import React from 'react';
import { MovementLogEntry } from '../types';
import { formatSafeDate } from '../services/statsService';

interface PrintableReportProps {
  data: MovementLogEntry[];
}

export const PrintableReport = React.forwardRef<HTMLDivElement, PrintableReportProps>((props, ref) => {
  const { data } = props;

  const getActionTypeInArabic = (actionType: string) => {
    switch (actionType) {
      case 'Addition':
        return 'توريد وارد';
      case 'Removal':
        return 'صرف صادر';
      case 'Return':
        return 'مرتجع للمخزن';
      default:
        return actionType;
    }
  };

  const totalAdditions = data
    .filter(l => l.action_type === 'Addition')
    .reduce((s, l) => s + Math.abs(l.quantity_changed || 0), 0);
  const totalRemovals = data
    .filter(l => l.action_type === 'Removal')
    .reduce((s, l) => s + Math.abs(l.quantity_changed || 0), 0);
  const totalReturns = data
    .filter(l => l.action_type === 'Return')
    .reduce((s, l) => s + Math.abs(l.quantity_changed || 0), 0);

  return (
    <div ref={ref} style={{ padding: '20mm 18mm', direction: 'rtl', fontFamily: 'Cairo, "IBM Plex Sans Arabic", sans-serif', color: '#111827', backgroundColor: '#ffffff' }}>
      {/* 1. Official Letterhead Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #4B1E78', paddingBottom: '16px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '900', color: '#4B1E78', margin: '0 0 4px 0', letterSpacing: '-0.5px' }}>
            سـكاي كـورت مـول — إدارة الرقابة والتدقيق المخزني
          </h1>
          <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#6B7280', margin: 0 }}>
            SkyCourt Mall — Official Warehouse Audit & Movement Report
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

      {/* 2. Document Title and Summary Strip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 20px', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#111827', margin: '0 0 4px 0' }}>
            تقرير سجل الحركات التفصيلي
          </h2>
          <div style={{ fontSize: '12px', color: '#4B5563' }}>
            إجمالي الحركات المستخرجة: <strong style={{ color: '#4B1E78' }}>{data.length} حركة</strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', textAlign: 'center' }}>
          <div style={{ backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '6px 12px' }}>
            <div style={{ fontSize: '10px', color: '#047857', fontWeight: 'bold' }}>إجمالي الوارد</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#065F46', fontFamily: 'monospace' }}>+{totalAdditions}</div>
          </div>
          <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '6px 12px' }}>
            <div style={{ fontSize: '10px', color: '#1D4ED8', fontWeight: 'bold' }}>إجمالي المنصرف</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1E40AF', fontFamily: 'monospace' }}>-{totalRemovals}</div>
          </div>
          <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '6px 12px' }}>
            <div style={{ fontSize: '10px', color: '#B45309', fontWeight: 'bold' }}>إجمالي المرتجع</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#92400E', fontFamily: 'monospace' }}>{totalReturns}</div>
          </div>
        </div>
      </div>

      {/* 3. Detailed Audit Movement Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '24px' }}>
        <thead>
          <tr style={{ backgroundColor: '#4B1E78', color: '#ffffff' }}>
            <th style={{ padding: '10px 8px', textAlign: 'right', border: '1px solid #4B1E78' }}>#</th>
            <th style={{ padding: '10px 8px', textAlign: 'right', border: '1px solid #4B1E78' }}>الصنف والرمز</th>
            <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #4B1E78' }}>نوع الحركة</th>
            <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #4B1E78' }}>الكمية</th>
            <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #4B1E78' }}>الرصيد بعدها</th>
            <th style={{ padding: '10px 8px', textAlign: 'right', border: '1px solid #4B1E78' }}>الجهة / المورد</th>
            <th style={{ padding: '10px 8px', textAlign: 'right', border: '1px solid #4B1E78' }}>المسؤول</th>
            <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #4B1E78' }}>التاريخ والوقت</th>
          </tr>
        </thead>
        <tbody>
          {data.map((log, idx) => {
            const reference = log.return_event_id
              ? ` [مرتجع #${log.return_event_id}]`
              : log.leave_line_id
              ? ` [إذن صرف #${log.leave_line_id}]`
              : log.po_line_id
              ? ` [أمر شراء #${log.po_line_id}]`
              : '';
            const actor = log.actor_name || log.person_name || 'النظام';
            const displayQty = log.quantity_changed !== null && log.quantity_changed !== undefined
              ? Math.abs(log.quantity_changed)
              : '-';

            const typeColor = log.action_type === 'Addition' ? '#047857' : log.action_type === 'Removal' ? '#1D4ED8' : '#B45309';

            return (
              <tr key={log.id} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', textAlign: 'right', color: '#6B7280' }}>
                  {idx + 1}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', fontWeight: 'bold', color: '#111827' }}>
                  {log.item_name} <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: 'normal' }}>{reference}</span>
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', textAlign: 'center', fontWeight: 'bold', color: typeColor }}>
                  {getActionTypeInArabic(log.action_type)}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', color: typeColor }}>
                  {log.action_type === 'Addition' ? `+${displayQty}` : log.action_type === 'Removal' ? `-${displayQty}` : displayQty}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', color: '#111827' }}>
                  {log.resulting_quantity !== null && log.resulting_quantity !== undefined ? log.resulting_quantity : '-'}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', color: '#374151' }}>
                  {log.destination_name || log.provider || '-'}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', color: '#374151' }}>
                  {actor}
                </td>
                <td style={{ border: '1px solid #E5E7EB', padding: '8px', textAlign: 'center', fontSize: '10px', color: '#6B7280' }}>
                  {formatSafeDate(log.timestamp)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 4. Audit Sign-off Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '40px', paddingTop: '20px', borderTop: '1px dashed #D1D5DB' }}>
        <div style={{ textAlign: 'center', padding: '12px', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', marginBottom: '36px' }}>مُعِد التقرير / موظف المكتب</div>
          <div style={{ borderTop: '1px solid #9CA3AF', width: '80%', margin: '0 auto', paddingTop: '6px', fontSize: '11px', color: '#374151' }}>التوقيع والتاريخ</div>
        </div>

        <div style={{ textAlign: 'center', padding: '12px', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', marginBottom: '36px' }}>مراجع التدقيق / أمين المخزن</div>
          <div style={{ borderTop: '1px solid #9CA3AF', width: '80%', margin: '0 auto', paddingTop: '6px', fontSize: '11px', color: '#374151' }}>التوقيع والتاريخ</div>
        </div>

        <div style={{ textAlign: 'center', padding: '12px', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', marginBottom: '36px' }}>اعتماد الإدارة العامة والختم</div>
          <div style={{ borderTop: '1px solid #9CA3AF', width: '80%', margin: '0 auto', paddingTop: '6px', fontSize: '11px', color: '#374151' }}>الختم الرسمي للمول</div>
        </div>
      </div>

      {/* 5. Document Security Notice */}
      <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '10px', color: '#9CA3AF' }}>
        سجل إلكتروني رسمي مستخرج من قاعدة بيانات سكai كورت المركزية. غير قابل للتعديل اليدوي ومحمي بنظام التحقق الداخلي.
      </div>
    </div>
  );
}); 