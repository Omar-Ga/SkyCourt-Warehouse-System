/* eslint-disable */
import React, { useState } from 'react';
import { Modal } from './Modal';
import { useLeaveOrderDetail, useCancelLeaveOrder, useResubmitLeaveOrder } from '../hooks/useLeaveOrders';
import { generateIdempotencyKey } from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import { ReturnModal } from './ReturnModal';
import { CheckCircle2, Clock, AlertTriangle, Undo2 } from 'lucide-react';

interface LeaveOrderDetailModalProps {
  orderId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

export const LeaveOrderDetailModal: React.FC<LeaveOrderDetailModalProps> = ({
  orderId,
  isOpen,
  onClose
}) => {
  const { user } = useAuth();
  const { data: order, isLoading } = useLeaveOrderDetail(orderId, { enabled: isOpen && orderId !== null });
  const cancelMutation = useCancelLeaveOrder();
  const resubmitMutation = useResubmitLeaveOrder();

  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canReturn = (user?.role === 'office' || user?.role === 'admin') && order && order.remaining_quantity > 0;

  const resubmit = async () => {
    if (!order) return;
    try {
      await resubmitMutation.mutateAsync({ id: order.id, input: { expected_revision: order.revision, notes: order.notes || undefined }, idempotencyKey: generateIdempotencyKey() });
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل في إعادة إرسال الإذن.');
    }
  };

  const cancel = async () => {
    if (!order) return;
    try {
      await cancelMutation.mutateAsync({ id: order.id, expected_revision: order.revision, idempotencyKey: generateIdempotencyKey() });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل في إلغاء الإذن.');
    }
  };

  if (!isOpen || orderId === null) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setErrorMsg(null);
        onClose();
      }}
      title={order ? `تفاصيل إذن الصرف: ${order.order_number}` : 'تفاصيل إذن الصرف'}
      size="lg"
      footer={
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            {canReturn && (
              <button
                type="button"
                className="btn btn-primary bg-green-600 hover:bg-green-700 border-green-600 flex items-center gap-1"
                onClick={() => setIsReturnOpen(true)}
              >
                <Undo2 size={16} />
                تسجيل مرتجع
              </button>
            )}
            {order?.status === 'rejected' && <><button type="button" className="btn btn-primary" onClick={resubmit} disabled={resubmitMutation.isPending}>إعادة إرسال للمخزن</button><button type="button" className="btn btn-outline text-red-600" onClick={cancel} disabled={cancelMutation.isPending}>إلغاء الطلب</button></>}
          </div>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            إغلاق النافذة
          </button>
        </div>
      }
    >
      {isLoading || !order ? (
        <div className="p-8 text-center text-gray-500">جاري تحميل التفاصيل...</div>
      ) : (
        <div className="space-y-6">
          {errorMsg && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {errorMsg}
            </div>
          )}

          {/* Status Header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <span className="text-xs text-gray-500 block">رقم الإذن</span>
              <span className="font-bold text-gray-800 text-base">{order.order_number}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">الحالة</span>
              <span className="inline-flex items-center gap-1 font-semibold text-sm">
                {order.status === 'open' && (
                  <span className="text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <Clock size={14} /> مفتوح
                  </span>
                )}
                {order.status === 'partially_returned' && (
                  <span className="text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <AlertTriangle size={14} /> مرتجع جزئياً
                  </span>
                )}
                {order.status === 'closed' && (
                  <span className="text-gray-700 bg-gray-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 size={14} /> مغلق
                  </span>
                )}
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">المستلم</span>
              <span className="font-semibold text-gray-800">{order.employee_name}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">جهة الصرف</span>
              <span className="font-semibold text-gray-800">{order.destination_name}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">تاريخ الإنشاء</span>
              <span className="text-sm text-gray-700">
                {new Date(order.created_at).toLocaleString('ar-EG')}
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">منشئ الإذن</span>
              <span className="text-sm text-gray-700">{order.creator_name || 'غير محدد'}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">الكمية المصروفة</span>
              <span className="font-semibold text-gray-800">{order.total_quantity}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">الكمية المتبقية</span>
              <span className="font-semibold text-primary-700">{order.remaining_quantity}</span>
            </div>
          </div>

          {order.notes && (
            <div className="p-3 bg-blue-50/50 rounded border border-blue-100 text-sm text-gray-700">
              <span className="font-semibold text-blue-900 block mb-1">ملاحظات:</span>
              {order.notes}
            </div>
          )}

          {order.close_reason && (
            <div className="p-3 bg-gray-100 rounded border border-gray-200 text-sm text-gray-700">
              <span className="font-semibold text-gray-800 block mb-1">
                سبب الإغلاق (بواسطة {order.closer_name || 'مستخدم'}):
              </span>
              {order.close_reason}
            </div>
          )}

          {order.rejection_reason && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800"><strong>سبب الرفض:</strong> {order.rejection_reason}</div>}

          {/* Items Table */}
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">الأصناف المصروفة</h4>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="table w-full text-right text-sm">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                  <tr>
                    <th className="p-3">الصنف</th>
                    <th className="p-3">الوحدة</th>
                    <th className="p-3">الكمية المصروفة</th>
                    <th className="p-3">الكمية المرتجعة</th>
                    <th className="p-3">الرصيد المتبقي بالخارج</th>
                    <th className="p-3">حالة الصنف الحالية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {order.items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-medium text-gray-800">{item.item_name}</td>
                      <td className="p-3 text-gray-600">{item.unit_name}</td>
                      <td className="p-3 font-semibold text-gray-700">{item.dispensed_quantity}</td>
                      <td className="p-3 text-gray-600">{item.returned_quantity}</td>
                      <td className="p-3 font-semibold text-primary-700">{item.remaining_quantity}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          item.current_item_status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {item.current_item_status === 'active' ? 'نشط' : item.current_item_status || 'غير معروف'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Return History */}
          {order.return_events && order.return_events.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">سجل المرتجعات ({order.return_events.length})</h4>
              <div className="space-y-3">
                {order.return_events.map((event: any) => (
                  <div key={event.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-gray-800">
                        مرتجع بتاريخ {new Date(event.created_at).toLocaleString('ar-EG')}
                      </span>
                      <span className="text-xs text-gray-500">
                        بواسطة: {event.actor_name || 'غير محدد'}
                      </span>
                    </div>
                    {event.notes && (
                      <p className="text-xs text-gray-600 mb-2 bg-white p-1.5 rounded border border-gray-100">
                        <strong>ملاحظات:</strong> {event.notes}
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="table w-full text-right text-xs">
                        <thead className="bg-gray-100 text-gray-600 font-medium">
                          <tr>
                            <th className="p-2">الصنف</th>
                            <th className="p-2">الوحدة</th>
                            <th className="p-2">الكمية المسترجعة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {event.items && event.items.map((ei: any) => (
                            <tr key={ei.id}>
                              <td className="p-2">{ei.item_name}</td>
                              <td className="p-2">{ei.unit_name}</td>
                              <td className="p-2 font-bold text-green-700">+{ei.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isReturnOpen && order && (
        <ReturnModal
          order={order}
          isOpen={isReturnOpen}
          onClose={() => setIsReturnOpen(false)}
        />
      )}
    </Modal>
  );
};
