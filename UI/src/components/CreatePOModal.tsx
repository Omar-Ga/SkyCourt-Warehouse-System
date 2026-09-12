/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { AsyncPaginate, LoadOptions } from 'react-select-async-paginate';
import type { GroupBase, OptionsOrGroups } from 'react-select';
import { useCreatePurchaseOrder, useEditPurchaseOrder } from '../hooks/usePurchaseOrders';
import { useProviders } from '../hooks/useMetadata';
import { apiClient, generateIdempotencyKey } from '../services/apiClient';
import { PurchaseOrderDetail } from '../services/poService';
import { useAuth } from '../context/AuthContext';
import { Item } from '../types';
import { Modal } from './Modal';

interface CreatePOModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (createdPO?: any) => void;
  initialPO?: PurchaseOrderDetail | null;
}

interface ItemOption {
  value: number;
  label: string;
  item: Item;
}

interface LineState {
  item: Item | null;
  quantity: number | '';
  unit_price: string;
  line_description: string;
}

const ITEMS_PER_PAGE = 20;
const AsyncPaginateComponent = AsyncPaginate as any;

export const CreatePOModal: React.FC<CreatePOModalProps> = ({ isOpen, onClose, onCreated, initialPO }) => {
  const { user } = useAuth();
  const [providerId, setProviderId] = useState<number | ''>(() => (initialPO ? initialPO.provider_id : ''));
  const [notes, setNotes] = useState(() => (initialPO?.notes || ''));
  const [lines, setLines] = useState<LineState[]>(() =>
    initialPO && initialPO.items && initialPO.items.length > 0
      ? initialPO.items.map((i) => ({
          item: {
            id: i.item_id,
            name: i.item_name,
            unit_name: i.unit_name,
            cost: i.unit_price ? parseFloat(i.unit_price) : undefined,
            status: 'active'
          } as Item,
          quantity: i.ordered_quantity,
          unit_price: i.unit_price,
          line_description: i.line_description || ''
        }))
      : [{ item: null, quantity: '', unit_price: '', line_description: '' }]
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // F01: Track idempotency key and submitted payload across retries, form modifications, and page reloads
  // Scoped to current authenticated user to prevent account leakage across logout / account switching
  const userPrefix = user?.id ? `user_${user.id}_` : '';
  const STORAGE_KEY = initialPO
    ? `skycourt_pending_${userPrefix}po_edit_${initialPO.id}`
    : `skycourt_pending_${userPrefix}purchase_order`;

  const loadStoredPendingSubmission = () => {
    try {
      const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.userId === undefined || parsed.userId === user?.id)) {
          return parsed;
        }
      }
    } catch {}
    return null;
  };

  const [pendingSubmission, setPendingSubmission] = useState<{
    userId?: number;
    key: string;
    payload: any;
    serialized: string;
    isEdit: boolean;
  } | null>(() => loadStoredPendingSubmission());
  const [hasUncertainSubmission, setHasUncertainSubmission] = useState(() => !!loadStoredPendingSubmission());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const { data: providers = [], isLoading: loadingProviders } = useProviders({ enabled: isOpen });
  const createPOMutation = useCreatePurchaseOrder();
  const editPOMutation = useEditPurchaseOrder();

  const resetForm = () => {
    setErrorMessage(null);
    setProviderId('');
    setNotes('');
    setLines([{ item: null, quantity: '', unit_price: '', line_description: '' }]);
    setPendingSubmission(null);
    setHasUncertainSubmission(false);
    setIsSubmitting(false);
    isSubmittingRef.current = false;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  };

  // Reset or initialize state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      if (!hasUncertainSubmission) {
        resetForm();
      }
    } else if (initialPO) {
      setProviderId(initialPO.provider_id);
      setNotes(initialPO.notes || '');
      setLines(
        initialPO.items && initialPO.items.length > 0
          ? initialPO.items.map((i) => ({
              item: {
                id: i.item_id,
                name: i.item_name,
                unit_name: i.unit_name,
                cost: i.unit_price ? parseFloat(i.unit_price) : undefined,
                status: 'active'
              } as Item,
              quantity: i.ordered_quantity,
              unit_price: i.unit_price,
              line_description: i.line_description || ''
            }))
          : [{ item: null, quantity: '', unit_price: '', line_description: '' }]
      );
      const stored = loadStoredPendingSubmission();
      if (stored) {
        setPendingSubmission(stored);
        setHasUncertainSubmission(true);
      } else {
        setPendingSubmission(null);
        setHasUncertainSubmission(false);
      }
    } else {
      const stored = loadStoredPendingSubmission();
      if (stored) {
        setPendingSubmission(stored);
        setHasUncertainSubmission(true);
      } else {
        setPendingSubmission(null);
        setHasUncertainSubmission(false);
      }
    }
  }, [isOpen, initialPO, user]);

  const handleClose = () => {
    if (!hasUncertainSubmission) {
      resetForm();
    }
    onClose();
  };

  if (!isOpen) return null;

  const handleAddLine = () => {
    setLines([...lines, { item: null, quantity: '', unit_price: '', line_description: '' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) {
      setLines([{ item: null, quantity: '', unit_price: '', line_description: '' }]);
      return;
    }
    setLines(lines.filter((_, idx) => idx !== index));
  };

  const handleItemSelect = (index: number, item: Item | null) => {
    const updated = [...lines];
    let price = updated[index].unit_price;
    if (item && item.cost !== null && item.cost !== undefined && !price) {
      price = Number(item.cost).toFixed(2);
    }
    updated[index] = {
      ...updated[index],
      item,
      unit_price: price
    };
    setLines(updated);
  };

  const handleLineFieldChange = (index: number, field: 'quantity' | 'unit_price' | 'line_description', value: any) => {
    const updated = [...lines];
    updated[index] = { ...updated[index], [field]: value };
    setLines(updated);
  };

  // F02: Async item loader
  const loadItemOptions: LoadOptions<ItemOption, GroupBase<ItemOption>, { offset: number } | undefined> = async (
    searchQuery: string,
    _loadedOptions: OptionsOrGroups<ItemOption, GroupBase<ItemOption>>,
    additional?: { offset: number }
  ) => {
    const offset = additional?.offset || 0;
    try {
      const params = new URLSearchParams();
      params.append('offset', String(offset));
      params.append('limit', String(ITEMS_PER_PAGE));
      if (searchQuery) {
        params.append('q', searchQuery);
      }

      const res = await apiClient.get<{ items: Item[]; total_count: number }>(`/items?${params.toString()}`);
      const activeItems = (res.items || []).filter((it: Item) => it.status === 'active' || !it.status);
      const options: ItemOption[] = activeItems.map((it: Item) => ({
        value: it.id,
        label: `${it.name} (${it.unit_name || 'وحدة'}) - #${it.id}`,
        item: it
      }));

      const newOffset = offset + options.length;
      return {
        options,
        hasMore: newOffset < res.total_count,
        additional: { offset: newOffset }
      };
    } catch {
      return { options: [], hasMore: false, additional: { offset } };
    }
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

    const validLines = lines.filter((l) => l.item !== null);
    if (validLines.length === 0) {
      setErrorMessage('يجب إضافة صنف واحد على الأقل.');
      return;
    }

    // Check duplicate items
    const itemIds = validLines.map((l) => l.item!.id);
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

      if (pStr.includes('.')) {
        const decimals = pStr.split('.')[1];
        if (decimals && decimals.length > 2) {
          setErrorMessage(`سعر الوحدة في البند رقم ${i + 1} يتجاوز خانتين عشريتين.`);
          return;
        }
      }
    }

    const currentPayload = {
      provider_id: Number(providerId),
      notes: notes.trim() || undefined,
      items: validLines.map((l) => ({
        item_id: Number(l.item!.id),
        requested_quantity: Number(l.quantity),
        ordered_quantity: Number(l.quantity),
        unit_price: parseFloat(l.unit_price).toFixed(2),
        line_description: l.line_description.trim() || undefined
      }))
    };
    const serializedPayload = JSON.stringify(currentPayload);

    // If an uncertain submission already exists, never create a second PO on edit
    if (hasUncertainSubmission && pendingSubmission) {
      await handleCheckPreviousSubmission();
      return;
    }

    const keyToUse = pendingSubmission ? pendingSubmission.key : generateIdempotencyKey();
    const submission = {
      userId: user?.id,
      key: keyToUse,
      payload: currentPayload,
      serialized: serializedPayload,
      isEdit: !!initialPO
    };
    setPendingSubmission(submission);

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let result;
      if (initialPO) {
        result = await editPOMutation.mutateAsync({
          id: initialPO.id,
          input: {
            expected_revision: initialPO.revision,
            provider_id: currentPayload.provider_id,
            notes: currentPayload.notes,
            items: currentPayload.items
          },
          idempotencyKey: keyToUse
        });
      } else {
        result = await createPOMutation.mutateAsync({
          input: currentPayload,
          idempotencyKey: keyToUse
        });
      }

      resetForm();
      onCreated(result);
      onClose();
    } catch (err: any) {
      const isCertainRejection = err?.status && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 409;
      if (!isCertainRejection) {
        setHasUncertainSubmission(true);
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(submission));
          }
        } catch {}
        setErrorMessage('تعذر تأكيد استلام أمر الشراء من الخادم. قد يكون تم تنفيذه بالفعل بالخادم.');
      } else {
        setErrorMessage(err.message || 'حدث خطأ أثناء معالجة أمر الشراء.');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCheckPreviousSubmission = async () => {
    if (!pendingSubmission || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let result;
      if (pendingSubmission.isEdit && initialPO) {
        result = await editPOMutation.mutateAsync({
          id: initialPO.id,
          input: {
            expected_revision: initialPO.revision,
            provider_id: pendingSubmission.payload.provider_id,
            notes: pendingSubmission.payload.notes,
            items: pendingSubmission.payload.items
          },
          idempotencyKey: pendingSubmission.key
        });
      } else {
        result = await createPOMutation.mutateAsync({
          input: pendingSubmission.payload,
          idempotencyKey: pendingSubmission.key
        });
      }

      resetForm();
      onCreated(result);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'تعذر تأكيد استلام أمر الشراء من الخادم. يرجى التحقق من اتصال الشبكة والمحاولة مجدداً.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const currentPayloadComparison = JSON.stringify({
    provider_id: Number(providerId),
    notes: notes.trim() || undefined,
    items: lines.filter((l) => l.item && l.quantity).map((l) => ({
      item_id: Number(l.item!.id),
      requested_quantity: Number(l.quantity),
      ordered_quantity: Number(l.quantity),
      unit_price: parseFloat(l.unit_price || '0').toFixed(2),
      line_description: l.line_description.trim() || undefined
    }))
  });
  const isFormModifiedAfterAttempt = !!(pendingSubmission && pendingSubmission.serialized !== currentPayloadComparison);
  const isPending = isSubmitting || createPOMutation.isPending || editPOMutation.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={initialPO ? `تعديل أمر الشراء: ${initialPO.po_number}` : 'إنشاء أمر شراء جديد'}
      size="xl"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <button
            type="button"
            onClick={handleClose}
            className="btn btn-outline"
            disabled={isPending}
          >
            إلغاء
          </button>
          {hasUncertainSubmission ? (
            <button
              type="button"
              className="btn btn-primary bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1.5"
              onClick={handleCheckPreviousSubmission}
              disabled={isPending}
            >
              {isPending ? 'جاري التحقق...' : 'التحقق من الإرسال السابق'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={isPending || loadingProviders}
            >
              {isPending ? 'جاري الحفظ...' : initialPO ? 'حفظ تعديلات أمر الشراء' : 'حفظ مسودة أمر الشراء'}
            </button>
          )}
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
          {hasUncertainSubmission && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold m-0">تعذر التأكد من استلام الخادم لأمر الشراء السابق</p>
                  <p className="text-xs text-amber-800 mt-1 m-0">
                    {isFormModifiedAfterAttempt
                      ? 'تنبيه: تم تعديل بيانات النموذج بعد محاولة الإرسال السابقة. لمنع تكرار أوامر الشراء، تم الاحتفاظ بالطلب الأصلي ومفتاح العملية. يرجى استخدام إجراء "التحقق من الإرسال السابق" لفحص حالة الطلب الأصلي أولاً.'
                      : 'قد يكون أمر الشراء قد تم حفظه بالفعل بالخادم قبل انقطاع الاتصال. يرجى استخدام زر "التحقق من الإرسال السابق" لفحص وتأكيد حالة الطلب دون تكرار.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  className="btn btn-sm bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1.5"
                  onClick={handleCheckPreviousSubmission}
                  disabled={isPending}
                >
                  {isPending ? 'جاري الفحص...' : 'التحقق من الإرسال السابق'}
                </button>
              </div>
            </div>
          )}

          {errorMessage && !hasUncertainSubmission && (
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
                disabled={loadingProviders}
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
                    <th className="py-2 px-3 w-64">الصنف *</th>
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
                    const selectedOption = line.item
                      ? {
                          value: line.item.id,
                          label: `${line.item.name} (${line.item.unit_name || 'وحدة'}) - #${line.item.id}`,
                          item: line.item
                        }
                      : null;
                    const lineTotal = calculateLineTotal(line);

                    return (
                      <tr key={index} className="hover:bg-gray-50/50">
                        <td className="py-2 px-3 text-center text-gray-400">{index + 1}</td>
                        <td className="py-2 px-3">
                          <AsyncPaginateComponent
                            loadOptions={loadItemOptions}
                            value={selectedOption}
                            onChange={(opt: ItemOption | null) => handleItemSelect(index, opt ? opt.item : null)}
                            placeholder="ابحث واختر الصنف..."
                            debounceTimeout={300}
                            isClearable
                            noOptionsMessage={() => 'لا توجد نتائج'}
                            additional={{ offset: 0 }}
                            menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                            styles={{
                              control: (base: any) => ({
                                ...base,
                                minHeight: '32px',
                                borderRadius: '6px',
                                borderColor: '#e2e8f0',
                                fontSize: '12px',
                                fontFamily: 'Cairo, sans-serif'
                              }),
                              menuPortal: (base: any) => ({ ...base, zIndex: 9999 })
                            }}
                          />
                        </td>
                        <td className="py-2 px-3 text-gray-500">
                          {line.item?.unit_name || '-'}
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
                              handleLineFieldChange(
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
                            onChange={(e) => handleLineFieldChange(index, 'unit_price', e.target.value)}
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
                              handleLineFieldChange(index, 'line_description', e.target.value)
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
                عدد البنود: <strong className="text-gray-900">{lines.filter((l) => l.item !== null).length}</strong>
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

      </form>
    </Modal>
  );
};
