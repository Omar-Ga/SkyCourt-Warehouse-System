/* eslint-disable */
import React, { useState } from 'react';
import { Modal } from './Modal';
import { LeaveOrderDetail } from '../services/leaveOrderService';
import { useReturnTicket } from '../hooks/useLeaveOrders';
import { generateIdempotencyKey } from '../services/apiClient';
import { Undo2 } from 'lucide-react';

interface ReturnModalProps {
  order: LeaveOrderDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ReturnModal: React.FC<ReturnModalProps> = ({
  order,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [returnDeltas, setReturnDeltas] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState<string>(() => generateIdempotencyKey());
  const [lastSubmittedPayload, setLastSubmittedPayload] = useState<string | null>(null);

  const returnMutation = useReturnTicket();

  if (!isOpen) return null;

  const handleClose = () => {
    setReturnDeltas({});
    setNotes('');
    setErrorMsg(null);
    setSubmissionKey(generateIdempotencyKey());
    setLastSubmittedPayload(null);
    onClose();
  };

  const returnableLines = order ? order.items.filter((item) => item.remaining_quantity > 0) : [];

  const handleDeltaChange = (lineId: number, val: string) => {
    setReturnDeltas((prev) => ({ ...prev, [lineId]: val }));
  };

  const handleReturnAll = () => {
    const allDeltas: Record<number, string> = {};
    returnableLines.forEach((item) => {
      allDeltas[item.id] = String(item.remaining_quantity);
    });
    setReturnDeltas(allDeltas);
  };

  const lineValidation: Record<number, { error?: string; qty: number }> = {};
  let hasLineErrors = false;
  let validLineCount = 0;

  for (const line of returnableLines) {
    const raw = (returnDeltas[line.id] ?? '').trim();
    if (!raw || raw === '0') {
      lineValidation[line.id] = { qty: 0 };
      continue;
    }
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0) {
      lineValidation[line.id] = { error: 'يجب إدخال عدد صحيح موجب', qty: 0 };
      hasLineErrors = true;
    } else if (num > line.remaining_quantity) {
      lineValidation[line.id] = {
        error: `الكمية (${num}) تتجاوز المتبقي (${line.remaining_quantity})`,
        qty: num
      };
      hasLineErrors = true;
    } else {
      lineValidation[line.id] = { qty: num };
      validLineCount += 1;
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setErrorMsg(null);

    if (hasLineErrors) {
      setErrorMsg('يرجى تصحيح أخطاء الكميات المدخلة قبل المتابعة.');
      return;
    }

    const itemsToReturn: { line_id: number; quantity: number }[] = [];
    for (const line of returnableLines) {
      const val = lineValidation[line.id];
      if (val && val.qty > 0 && !val.error) {
        itemsToReturn.push({ line_id: line.id, quantity: val.qty });
      }
    }

    if (itemsToReturn.length === 0) {
      setErrorMsg('يرجى تحديد كمية مرتجعة واحدة على الأقل أكبر من صفر.');
      return;
    }

    const payloadString = JSON.stringify({ items: itemsToReturn, notes: notes.trim() });
    let currentKey = submissionKey;
    if (lastSubmittedPayload && lastSubmittedPayload !== payloadString) {
      currentKey = generateIdempotencyKey();
      setSubmissionKey(currentKey);
    }
    setLastSubmittedPayload(payloadString);

    try {
      await returnMutation.mutateAsync({
        ticketId: order.id,
        input: {
          expected_revision: order.revision,
          items: itemsToReturn,
          notes: notes.trim() || undefined
        },
        idempotencyKey: currentKey
      });
      handleClose();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل في تسجيل المرتجع.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={order ? `تسجيل مرتجع لتذكرة: ${order.order_number}` : 'تسجيل مرتجع'}
      size="lg"
      footer={
        <div className="flex justify-between items-center w-full">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleReturnAll}
            disabled={returnMutation.isPending || !order}
          >
            إرجاع كامل المتبقي
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleClose}
              disabled={returnMutation.isPending}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary flex items-center gap-1"
              onClick={handleSubmit}
              disabled={returnMutation.isPending || !order || hasLineErrors || validLineCount === 0}
            >
              <Undo2 size={16} />
              {returnMutation.isPending ? 'جاري التسجيل...' : 'تأكيد تسجيل المرتجع'}
            </button>
          </div>
        </div>
      }
    >
      {!order ? (
        <div className="p-8 text-center text-gray-500">جاري تحميل تفاصيل التذكرة...</div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {errorMsg}
          </div>
        )}

        <div className="p-3 bg-blue-50/50 rounded border border-blue-100 text-xs text-blue-800 space-y-1">
          <p><strong>المستلم:</strong> {order.employee_name} | <strong>الجهة:</strong> {order.destination_name}</p>
          <p className="text-gray-500">أدخل الكميات المستلمة فعلياً ليتم إيداعها مباشرة برصيد المخزن مع تسجيل حركة مرتجع رسمية.</p>
        </div>

        {returnableLines.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">
            لا توجد أصناف متبقية للإرجاع في هذه التذكرة.
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="table w-full text-right text-sm">
              <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                <tr>
                  <th className="p-3">الصنف</th>
                  <th className="p-3">الوحدة</th>
                  <th className="p-3">المصروف أصلاً</th>
                  <th className="p-3">المرتجع سابقاً</th>
                  <th className="p-3">المتبقي بالخارج</th>
                  <th className="p-3 w-36">الكمية المرجعة الآن</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {returnableLines.map((line) => {
                  const currentVal = returnDeltas[line.id] !== undefined ? returnDeltas[line.id] : '';
                  const lineVal = lineValidation[line.id];
                  const hasError = !!lineVal?.error;
                  return (
                    <tr key={line.id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-medium text-gray-800">{line.item_name}</td>
                      <td className="p-3 text-gray-600">{line.unit_name}</td>
                      <td className="p-3 text-gray-700">{line.dispensed_quantity}</td>
                      <td className="p-3 text-gray-600">{line.returned_quantity}</td>
                      <td className="p-3 font-bold text-primary-700">{line.remaining_quantity}</td>
                      <td className="p-3">
                        <div className="flex flex-col items-start gap-1">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            className={`input w-28 text-center py-1 text-sm font-semibold ${
                              hasError ? 'border-red-500 text-red-700 focus:border-red-500 focus:ring-red-500' : ''
                            }`}
                            placeholder="0"
                            value={currentVal}
                            onChange={(e) => handleDeltaChange(line.id, e.target.value)}
                          />
                          {hasError && (
                            <span className="text-[11px] text-red-600 font-medium">
                              {lineVal.error}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            ملاحظات المرتجع (اختياري)
          </label>
          <input
            type="text"
            className="input w-full text-sm"
            placeholder="مثال: فحص المواد وتبين سلامتها، إعادة للمستودع..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </div>
      </form>
      )}
    </Modal>
  );
};
