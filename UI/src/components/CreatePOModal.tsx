/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, AlertCircle, ShoppingCart } from 'lucide-react';
import { useCreatePurchaseOrder } from '../hooks/usePurchaseOrders';
import { useProviders } from '../hooks/useMetadata';
import { useItems } from '../hooks/useItems';
import { Item } from '../types';

interface CreatePOModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface LineState {
  item_id: number | '';
  quantity: number | '';
  unit_price: string;
  line_description: string;
}

export const CreatePOModal: React.FC<CreatePOModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [providerId, setProviderId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineState[]>([
    { item_id: '', quantity: '', unit_price: '', line_description: '' }
  ]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: providers = [], isLoading: loadingProviders } = useProviders({ enabled: isOpen });
  const { data: itemsData, isLoading: loadingItems } = useItems({ page_size: 100 }, { enabled: isOpen });

  const items: Item[] = (
    Array.isArray(itemsData)
      ? itemsData
      : (itemsData && 'items' in (itemsData as any) ? (itemsData as any).items : [])
  ).filter((i: Item) => i.status === 'active' || !i.status);

  const loadingMetadata = loadingProviders || loadingItems;
  const createPOMutation = useCreatePurchaseOrder();

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setErrorMessage(null);
      setProviderId('');
      setNotes('');
      setLines([{ item_id: '', quantity: '', unit_price: '', line_description: '' }]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddLine = () => {
    setLines([...lines, { item_id: '', quantity: '', unit_price: '', line_description: '' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) {
      setLines([{ item_id: '', quantity: '', unit_price: '', line_description: '' }]);
      return;
    }
    setLines(lines.filter((_, idx) => idx !== index));
  };

  const handleLineChange = (index: number, field: keyof LineState, value: any) => {
    const updated = [...lines];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-populate price if item selected and has cost
    if (field === 'item_id') {
      const selectedItem = items.find((i) => i.id === Number(value));
      if (selectedItem && selectedItem.cost !== null && selectedItem.cost !== undefined) {
        updated[index].unit_price = Number(selectedItem.cost).toFixed(2);
      }
    }

    setLines(updated);
  };

  // Calculations
  const calculateLineTotal = (line: LineState): number => {
    const q = Number(line.quantity) || 0;
    const p = parseFloat(line.unit_price) || 0;
    return q * p;
  };

  const totalAmount = lines.reduce((acc, line) => acc + calculateLineTotal(line), 0);
  const totalQuantity = lines.reduce((acc, line) => acc + (Number(line.quantity) || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!providerId) {
      setErrorMessage('يرجى اختيار المورد.');
      return;
    }

    const validLines = lines.filter((l) => l.item_id !== '');
    if (validLines.length === 0) {
      setErrorMessage('يجب إضافة صنف واحد على الأقل.');
      return;
    }

    // Check duplicate items
    const itemIds = validLines.map((l) => Number(l.item_id));
    const uniqueIds = new Set(itemIds);
    if (uniqueIds.size !== itemIds.length) {
      setErrorMessage('لا يمكن تكرار نفس الصنف في أكثر من بند.');
      return;
    }

    // Validate quantities and prices
    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i];
      const q = Number(line.quantity);
      if (!Number.isInteger(q) || q <= 0) {
        setErrorMessage(`الكمية في البند رقم ${i + 1} يجب أن تكون رقماً صحيحاً موجباً.`);
        return;
      }

      const pStr = String(line.unit_price).trim();
      const p = parseFloat(pStr);
      if (isNaN(p) || p < 0) {
        setErrorMessage(`سعر الوحدة في البند رقم ${i + 1} غير صالح.`);
        return;
      }

      // Check scale (at most 2 decimals)
      if (pStr.includes('.')) {
        const decimals = pStr.split('.')[1];
        if (decimals && decimals.length > 2) {
          setErrorMessage(`سعر الوحدة في البند رقم ${i + 1} يتجاوز خانتين عشريتين.`);
          return;
        }
      }
    }

    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `po-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      await createPOMutation.mutateAsync({
        input: {
          provider_id: Number(providerId),
          notes: notes.trim() || undefined,
          items: validLines.map((l) => ({
            item_id: Number(l.item_id),
             requested_quantity: Number(l.quantity),
             ordered_quantity: Number(l.quantity),
            unit_price: parseFloat(l.unit_price).toFixed(2),
            line_description: l.line_description.trim() || undefined
          }))
        },
        idempotencyKey
      });

      onCreated();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'فشل في إنشاء أمر الشراء.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary-50 text-primary-600">
              <ShoppingCart size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">إنشاء أمر شراء جديد</h2>
              <p className="text-xs text-gray-500">تجهيز طلب توريد أصناف من مورد محدد</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle size={18} className="flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Provider Selection & Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                المورد <span className="text-red-500">*</span>
              </label>
              <select
                className="input w-full text-sm"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : '')}
                disabled={loadingMetadata}
                required
              >
                <option value="">-- اختر المورد --</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                ملاحظات الطلب (اختياري)
              </label>
              <input
                type="text"
                className="input w-full text-sm"
                placeholder="مثال: توريد عاجل، موقع العمل..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-700">بنود الأصناف المطلوبة</h3>
              <button
                type="button"
                onClick={handleAddLine}
                className="btn btn-outline text-xs flex items-center gap-1 py-1 px-3"
              >
                <Plus size={14} />
                إضافة بند آخر
              </button>
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="py-2 px-3 w-8">#</th>
                    <th className="py-2 px-3 w-48">الصنف *</th>
                    <th className="py-2 px-3 w-20">الوحدة</th>
                    <th className="py-2 px-3 w-24">الكمية *</th>
                    <th className="py-2 px-3 w-28">السعر (ج.م) *</th>
                    <th className="py-2 px-3">البيان / الوصف</th>
                    <th className="py-2 px-3 w-28 text-left">الإجمالي (ج.م)</th>
                    <th className="py-2 px-2 w-10 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line, index) => {
                    const selectedItem = items.find((i) => i.id === Number(line.item_id));
                    const lineTotal = calculateLineTotal(line);

                    return (
                      <tr key={index} className="hover:bg-gray-50/50">
                        <td className="py-2 px-3 text-center text-gray-400">{index + 1}</td>
                        <td className="py-2 px-3">
                          <select
                            className="input w-full text-xs py-1 px-2"
                            value={line.item_id}
                            onChange={(e) =>
                              handleLineChange(
                                index,
                                'item_id',
                                e.target.value ? Number(e.target.value) : ''
                              )
                            }
                            required
                          >
                            <option value="">-- اختر الصنف --</option>
                            {items.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unit_name || 'غير محدد'})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-3 text-gray-500">
                          {selectedItem?.unit_name || '-'}
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            className="input w-full text-xs py-1 px-2 text-center"
                            placeholder="1"
                            value={line.quantity}
                            onChange={(e) =>
                              handleLineChange(
                                index,
                                'quantity',
                                e.target.value ? Number(e.target.value) : ''
                              )
                            }
                            required
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="input w-full text-xs py-1 px-2 text-left font-mono"
                            placeholder="0.00"
                            value={line.unit_price}
                            onChange={(e) => handleLineChange(index, 'unit_price', e.target.value)}
                            required
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            className="input w-full text-xs py-1 px-2"
                            placeholder="ملاحظة للبند..."
                            value={line.line_description}
                            onChange={(e) =>
                              handleLineChange(index, 'line_description', e.target.value)
                            }
                            maxLength={500}
                          />
                        </td>
                        <td className="py-2 px-3 text-left font-mono font-bold text-gray-700">
                          {lineTotal.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(index)}
                            className="text-gray-400 hover:text-red-600 p-1"
                            title="حذف البند"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals Summary Banner */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex gap-6 text-sm text-gray-600">
              <div>
                عدد البنود: <strong className="text-gray-900">{lines.filter((l) => l.item_id !== '').length}</strong>
              </div>
              <div>
                إجمالي الكميات: <strong className="text-gray-900">{totalQuantity}</strong>
              </div>
            </div>

            <div className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span>الإجمالي الكلي:</span>
              <span className="text-primary-600 font-mono text-xl">{totalAmount.toFixed(2)} ج.م</span>
            </div>
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-outline"
              disabled={createPOMutation.isPending}
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createPOMutation.isPending || loadingMetadata}
            >
               {createPOMutation.isPending ? 'جاري الحفظ...' : 'حفظ مسودة أمر الشراء'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
