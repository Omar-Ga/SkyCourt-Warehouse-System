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
    const response = await mutation.mutateAsync({ id: order.id, input: { expected_revision: order.revision }, idempotencyKey: generateIdempotencyKey() });
    onSuccess?.(response);
    onClose();
  };
  return <Modal isOpen={isOpen} onClose={onClose} title={`استلام وإغلاق أمر الشراء ${order.po_number}`} footer={<div className="flex justify-end gap-2"><button className="btn btn-outline" onClick={onClose}>إلغاء</button><button className="btn btn-primary flex items-center gap-1" onClick={submit} disabled={mutation.isPending}><PackageCheck size={16} />{mutation.isPending ? 'جاري الاستلام...' : 'استلام وإغلاق'}</button></div>}>
    <div className="space-y-4"><p className="text-sm text-gray-700">سيتم استلام جميع الكميات المطلوبة في عملية ذرية واحدة وإغلاق أمر الشراء. لا يمكن تسجيل استلام جزئي.</p><div className="bg-gray-50 rounded-lg p-4 text-sm grid grid-cols-2 gap-3"><span>المورد: <strong>{order.provider_name}</strong></span><span>البنود: <strong>{order.line_count}</strong></span><span>الكمية: <strong>{order.total_ordered_quantity}</strong></span><span>الإصدار: <strong>#{order.revision}</strong></span></div>{mutation.isError && <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>}</div>
  </Modal>;
};
