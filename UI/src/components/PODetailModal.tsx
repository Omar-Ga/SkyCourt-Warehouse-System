import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactToPrint } from 'react-to-print';
import { Ban, FileText, Printer, X } from 'lucide-react';
import { PurchaseOrderDetail } from '../services/poService';
import { useDispatchPurchaseOrder, useVoidPurchaseOrder } from '../hooks/usePurchaseOrders';
import { generateIdempotencyKey } from '../services/apiClient';
import { PrintablePurchaseOrder } from './PrintablePurchaseOrder';

export const PODetailModal: React.FC<{
  order: PurchaseOrderDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  canVoid: boolean;
  isLoading?: boolean;
}> = ({ order, isOpen, onClose, onUpdated, canVoid, isLoading = false }) => {
  const printRef = useRef<HTMLDivElement>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const voidMutation = useVoidPurchaseOrder();
  const dispatchMutation = useDispatchPurchaseOrder();
  const print = useReactToPrint({ contentRef: printRef, ignoreGlobalStyles: true });
  if (!isOpen) return null;
  if (isLoading || !order) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><div className="bg-white rounded-lg p-8">جاري تحميل التفاصيل...</div></div>;

  const submitVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!voidReason.trim()) return;
    await voidMutation.mutateAsync({ id: order.id, input: { expected_revision: order.revision, reason: voidReason.trim() } });
    setShowVoid(false);
    setVoidReason('');
    onUpdated();
  };

  const dispatch = async () => {
    await dispatchMutation.mutateAsync({ id: order.id, expected_revision: order.revision, idempotencyKey: generateIdempotencyKey() });
    onUpdated();
  };

  return <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
      <header className="flex items-center justify-between p-5 border-b"><div className="flex items-center gap-2"><FileText className="text-primary-600" /><h2 className="text-xl font-bold">{order.po_number}</h2><span className="badge badge-primary">{order.status}</span></div><button onClick={onClose}><X /></button></header>
      <div className="overflow-y-auto p-6 space-y-5"><div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50 rounded-lg p-4 text-sm"><span>المورد: <strong>{order.provider_name}</strong></span><span>الإنشاء: <strong>{order.created_at}</strong></span><span>الإرسال: <strong>{order.dispatched_at || 'لم يرسل'}</strong></span><span>الانتهاء: <strong>{order.expires_at || 'لا يوجد'}</strong></span></div>
        <table className="w-full text-right text-sm"><thead className="bg-gray-50"><tr><th className="p-2">الصنف</th><th className="p-2">المطلوب</th><th className="p-2">المعتمد</th><th className="p-2">السعر</th><th className="p-2">الوصف</th></tr></thead><tbody className="divide-y">{order.items.map((line) => <tr key={line.id}><td className="p-2">{line.item_name}</td><td className="p-2">{line.requested_quantity}</td><td className="p-2 font-semibold">{line.requested_quantity !== line.ordered_quantity ? <><del>{line.requested_quantity}</del> {line.ordered_quantity}</> : line.ordered_quantity}</td><td className="p-2">{line.unit_price}</td><td className="p-2">{line.line_description || '-'}</td></tr>)}</tbody></table>
        {order.notes && <p className="text-sm text-gray-600">ملاحظات: {order.notes}</p>}</div>
      <footer className="flex justify-between p-5 border-t bg-gray-50"><div className="flex gap-2">{canVoid && order.status === 'draft' && <button className="btn btn-primary" onClick={dispatch} disabled={dispatchMutation.isPending}>إرسال للمخزن</button>}{canVoid && order.allowed_actions?.includes('void') && <button className="btn btn-outline text-red-600" onClick={() => setShowVoid(true)}><Ban size={15} /> إلغاء</button>}</div><div className="flex gap-2"><button className="btn btn-primary" onClick={() => print()}><Printer size={15} /> طباعة</button><button className="btn btn-outline" onClick={onClose}>إغلاق</button></div></footer>
    </div></div>
    {typeof document !== 'undefined' && createPortal(<div style={{ display: 'none' }}><PrintablePurchaseOrder ref={printRef} order={order} /></div>, document.body)}
    {showVoid && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"><form onSubmit={submitVoid} className="bg-white rounded-xl p-6 w-full max-w-md space-y-4"><h3 className="font-bold">سبب إلغاء أمر الشراء</h3><textarea className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} required /><div className="flex justify-end gap-2"><button type="button" className="btn btn-outline" onClick={() => setShowVoid(false)}>تراجع</button><button className="btn btn-danger" disabled={voidMutation.isPending}>تأكيد</button></div></form></div>}
  </>;
};
