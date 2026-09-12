import React from 'react';
import { PackageCheck } from 'lucide-react';
import { Modal } from './Modal';
import { PurchaseOrderDetail, ReceivePOResponse } from '../services/poService';
import { useReceivePurchaseOrder } from '../hooks/usePurchaseOrders';
import { generateIdempotencyKey } from '../services/apiClient';

export const POReceiptModal: React.FC<{ order: PurchaseOrderDetail | null; isOpen: boolean; onClose: () => void; onSuccess?: (response: ReceivePOResponse) => void }> = ({ order, isOpen, onClose, onSuccess }) => {
  const mutation = useReceivePurchaseOrder();
  if (!isOpen || !order) return null;

  const submit = async () => {
    const response = await mutation.mutateAsync({
      id: order.id,
      input: { expected_revision: order.revision },
      idempotencyKey: generateIdempotencyKey()
    });
    onSuccess?.(response);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`استلام وإيداع أمر الشراء ${order.po_number}`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn btn-outline" onClick={onClose} disabled={mutation.isPending}>
            إلغاء
          </button>
          <button
            className="btn btn-primary flex items-center gap-1.5"
            onClick={submit}
            disabled={mutation.isPending}
          >
            <PackageCheck size={16} />
            {mutation.isPending ? 'جاري الاستلام والإيداع...' : 'تأكيد الاستلام الفعلي وإيداع المخزون'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700 leading-relaxed">
          يرجى مطابقة الشحنة الفعلية المستلمة من المورد مع البنود والكميات المعتمدة أدناه قبل تأكيد إيداعها في رصيد المخزن.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <span className="text-gray-500 text-xs block">المورد</span>
            <strong className="text-gray-800">{order.provider_name}</strong>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">عدد البنود</span>
            <strong className="text-gray-800">{order.items?.length || order.line_count} أصناف</strong>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">إجمالي الكمية</span>
            <strong className="text-emerald-700 font-bold">{order.total_ordered_quantity}</strong>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs border-b">
              <tr>
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">الصنف</th>
                <th className="py-2.5 px-3">الوحدة</th>
                <th className="py-2.5 px-3 text-center">الكمية المستلمة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {order.items?.map((item, idx) => (
                <tr key={item.id || idx} className="hover:bg-gray-50/50">
                  <td className="py-2.5 px-3 text-gray-500">{idx + 1}</td>
                  <td className="py-2.5 px-3 font-medium text-gray-800">{item.item_name}</td>
                  <td className="py-2.5 px-3 text-gray-500">{item.unit_name || 'قطعة'}</td>
                  <td className="py-2.5 px-3 text-center font-bold text-emerald-700">{item.ordered_quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {mutation.isError && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {(mutation.error as Error).message}
          </div>
        )}
      </div>
    </Modal>
  );
};
