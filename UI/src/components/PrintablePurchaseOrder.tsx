import React from 'react';
import { PurchaseOrderDetail, BarcodeResponse } from '../services/poService';

interface PrintablePurchaseOrderProps {
  order: PurchaseOrderDetail;
  barcodeData: BarcodeResponse | null;
}

const formatSafeDate = (dateString?: string | null) => {
  if (!dateString) return '-';
  try {
    return new Date(dateString.replace(' ', 'T')).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dateString;
  }
};

const getStatusDisplay = (status: string) => {
  switch (status) {
    case 'open':
      return { text: 'مفتوح (معتمد)', color: '#166534', bg: '#dcfce7', border: '#86efac' };
    case 'closed':
      return { text: 'مغلق (تم الاستلام)', color: '#1e40af', bg: '#dbeafe', border: '#93c5fd' };
    case 'void':
      return { text: 'ملغي (VOID)', color: '#991b1b', bg: '#fee2e2', border: '#fca5a5' };
    case 'expired':
      return { text: 'منتهي الصلاحية (EXPIRED)', color: '#9a3412', bg: '#ffedd5', border: '#fdba74' };
    default:
      return { text: status, color: '#374151', bg: '#f3f4f6', border: '#d1d5db' };
  }
};

export const PrintablePurchaseOrder = React.forwardRef<HTMLDivElement, PrintablePurchaseOrderProps>(
  ({ order, barcodeData }, ref) => {
    const statusMeta = getStatusDisplay(order.status);
    const company = order.company || {
      name: 'شركة سكاي كورت للتجارة والتوزيع',
      address: 'القاهرة، جمهورية مصر العربية',
      phone: '+20 1068194494',
      email: 'oomarolayan.gamal@gmail.com'
    };

    return (
      <div
        ref={ref}
        className="printable-po"
        style={{
          width: '100%',
          padding: '12mm 15mm',
          direction: 'rtl',
          textAlign: 'right',
          fontFamily: "'Noto Sans Arabic', Arial, sans-serif",
          color: '#111827',
          backgroundColor: '#ffffff',
          boxSizing: 'border-box'
        }}
      >
        {/* Document Header with Company Identity and Barcode */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '2px solid #1f2937',
            paddingBottom: '16px',
            marginBottom: '20px'
          }}
        >
          {/* Company Info */}
          <div style={{ flex: '1 1 50%' }}>
            {company.logo_url && (
              <img
                src={company.logo_url}
                alt="Company Logo"
                style={{ maxHeight: '60px', marginBottom: '8px', objectFit: 'contain' }}
              />
            )}
            <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 4px 0', color: '#111827' }}>
              {company.name}
            </h1>
            <p style={{ margin: '0 0 2px 0', fontSize: '10pt', color: '#4b5563' }}>{company.address}</p>
            <p style={{ margin: '0 0 2px 0', fontSize: '10pt', color: '#4b5563', direction: 'ltr', textAlign: 'right' }}>
              {company.phone} | {company.email}
            </p>
          </div>

          {/* Barcode and Order Title */}
          <div style={{ flex: '0 0 45%', textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '11pt',
                fontWeight: 'bold',
                color: statusMeta.color,
                backgroundColor: statusMeta.bg,
                border: `1px solid ${statusMeta.border}`,
                marginBottom: '8px'
              }}
            >
              {statusMeta.text}
            </div>

            {barcodeData?.imageData && (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={`data:image/png;base64,${barcodeData.imageData}`}
                  alt={order.barcode}
                  style={{ maxHeight: '55px', maxWidth: '220px', objectFit: 'contain' }}
                />
                <div style={{ fontSize: '10pt', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '2px' }}>
                  {order.barcode}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Purchase Order Metadata Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '14px 16px',
            marginBottom: '20px',
            fontSize: '10.5pt'
          }}
        >
          <div>
            <span style={{ color: '#6b7280' }}>رقم أمر الشراء: </span>
            <strong style={{ fontFamily: 'monospace', fontSize: '11pt' }}>{order.po_number}</strong>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>المورد: </span>
            <strong>{order.provider_name}</strong>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>تاريخ الإنشاء: </span>
            <span>{formatSafeDate(order.created_at)}</span>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>صالح حتى: </span>
            <span>{formatSafeDate(order.expires_at)}</span>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>محرر الطلب: </span>
            <span>{order.creator_name || '-'}</span>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>إصدار الوثيقة (Revision): </span>
            <span style={{ fontFamily: 'monospace' }}>#{order.revision}</span>
          </div>

          {order.status === 'closed' && (
            <>
              <div>
                <span style={{ color: '#6b7280' }}>مستلم الشحنة: </span>
                <strong>{order.receiver_name || 'أمين المخزن'}</strong>
              </div>
              <div>
                <span style={{ color: '#6b7280' }}>تاريخ الاستلام: </span>
                <span>{formatSafeDate(order.closed_at)}</span>
              </div>
            </>
          )}

          {order.void_reason && (
            <div style={{ gridColumn: '1 / -1', color: '#991b1b', backgroundColor: '#fee2e2', padding: '6px 10px', borderRadius: '4px' }}>
              <strong>سبب الإلغاء / انتهاء الصلاحية: </strong>
              <span>{order.void_reason}</span> ({formatSafeDate(order.voided_at)})
            </div>
          )}

          {order.notes && (
            <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed #d1d5db', paddingTop: '8px', marginTop: '4px' }}>
              <span style={{ color: '#6b7280' }}>ملاحظات: </span>
              <span>{order.notes}</span>
            </div>
          )}
        </div>

        {/* Items Table with Multipage Support */}
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '10pt',
            marginBottom: '20px',
            wordBreak: 'break-word'
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#1f2937', color: '#ffffff' }}>
              <th style={{ border: '1px solid #374151', padding: '8px 10px', width: '5%', textAlign: 'center' }}>#</th>
              <th style={{ border: '1px solid #374151', padding: '8px 10px', width: order.status === 'closed' ? '25%' : '28%', textAlign: 'right' }}>الصنف</th>
              <th style={{ border: '1px solid #374151', padding: '8px 10px', width: order.status === 'closed' ? '10%' : '12%', textAlign: 'center' }}>الوحدة</th>
              <th style={{ border: '1px solid #374151', padding: '8px 10px', width: order.status === 'closed' ? '20%' : '25%', textAlign: 'right' }}>البيان / الوصف</th>
              <th style={{ border: '1px solid #374151', padding: '8px 10px', width: '10%', textAlign: 'center' }}>الكمية المطلوبة</th>
              {order.status === 'closed' && (
                <th style={{ border: '1px solid #374151', padding: '8px 10px', width: '10%', textAlign: 'center' }}>الكمية المستلمة</th>
              )}
              <th style={{ border: '1px solid #374151', padding: '8px 10px', width: '10%', textAlign: 'left' }}>سعر الوحدة ({order.currency})</th>
              <th style={{ border: '1px solid #374151', padding: '8px 10px', width: '10%', textAlign: 'left' }}>الإجمالي ({order.currency})</th>
            </tr>
          </thead>
          <tbody>
            {order.items && order.items.length > 0 ? (
              order.items.map((item, index) => {
                const isStruck = item.disposition === 'struck_off';
                return (
                  <tr
                    key={item.id || index}
                    style={{
                      backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px', textAlign: 'center' }}>{index + 1}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px', fontWeight: 'bold' }}>
                      <span style={{ textDecoration: isStruck ? 'line-through' : 'none', color: isStruck ? '#9ca3af' : 'inherit' }}>
                        {item.item_name}
                      </span>
                    </td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px', textAlign: 'center' }}>{item.unit_name}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px', color: '#4b5563' }}>{item.line_description || '-'}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px', textAlign: 'center', fontWeight: 'bold' }}>
                      {item.ordered_quantity}
                    </td>
                    {order.status === 'closed' && (
                      <td style={{ border: '1px solid #e5e7eb', padding: '8px', textAlign: 'center', color: isStruck ? '#b91c1c' : '#1e40af', fontWeight: 'bold' }}>
                        {isStruck ? '0 (مشطوب)' : (item.received_quantity ?? 0)}
                      </td>
                    )}
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px', textAlign: 'left', fontFamily: 'monospace' }}>
                      {item.unit_price}
                    </td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px', textAlign: 'left', fontFamily: 'monospace', fontWeight: 'bold' }}>
                      {item.line_total}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={order.status === 'closed' ? 8 : 7} style={{ border: '1px solid #e5e7eb', padding: '16px', textAlign: 'center', color: '#6b7280' }}>
                  لا توجد أصناف في هذا الأمر
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#f3f4f6', fontWeight: 'bold', fontSize: '11pt', pageBreakInside: 'avoid' }}>
              <td colSpan={order.status === 'closed' ? 6 : 5} style={{ border: '1px solid #d1d5db', padding: '10px 12px', textAlign: 'right' }}>
                الإجمالي الكلي ({order.currency}):
              </td>
              <td
                colSpan={2}
                style={{
                  border: '1px solid #d1d5db',
                  padding: '10px 12px',
                  textAlign: 'left',
                  fontFamily: 'monospace',
                  fontSize: '12pt',
                  color: '#1e40af'
                }}
              >
                {order.total_amount} {order.currency}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Document Footer: Summary & Signatures Area */}
        <div style={{ pageBreakInside: 'avoid', marginTop: '30px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderTop: '1px solid #d1d5db',
              paddingTop: '20px',
              marginBottom: '40px'
            }}
          >
            <div style={{ textAlign: 'center', flex: 1 }}>
              <p style={{ margin: '0 0 45px 0', fontWeight: 'bold', fontSize: '10pt', color: '#374151' }}>
                توقيع محرر الطلب
              </p>
              <p style={{ margin: 0, fontSize: '9pt', color: '#6b7280' }}>
                {order.creator_name || '................................'}
              </p>
            </div>

            <div style={{ textAlign: 'center', flex: 1 }}>
              <p style={{ margin: '0 0 45px 0', fontWeight: 'bold', fontSize: '10pt', color: '#374151' }}>
                اعتماد إدارة المشتريات / المالية
              </p>
              <p style={{ margin: 0, fontSize: '9pt', color: '#6b7280' }}>
                ................................
              </p>
            </div>

            <div style={{ textAlign: 'center', flex: 1 }}>
              <p style={{ margin: '0 0 45px 0', fontWeight: 'bold', fontSize: '10pt', color: '#374151' }}>
                استلام أمين المخزن
              </p>
              <p style={{ margin: 0, fontSize: '9pt', color: '#6b7280' }}>
                {order.receiver_name || '................................'}
              </p>
            </div>
          </div>

          <div
            style={{
              textAlign: 'center',
              fontSize: '8pt',
              color: '#9ca3af',
              borderTop: '1px solid #f3f4f6',
              paddingTop: '8px'
            }}
          >
            تم إنشاء هذه الوثيقة آلياً بواسطة منظومة SkyCourt Warehouse System • {new Date().toLocaleString('ar-EG')}
          </div>
        </div>
      </div>
    );
  }
);
