import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactToPrint } from 'react-to-print';
import { Ban, Edit, Loader2, Printer, RefreshCw } from 'lucide-react';
import { PurchaseOrderDetail } from '../services/poService';
import { useDispatchPurchaseOrder, useVoidPurchaseOrder } from '../hooks/usePurchaseOrders';
import { generateIdempotencyKey } from '../services/apiClient';
import { formatSafeDate } from '../services/statsService';
import { PrintablePurchaseOrder } from './PrintablePurchaseOrder';
import { CreatePOModal } from './CreatePOModal';
import { Modal } from './Modal';

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  open: 'مفتوح',
  closed: 'مغلق',
  void: 'ملغي',
  expired: 'منتهي الصلاحية'
};

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
  const [isEditOpen, setIsEditOpen] = useState(false);
  const voidMutation = useVoidPurchaseOrder();
  const dispatchMutation = useDispatchPurchaseOrder();
  const print = useReactToPrint({ contentRef: printRef, ignoreGlobalStyles: true });

  if (!isOpen) return null;

  const submitVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!voidReason.trim() || !order) return;
    await voidMutation.mutateAsync({ id: order.id, input: { expected_revision: order.revision, reason: voidReason.trim() } });
    setShowVoid(false);
    setVoidReason('');
    onUpdated();
  };

  const dispatch = async () => {
    if (!order) return;
    await dispatchMutation.mutateAsync({ id: order.id, expected_revision: order.revision, idempotencyKey: generateIdempotencyKey() });
    onUpdated();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={order ? `أمر شراء: ${order.po_number}` : 'تفاصيل أمر الشراء'}
        size="xl"
        footer={
          order ? (
            <div className="flex justify-between items-center w-full">
              <div className="flex gap-2">
                {canVoid && order.status === 'draft' && (
                  <>
                    <button
                      type="button"
                      className="btn btn-outline flex items-center gap-1.5"
                      onClick={() => setIsEditOpen(true)}
                    >
                      <Edit size={15} />
                      <span>تعديل المسودة</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={dispatch}
                      disabled={dispatchMutation.isPending}
                    >
                      {dispatchMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                      <span>{dispatchMutation.isPending ? 'جارٍ الإرسال...' : 'إرسال للمورد'}</span>
                    </button>
                  </>
                )}
                {canVoid && order.allowed_actions?.includes('void') && (
                  <button type="button" className="btn btn-outline text-red-600 hover:bg-red-50" onClick={() => setShowVoid(true)}>
                    <Ban size={15} /> إلغاء
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onUpdated}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  title="تحديث البيانات يدويّاً"
                >
                  <RefreshCw size={18} />
                </button>
                <button type="button" className="btn btn-primary flex items-center gap-1.5" onClick={() => print()}>
                  <Printer size={15} /> طباعة
                </button>
                <button type="button" className="btn btn-outline" onClick={onClose}>
                  إغلاق
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {isLoading || !order ? (
          <div className="p-8 text-center text-gray-500">جاري تحميل التفاصيل...</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">الحالة:</span>
                <span className="badge badge-primary text-xs font-bold">
                  {STATUS_LABELS[order.status] || order.status}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                <span>المورد: <strong className="text-slate-800">{order.provider_name}</strong></span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50 rounded-lg p-4 text-xs">
              <div>
                <span className="text-gray-500 block mb-0.5">تاريخ الإنشاء:</span>
                <strong className="text-gray-800">{formatSafeDate(order.created_at)}</strong>
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">تاريخ الإرسال:</span>
                <strong className="text-gray-800">{order.dispatched_at ? formatSafeDate(order.dispatched_at) : 'لم يرسل بعد'}</strong>
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">تاريخ الانتهاء:</span>
                <strong className="text-gray-800">{order.expires_at ? formatSafeDate(order.expires_at) : 'لا يوجد'}</strong>
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">عدد البنود:</span>
                <strong className="text-gray-800">{order.items.length} أصناف</strong>
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-50 text-gray-700 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-2.5">الصنف</th>
                    <th className="p-2.5 text-center">الكمية المطلوبة</th>
                    <th className="p-2.5 text-center">الكمية المعتمدة</th>
                    <th className="p-2.5 text-center">السعر (ج.م)</th>
                    <th className="p-2.5">الوصف / البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {order.items.map((line) => (
                    <tr key={line.id} className="hover:bg-gray-50/50">
                      <td className="p-2.5 font-medium text-gray-900">{line.item_name}</td>
                      <td className="p-2.5 text-center text-gray-600">{line.requested_quantity}</td>
                      <td className="p-2.5 text-center font-bold text-emerald-700">
                        {line.requested_quantity !== line.ordered_quantity ? (
                          <><del className="text-gray-400 mr-1">{line.requested_quantity}</del> {line.ordered_quantity}</>
                        ) : (
                          line.ordered_quantity
                        )}
                      </td>
                      <td className="p-2.5 text-center font-mono">{line.unit_price}</td>
                      <td className="p-2.5 text-gray-500">{line.line_description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {order.notes && (
              <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-xs text-gray-700">
                <span className="font-bold text-blue-900 block mb-0.5">ملاحظات أمر الشراء:</span>
                {order.notes}
              </div>
            )}
          </div>
        )}
      </Modal>

      {order && typeof document !== 'undefined' && createPortal(<div style={{ display: 'none' }}><PrintablePurchaseOrder ref={printRef} order={order} /></div>, document.body)}

      {showVoid && (
        <Modal
          isOpen={showVoid}
          onClose={() => {
            setShowVoid(false);
            setVoidReason('');
          }}
          title="سبب إلغاء أمر الشراء"
          size="sm"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setShowVoid(false);
                  setVoidReason('');
                }}
              >
                تراجع
              </button>
              <button
                type="button"
                className="btn btn-danger bg-rose-600 hover:bg-rose-700 text-white border-rose-600"
                onClick={submitVoid}
                disabled={voidMutation.isPending || !voidReason.trim()}
              >
                {voidMutation.isPending ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed m-0">
              يرجى كتابة سبب الإلغاء بشكل واضح لحفظه في سجل الحركات:
            </p>
            <textarea
              className="input w-full text-sm p-3 border border-gray-200 rounded-xl"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="اكتب سبب إلغاء أمر الشراء هنا..."
              required
            />
          </div>
        </Modal>
      )}

      {isEditOpen && order && (
        <CreatePOModal
          isOpen={isEditOpen}
          initialPO={order}
          onClose={() => setIsEditOpen(false)}
          onCreated={() => {
            setIsEditOpen(false);
            onUpdated();
          }}
        />
      )}
    </>
  );
};
