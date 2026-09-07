import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import {
  PurchaseOrderDetail,
  ReceivePOResponse,
  getPurchaseOrderDetail
} from '../services/poService';
import { useReceivePurchaseOrder } from '../hooks/usePurchaseOrders';
import { generateIdempotencyKey } from '../services/apiClient';
import { PackageCheck, CheckCircle2, Ban, AlertCircle, AlertTriangle } from 'lucide-react';

interface POReceiptModalProps {
  order: PurchaseOrderDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (response: ReceivePOResponse) => void;
}

interface LineEdit {
  received_quantity: number | '';
  disposition: 'received' | 'struck_off';
}

export const POReceiptModal: React.FC<POReceiptModalProps> = ({
  order,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [currentOrder, setCurrentOrder] = useState<PurchaseOrderDetail | null>(order);
  const [lineEdits, setLineEdits] = useState<Record<number, LineEdit>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState<string>(() => generateIdempotencyKey());

  const receiveMutation = useReceivePurchaseOrder();

  // Initialize line edits when order changes or modal opens
  useEffect(() => {
    setCurrentOrder(order);
    if (order && order.items) {
      const initialEdits: Record<number, LineEdit> = {};
      order.items.forEach((item) => {
        initialEdits[item.id] = {
          received_quantity: item.ordered_quantity,
          disposition: 'received'
        };
      });
      setLineEdits(initialEdits);
    } else {
      setLineEdits({});
    }
    setErrorMsg(null);
    setConflictNotice(null);
    setSubmissionKey(generateIdempotencyKey());
  }, [order, isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setErrorMsg(null);
    setConflictNotice(null);
    onClose();
  };

  const handleQuantityChange = (lineId: number, orderedQty: number, val: string) => {
    if (val === '') {
      setLineEdits((prev) => ({
        ...prev,
        [lineId]: { received_quantity: '', disposition: 'received' }
      }));
      return;
    }
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 0) return;
    const clamped = Math.min(num, orderedQty);
    setLineEdits((prev) => ({
      ...prev,
      [lineId]: {
        received_quantity: clamped,
        disposition: clamped === 0 ? 'struck_off' : 'received'
      }
    }));
  };

  const handleToggleDisposition = (lineId: number, orderedQty: number, disposition: 'received' | 'struck_off') => {
    setLineEdits((prev) => ({
      ...prev,
      [lineId]: {
        disposition,
        received_quantity: disposition === 'struck_off' ? 0 : (prev[lineId]?.received_quantity || orderedQty)
      }
    }));
  };

  const handleReceiveAll = () => {
    if (!currentOrder) return;
    const fullEdits: Record<number, LineEdit> = {};
    currentOrder.items.forEach((item) => {
      fullEdits[item.id] = {
        received_quantity: item.ordered_quantity,
        disposition: 'received'
      };
    });
    setLineEdits(fullEdits);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentOrder || receiveMutation.isPending) return;

    setErrorMsg(null);
    setConflictNotice(null);

    // Build line items payload
    const itemsPayload: { line_id: number; received_quantity: number; disposition: 'received' | 'struck_off' }[] = [];
    let positiveCount = 0;

    for (const line of currentOrder.items) {
      const edit = lineEdits[line.id] || { disposition: 'received', received_quantity: line.ordered_quantity };
      const qty = typeof edit.received_quantity === 'number' ? edit.received_quantity : 0;
      const disp = edit.disposition;

      if (disp === 'received') {
        if (qty <= 0) {
          setErrorMsg(`الصنف "${line.item_name}" محدد كمستلم ولكن كميته صفر. يرجى تحديد كمية أكبر من صفر أو شطب البند.`);
          return;
        }
        if (qty > line.ordered_quantity) {
          setErrorMsg(`الكمية المستلمة للصنف "${line.item_name}" تتجاوز الكمية المطلوبة (${line.ordered_quantity}).`);
          return;
        }
        positiveCount++;
      } else {
        if (qty !== 0) {
          setErrorMsg(`الصنف "${line.item_name}" مشطوب وتجب أن تكون كميته صفر.`);
          return;
        }
      }

      itemsPayload.push({
        line_id: line.id,
        received_quantity: qty,
        disposition: disp
      });
    }

    if (positiveCount === 0) {
      setErrorMsg('يجب استلام صنف واحد على الأقل بكمية موجبة. إذا لم يصل أي صنف يرجى ترك الطلب مفتوحاً أو إلغاؤه من المكتب.');
      return;
    }

    try {
      const res = await receiveMutation.mutateAsync({
        id: currentOrder.id,
        input: {
          expected_revision: currentOrder.revision,
          items: itemsPayload
        },
        idempotencyKey: submissionKey
      });

      handleClose();
      if (onSuccess) onSuccess(res);
    } catch (err: any) {
      // Stale or conflicting request handling: fetch latest state while preserving operator edits
      if (err.status === 409 || err.code === 'REVISION_CONFLICT' || err.code === 'STATE_CONFLICT' || err.code === 'ORDER_EXPIRED') {
        try {
          const fresh = await getPurchaseOrderDetail(currentOrder.id);
          setCurrentOrder(fresh);
          setSubmissionKey(generateIdempotencyKey());

          if (fresh.status === 'closed') {
            setErrorMsg('تم استلام هذا الطلب مسبقاً وإغلاقه.');
            if (onSuccess) {
              onSuccess({ ...fresh, affected_balances: [] });
            }
            return;
          }
          if (fresh.status === 'void' || fresh.status === 'expired') {
            setErrorMsg(`أمر الشراء أصبح بحالة (${fresh.status === 'expired' ? 'منتهي الصلاحية' : 'ملغي'}) ولا يمكن استلامه.`);
            return;
          }

          setConflictNotice('تم تحديث بيانات أمر الشراء لتطابق أحدث إصدار مع الاحتفاظ بالكميات التي قمت بإدخالها. يرجى مراجعتها والضغط على تأكيد الاستلام.');
          return;
        } catch (fetchErr) {
          console.error('Failed to fetch fresh PO detail after conflict:', fetchErr);
        }
      }

      setErrorMsg(err.message || 'فشل في استلام أمر الشراء.');
    }
  };

  const totalLines = currentOrder?.items.length || 0;
  const receivedLinesCount = currentOrder?.items.filter(
    (item) => (lineEdits[item.id]?.disposition || 'received') === 'received'
  ).length || 0;
  const isShortReceipt = receivedLinesCount < totalLines || currentOrder?.items.some((item) => {
    const edit = lineEdits[item.id];
    return edit && edit.disposition === 'received' && (typeof edit.received_quantity === 'number' && edit.received_quantity < item.ordered_quantity);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={currentOrder ? `تأكيد استلام أمر الشراء: ${currentOrder.po_number}` : 'استلام أمر الشراء'}
      size="xl"
      footer={
        <div className="flex justify-between items-center w-full">
          <button
            type="button"
            className="btn btn-sm btn-outline text-xs"
            onClick={handleReceiveAll}
            disabled={receiveMutation.isPending || !currentOrder}
          >
            استلام كامل الشحنة المطابقة
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline text-xs"
              onClick={handleClose}
              disabled={receiveMutation.isPending}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary flex items-center gap-1.5 text-xs font-semibold"
              onClick={() => handleSubmit()}
              disabled={receiveMutation.isPending || !currentOrder}
            >
              <PackageCheck size={16} />
              {receiveMutation.isPending ? 'جاري تأكيد الاستلام...' : 'تأكيد استلام الشحنة'}
            </button>
          </div>
        </div>
      }
    >
      {!currentOrder ? (
        <div className="p-8 text-center text-gray-500">جاري تحميل تفاصيل أمر الشراء...</div>
      ) : (
        <div className="space-y-4">
          {/* Header Metadata */}
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-gray-500 block">المورد:</span>
              <strong className="text-gray-900">{currentOrder.provider_name}</strong>
            </div>
            <div>
              <span className="text-gray-500 block">محرر الطلب:</span>
              <strong className="text-gray-900">{currentOrder.creator_name || '-'}</strong>
            </div>
            <div>
              <span className="text-gray-500 block">صالح حتى:</span>
              <strong className="text-gray-900">{currentOrder.expires_at}</strong>
            </div>
            <div>
              <span className="text-gray-500 block">إصدار الوثيقة:</span>
              <strong className="text-gray-900">#{currentOrder.revision}</strong>
            </div>
          </div>

          {/* Conflict Notification Banner */}
          {conflictNotice && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs flex items-center gap-2">
              <AlertTriangle size={18} className="flex-shrink-0" />
              <span>{conflictNotice}</span>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle size={18} className="flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Short Receipt Notice */}
          {isShortReceipt && (
            <div className="p-2.5 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>
                <strong>تنبيه الاستلام الجزئي:</strong> استلام الشحنة نهائي؛ سيتم إغلاق أمر الشراء ولن تظل الكميات المتبقية قابلة للاستلام لاحقاً.
              </span>
            </div>
          )}

          {/* Line Items Table */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr>
                  <th className="py-2 px-3 w-8 text-center">#</th>
                  <th className="py-2 px-3">الصنف</th>
                  <th className="py-2 px-3 text-center">الوحدة</th>
                  <th className="py-2 px-3 text-center">الكمية المطلوبة</th>
                  <th className="py-2 px-3 text-center w-36">الكمية المستلمة</th>
                  <th className="py-2 px-3 text-center w-40">حالة البند</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {currentOrder.items.map((line, idx) => {
                  const edit = lineEdits[line.id] || {
                    received_quantity: line.ordered_quantity,
                    disposition: 'received'
                  };
                  const isStruck = edit.disposition === 'struck_off';

                  return (
                    <tr
                      key={line.id}
                      className={isStruck ? 'bg-gray-50/70 text-gray-400' : 'hover:bg-gray-50/50'}
                    >
                      <td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>
                      <td className="py-2 px-3 font-semibold">
                        <span className={isStruck ? 'line-through text-gray-400' : 'text-gray-900'}>
                          {line.item_name}
                        </span>
                        {line.line_description && (
                          <span className="block text-[11px] text-gray-400 font-normal">
                            {line.line_description}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center text-gray-500">{line.unit_name}</td>
                      <td className="py-2 px-3 text-center font-bold text-gray-800">{line.ordered_quantity}</td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          min="0"
                          max={line.ordered_quantity}
                          disabled={isStruck || receiveMutation.isPending}
                          value={isStruck ? 0 : edit.received_quantity}
                          onChange={(e) => handleQuantityChange(line.id, line.ordered_quantity, e.target.value)}
                          className="input w-24 text-center text-xs py-1 px-2 h-8 font-mono font-bold"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="inline-flex rounded-md shadow-sm border border-gray-200 overflow-hidden text-[11px]">
                          <button
                            type="button"
                            onClick={() => handleToggleDisposition(line.id, line.ordered_quantity, 'received')}
                            className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${
                              !isStruck
                                ? 'bg-emerald-600 text-white font-bold'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            <CheckCircle2 size={12} />
                            استلام
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleDisposition(line.id, line.ordered_quantity, 'struck_off')}
                            className={`px-2.5 py-1 flex items-center gap-1 transition-colors border-r border-gray-200 ${
                              isStruck
                                ? 'bg-rose-600 text-white font-bold'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            <Ban size={12} />
                            شطب
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
};
