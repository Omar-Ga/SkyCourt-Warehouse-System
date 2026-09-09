/* eslint-disable */
import React, { useState } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { Modal } from './Modal';
import { useDestinations } from '../hooks/useMetadata';
import { useItems } from '../hooks/useItems';
import { useCreateLeaveOrder } from '../hooks/useLeaveOrders';
import { Item } from '../types';

interface CreateLeaveOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ItemLine {
  item_id: number | '';
  quantity: number | '';
}

export const CreateLeaveOrderModal: React.FC<CreateLeaveOrderModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [employeeName, setEmployeeName] = useState('');
  const [destinationId, setDestinationId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ItemLine[]>([{ item_id: '', quantity: '' }]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: destinations = [] } = useDestinations({ enabled: isOpen });
  // ponytail: native select with page_size: 100 is minimal and dependency-free; switch to react-select-async-paginate per line if inventory exceeds 100 items
  const { data: itemsData } = useItems({ page_size: 100 }, { enabled: isOpen });
  const items: Item[] = Array.isArray(itemsData)
    ? itemsData
    : (itemsData && 'items' in (itemsData as any) ? (itemsData as any).items : []);

  const createMutation = useCreateLeaveOrder();

  const handleAddLine = () => {
    setLines([...lines, { item_id: '', quantity: '' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, itemId: number) => {
    const updated = [...lines];
    updated[index].item_id = itemId;
    setLines(updated);
  };

  const handleQuantityChange = (index: number, qtyVal: string) => {
    const updated = [...lines];
    const parsed = parseInt(qtyVal, 10);
    updated[index].quantity = isNaN(parsed) ? '' : parsed;
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!employeeName.trim()) {
      setErrorMsg('يرجى إدخال اسم المستلم / الموظف.');
      return;
    }

    if (!destinationId) {
      setErrorMsg('يرجى اختيار جهة الصرف.');
      return;
    }

    if (lines.length === 0) {
      setErrorMsg('يجب إضافة صنف واحد على الأقل.');
      return;
    }

    const seenItems = new Set<number>();
    const formattedItems = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.item_id) {
        setErrorMsg(`يرجى تحديد الصنف في السطر ${i + 1}.`);
        return;
      }
      if (seenItems.has(line.item_id)) {
        setErrorMsg(`الصنف مكرر في قائمة الأصناف.`);
        return;
      }
      seenItems.add(line.item_id);

      if (!line.quantity || line.quantity <= 0) {
        setErrorMsg(`يرجى إدخال كمية صحيحة موجبة في السطر ${i + 1}.`);
        return;
      }

      const selectedItem = items.find((it) => it.id === line.item_id);
      const available = selectedItem?.available_quantity ?? selectedItem?.current_quantity;
      if (selectedItem && available !== undefined && line.quantity > available) {
        setErrorMsg(`الكمية المطلوبة للصنف "${selectedItem.name}" أكبر من الرصيد المتوفر (${available}).`);
        return;
      }

      formattedItems.push({
        item_id: line.item_id,
        requested_quantity: Number(line.quantity)
      });
    }

    try {
      await createMutation.mutateAsync({
        employee_name: employeeName.trim(),
        destination_id: Number(destinationId),
        notes: notes.trim() || undefined,
        items: formattedItems
      });

      // Reset form
      setEmployeeName('');
      setDestinationId('');
      setNotes('');
      setLines([{ item_id: '', quantity: '' }]);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل في إنشاء إذن الصرف.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="إنشاء إذن صرف جديد"
      size="lg"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={createMutation.isPending}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'جاري الإرسال...' : 'إرسال طلب الصرف'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-2 text-sm">
            <AlertCircle size={18} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              اسم المستلم / الموظف <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="input w-full"
              placeholder="مثال: أحمد محمد"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              جهة الصرف <span className="text-red-500">*</span>
            </label>
            <select
              className="select w-full"
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">-- اختر جهة الصرف --</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            ملاحظات
          </label>
          <input
            type="text"
            className="input w-full"
            placeholder="ملاحظات إضافية حول سبب الصرف..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Lines */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-md font-semibold text-gray-800">أصناف إذن الصرف</h3>
            <button
              type="button"
              className="btn btn-sm btn-outline flex items-center gap-1 text-xs"
              onClick={handleAddLine}
            >
              <Plus size={14} /> إضافة صنف
            </button>
          </div>

          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-center gap-2">
            <span className="font-semibold">تنبيه:</span>
            <span>سيتم حجز الكمية المتاحة فقط عند إنشاء الإذن، ويقوم المخزن بتنفيذ التذكرة قبل خصم الرصيد فعلياً.</span>
          </div>

          <div className="space-y-3">
            {lines.map((line, idx) => {
              const selectedItem = items.find((it) => it.id === line.item_id);
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      الصنف #{idx + 1}
                    </label>
                    <select
                      className="select w-full text-sm"
                      value={line.item_id}
                      onChange={(e) => handleItemChange(idx, Number(e.target.value))}
                    >
                      <option value="">-- اختر الصنف --</option>
                      {items
                        .filter((it) => it.status === 'active')
                        .map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name} (المتوفر: {it.available_quantity ?? it.current_quantity})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="w-28">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      الكمية {selectedItem ? `(${selectedItem.unit_name || 'وحدة'})` : ''}
                    </label>
                    <input
                      type="number"
                      min="1"
                      className="input w-full text-sm"
                      placeholder="الكمية"
                      value={line.quantity}
                      onChange={(e) => handleQuantityChange(idx, e.target.value)}
                    />
                  </div>

                  {lines.length > 1 && (
                    <div className="pt-5">
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="text-red-500 hover:text-red-700 p-1 rounded transition-colors"
                        title="حذف السطر"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </form>
    </Modal>
  );
};
