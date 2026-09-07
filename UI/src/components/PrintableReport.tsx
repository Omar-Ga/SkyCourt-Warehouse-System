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
        return 'إضافة';
      case 'Removal':
        return 'سحب';
      case 'Return':
        return 'مرتجع';
      default:
        return actionType;
    }
  };

  return (
    <div ref={ref} style={{ margin: '20px', direction: 'rtl', textAlign: 'right' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px', fontFamily: 'Arial, sans-serif', fontSize: '22pt', fontWeight: 'bold' }}>تقرير حركة المخزن</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12pt', fontFamily: 'Arial, sans-serif' }}>
        <thead>
          <tr style={{ backgroundColor: '#f2f2f2' }}>
            <th style={{ border: '1px solid #ddd', padding: '12px' }}>الصنف</th>
            <th style={{ border: '1px solid #ddd', padding: '12px' }}>الوجهة</th>
            <th style={{ border: '1px solid #ddd', padding: '12px' }}>التاريخ والوقت</th>
            <th style={{ border: '1px solid #ddd', padding: '12px' }}>بواسطة</th>
            <th style={{ border: '1px solid #ddd', padding: '12px' }}>نوع الحركة</th>
            <th style={{ border: '1px solid #ddd', padding: '12px' }}>الكمية</th>
            <th style={{ border: '1px solid #ddd', padding: '12px' }}>الرصيد</th>
          </tr>
        </thead>
        <tbody>
          {data.map((log) => {
            const reference = log.return_event_id
              ? ` (مرتجع #${log.return_event_id})`
              : log.leave_line_id
              ? ` (إذن صرف #${log.leave_line_id})`
              : log.po_line_id
              ? ` (أمر شراء #${log.po_line_id})`
              : '';
            const actor = log.actor_name || log.person_name || '-';
            const displayQty = log.quantity_changed !== null && log.quantity_changed !== undefined
              ? Math.abs(log.quantity_changed)
              : '-';

            return (
              <tr key={log.id}>
                <td style={{ border: '1px solid #ddd', padding: '12px' }}>
                  {log.item_name ? `${log.item_name} (#${log.item_id})` : 'N/A'}
                  {reference}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '12px' }}>{log.destination_name || '-'}</td>
                <td style={{ border: '1px solid #ddd', padding: '12px' }}>{formatSafeDate(log.timestamp)}</td>
                <td style={{ border: '1px solid #ddd', padding: '12px' }}>{actor}</td>
                <td style={{ border: '1px solid #ddd', padding: '12px' }}>{getActionTypeInArabic(log.action_type)}</td>
                <td style={{ border: '1px solid #ddd', padding: '12px' }}>{displayQty}</td>
                <td style={{ border: '1px solid #ddd', padding: '12px' }}>
                  {log.resulting_quantity !== null && log.resulting_quantity !== undefined ? log.resulting_quantity : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}); 