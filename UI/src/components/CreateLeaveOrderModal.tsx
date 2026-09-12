/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { AsyncPaginate, LoadOptions } from 'react-select-async-paginate';
import type { GroupBase, OptionsOrGroups } from 'react-select';
import { Modal } from './Modal';
import { useDestinations } from '../hooks/useMetadata';
import { useCreateLeaveOrder } from '../hooks/useLeaveOrders';
import { apiClient, generateIdempotencyKey } from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import { Item } from '../types';

interface CreateLeaveOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (createdOrder?: any) => void;
}

interface ItemOption {
  value: number;
  label: string;
  item: Item;
}

interface ItemLine {
  item: Item | null;
  quantity: number | '';
}

const ITEMS_PER_PAGE = 20;
const AsyncPaginateComponent = AsyncPaginate as any;

export const CreateLeaveOrderModal: React.FC<CreateLeaveOrderModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { user } = useAuth();
  const [employeeName, setEmployeeName] = useState('');
  const [destinationId, setDestinationId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ItemLine[]>([{ item: null, quantity: '' }]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // F01: Track idempotency key and submitted payload across retries, form modifications, and page reloads
  // Scoped to current authenticated user to prevent account leakage across logout / account switching
  const STORAGE_KEY = user?.id ? `skycourt_pending_user_${user.id}_leave_order` : 'skycourt_pending_leave_order';

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
  } | null>(() => loadStoredPendingSubmission());
  const [hasUncertainSubmission, setHasUncertainSubmission] = useState<boolean>(() => !!loadStoredPendingSubmission());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const { data: destinations = [] } = useDestinations({ enabled: isOpen });
  const createMutation = useCreateLeaveOrder();

  const resetForm = () => {
    setEmployeeName('');
    setDestinationId('');
    setNotes('');
    setLines([{ item: null, quantity: '' }]);
    setErrorMsg(null);
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

  // F10 / F01: Restore pending submission on open, retain across accidental close
  useEffect(() => {
    if (isOpen) {
      const stored = loadStoredPendingSubmission();
      if (stored) {
        setPendingSubmission(stored);
        setHasUncertainSubmission(true);
      } else {
        setPendingSubmission(null);
        setHasUncertainSubmission(false);
      }
    } else {
      setErrorMsg(null);
      setIsSubmitting(false);
      isSubmittingRef.current = false;
      if (!hasUncertainSubmission) {
        setEmployeeName('');
        setDestinationId('');
        setNotes('');
        setLines([{ item: null, quantity: '' }]);
      }
    }
  }, [isOpen, user]);

  const handleClose = () => {
    if (!hasUncertainSubmission) {
      resetForm();
    }
    onClose();
  };

  const handleAddLine = () => {
    setLines([...lines, { item: null, quantity: '' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, item: Item | null) => {
    const updated = [...lines];
    updated[index] = { ...updated[index], item };
    setLines(updated);
  };

  const handleQuantityChange = (index: number, qtyVal: string) => {
    const updated = [...lines];
    const parsed = parseInt(qtyVal, 10);
    updated[index] = {
      ...updated[index],
      quantity: isNaN(parsed) ? '' : parsed
    };
    setLines(updated);
  };

  // F02: Async searchable paginated inventory loader
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
      const options: ItemOption[] = activeItems.map((it: Item) => {
        const avail = it.available_quantity ?? (it.current_quantity !== undefined ? it.current_quantity - (it.reserved_quantity || 0) : 0);
        return {
          value: it.id,
          label: `${it.name} (${it.unit_name || 'وحدة'}) - المتاح: ${avail}`,
          item: it
        };
      });

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
      if (!line.item) {
        setErrorMsg(`يرجى تحديد الصنف في السطر ${i + 1}.`);
        return;
      }
      if (seenItems.has(line.item.id)) {
        setErrorMsg(`الصنف "${line.item.name}" مكرر في قائمة الأصناف.`);
        return;
      }
      seenItems.add(line.item.id);

      const qty = Number(line.quantity);
      if (!line.quantity || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
        setErrorMsg(`يرجى إدخال كمية صحيحة موجبة في السطر ${i + 1}.`);
        return;
      }

      const available = line.item.available_quantity ?? (line.item.current_quantity !== undefined ? line.item.current_quantity - (line.item.reserved_quantity || 0) : undefined);
      if (available !== undefined && qty > available) {
        setErrorMsg(`الكمية المطلوبة للصنف "${line.item.name}" أكبر من الرصيد المتوفر (${available}).`);
        return;
      }

      formattedItems.push({
        item_id: line.item.id,
        requested_quantity: Number(line.quantity)
      });
    }

    const currentPayload = {
      employee_name: employeeName.trim(),
      destination_id: Number(destinationId),
      notes: notes.trim() || undefined,
      items: formattedItems
    };
    const serializedPayload = JSON.stringify(currentPayload);

    // If an uncertain submission already exists, never create a second order on edit
    if (hasUncertainSubmission && pendingSubmission) {
      await handleCheckPreviousSubmission();
      return;
    }

    const keyToUse = pendingSubmission ? pendingSubmission.key : generateIdempotencyKey();
    const submission = {
      userId: user?.id,
      key: keyToUse,
      payload: currentPayload,
      serialized: serializedPayload
    };
    setPendingSubmission(submission);

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await createMutation.mutateAsync({
        input: currentPayload,
        idempotencyKey: keyToUse
      });

      resetForm();
      onSuccess?.(result);
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
        setErrorMsg('تعذر تأكيد استلام الطلب من الخادم. قد يكون الطلب قد تم تنفيذه بالفعل بالخادم.');
      } else {
        setErrorMsg(err.message || 'حدث خطأ أثناء معالجة الطلب.');
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
    setErrorMsg(null);

    try {
      const result = await createMutation.mutateAsync({
        input: pendingSubmission.payload,
        idempotencyKey: pendingSubmission.key
      });

      resetForm();
      onSuccess?.(result);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'تعذر تأكيد استلام الطلب من الخادم. يرجى التحقق من اتصال الشبكة والمحاولة مجدداً.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const currentPayloadComparison = JSON.stringify({
    employee_name: employeeName.trim(),
    destination_id: Number(destinationId),
    notes: notes.trim() || undefined,
    items: lines.filter((l) => l.item).map((l) => ({ item_id: l.item!.id, requested_quantity: Number(l.quantity) }))
  });
  const isFormModifiedAfterAttempt = !!(pendingSubmission && pendingSubmission.serialized !== currentPayloadComparison);
  const isPending = isSubmitting || createMutation.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="إنشاء إذن صرف جديد"
      size="lg"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleClose}
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
              disabled={isPending}
            >
              {isPending ? 'جاري الإرسال...' : 'إرسال طلب الصرف'}
            </button>
          )}
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {hasUncertainSubmission && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold m-0">تعذر التأكد من استلام الخادم للطلب السابق</p>
                <p className="text-xs text-amber-800 mt-1 m-0">
                  {isFormModifiedAfterAttempt
                    ? 'تنبيه: تم تعديل بيانات النموذج بعد محاولة الإرسال السابقة. لمنع تكرار الأوامر وحجز أرصدة مكررة، تم الاحتفاظ بالطلب الأصلي ومفتاح العملية. يرجى استخدام إجراء "التحقق من الإرسال السابق" لفحص حالة الطلب الأصلي أولاً.'
                    : 'قد يكون الطلب قد تم تنفيذه بالفعل بالخادم قبل انقطاع الاتصال. يرجى استخدام زر "التحقق من الإرسال السابق" لفحص وتأكيد حالة الطلب دون تكرار.'}
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

        {errorMsg && !hasUncertainSubmission && (
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
              const selectedOption = line.item ? {
                value: line.item.id,
                label: `${line.item.name} (${line.item.unit_name || 'وحدة'}) - المتاح: ${line.item.available_quantity ?? (line.item.current_quantity !== undefined ? line.item.current_quantity - (line.item.reserved_quantity || 0) : 0)}`,
                item: line.item
              } : null;

              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      الصنف #{idx + 1}
                    </label>
                    <AsyncPaginateComponent
                      loadOptions={loadItemOptions}
                      value={selectedOption}
                      onChange={(opt: ItemOption | null) => handleItemChange(idx, opt ? opt.item : null)}
                      placeholder="ابحث واختر الصنف..."
                      debounceTimeout={300}
                      isClearable
                      noOptionsMessage={() => 'لا توجد نتائج مطابقة'}
                      additional={{ offset: 0 }}
                      menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                      styles={{
                        control: (base: any) => ({
                          ...base,
                          minHeight: '38px',
                          borderRadius: '8px',
                          borderColor: '#e2e8f0',
                          fontSize: '13px',
                          fontFamily: 'Cairo, sans-serif'
                        }),
                        menuPortal: (base: any) => ({ ...base, zIndex: 9999 })
                      }}
                    />
                  </div>

                  <div className="w-32">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      الكمية {line.item ? `(${line.item.unit_name || 'وحدة'})` : ''}
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
