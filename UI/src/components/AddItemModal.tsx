/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { Unit, Provider } from '../types'; // Import shared Unit and Provider types
import toast from 'react-hot-toast';
import { apiClient, ApiError, generateIdempotencyKey } from '../services/apiClient';
import { useCapabilities } from '../hooks/useCapabilities';

type AddItemModalProps = {
  isOpen: boolean;
  onClose: () => void;
  units: Unit[]; // Use shared Unit type
  onItemAdded: () => void;
  subCategoryId?: number;
};

export const AddItemModal = ({ isOpen, onClose, units, onItemAdded, subCategoryId }: AddItemModalProps) => {
  const { canMutateItems } = useCapabilities();
  if (!canMutateItems) return null;

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitId, setUnitId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [cost, setCost] = useState('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [personName, setPersonName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const data = await apiClient.get<Provider[]>('/providers');
        setProviders(data);
      } catch (error) {
        console.error("Error fetching providers:", error);
        // Optionally set an error state to show in the UI
      }
    };

    if (isOpen) {
      fetchProviders();
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const validate = () => {
    const newErrors: { [key: string]: string } = {};

    if (!name.trim()) {
      newErrors.name = 'اسم الصنف مطلوب';
    }

    if (!quantity) {
      newErrors.quantity = 'الكمية المبدئية مطلوبة';
    } else if (Number(quantity) < 0) {
      newErrors.quantity = 'الكمية يجب أن تكون 0 أو أكثر';
    }

    if (!unitId) { // unitId is string from select, check if empty
      newErrors.unitId = 'وحدة القياس مطلوبة';
    }

    if (cost && Number(cost) < 0) {
      newErrors.cost = 'التكلفة يجب أن تكون 0 أو أكثر';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!validate()) return;

    setApiError(null);
    setIsSaving(true);

      const payload = {
        name: name.trim(),
        initial_quantity: Number(quantity) || 0,
        unit_id: Number(unitId),
        sub_category_id: subCategoryId,
        provider_id: providerId ? Number(providerId) : null,
        cost: cost ? Number(cost) : null,
        person_name: personName.trim() || null,
      };

    const idempotencyKey = generateIdempotencyKey();

    try {
      await apiClient.post('/items', payload, {
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      toast.success('تمت إضافة الصنف بنجاح!');
      onItemAdded();
      resetForm();
      onClose();
      return;
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.data?.type === 'item_conflict') {
        if (window.confirm(`يوجد صنف بهذا الاسم "${payload.name}" وهو غير نشط أو مؤرشف. هل ترغب في استعادته وتفعيله لهذا القسم؟`)) {
          handleRestoreItem(err.data.item_id);
        } else {
          setApiError("يرجى اختيار اسم مختلف أو استعادة الصنف الحالي.");
          setIsSaving(false);
        }
      } else {
        setApiError(err.message || 'فشلت إضافة الصنف. يرجى المحاولة مرة أخرى.');
        setIsSaving(false);
      }
    }
  };

  const handleRestoreItem = async (itemId: number) => {
    if (isSaving) return;
    setIsSaving(true);
    setApiError(null);
    try {
      await apiClient.patch(`/items/${itemId}/restore`, {
        sub_category_id: subCategoryId,
        person_name: personName,
      });
      onItemAdded();
      toast.success('تم استعادة الصنف وتحديثه بنجاح!');
      resetForm();
      onClose();
    } catch (err: any) {
      setApiError(err.message || 'فشلت استعادة الصنف.');
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setName('');
    setQuantity('');
    setUnitId(''); // Reset to empty string for select
    setProviderId(''); // Reset providerId
    setCost('');
    setPersonName('');
    setErrors({});
  };

  const triggerSubmit = () => {
    // We can't get a real event here, so we create a fake one.
    // The preventDefault is the only thing we need.
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    handleSubmit(fakeEvent);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="إضافة صنف جديد"
      primaryActionText={isSaving ? "جارٍ الحفظ..." : "إضافة الصنف"}
      onPrimaryAction={triggerSubmit}
      isPrimaryActionDisabled={isSaving}
      secondaryActionText="إلغاء"
      onSecondaryAction={onClose}
    >
      {apiError && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium mb-4">{apiError}</p>}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="mb-3.5 md:col-span-2">
            <label htmlFor="name" className="block text-xs font-bold text-ink-700 mb-1.5">اسم الصنف <span className="text-rose-500">*</span></label>
            <input
              ref={nameInputRef}
              type="text"
              id="name"
              className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.name ? 'border-rose-500' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="أدخل اسم الصنف"
            />
            {errors.name && <p className="mt-1 text-xs font-medium text-rose-600">{errors.name}</p>}
          </div>

          <div className="mb-3.5">
            <label htmlFor="quantity" className="block text-xs font-bold text-ink-700 mb-1.5">الكمية المبدئية <span className="text-rose-500">*</span></label>
            <input
              type="number"
              id="quantity"
              className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.quantity ? 'border-rose-500' : ''}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="أدخل الكمية"
              min="0"
            />
            {errors.quantity && <p className="mt-1 text-xs font-medium text-rose-600">{errors.quantity}</p>}
          </div>

          <div className="mb-3.5">
            <label htmlFor="unit" className="block text-xs font-bold text-ink-700 mb-1.5">الوحدة <span className="text-rose-500">*</span></label>
            <select
              id="unit"
              className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.unitId ? 'border-rose-500' : ''}`}
              value={unitId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUnitId(e.target.value)}
            >
              <option value="">اختر وحدة</option>
              {units.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name}
                </option>
              ))}
            </select>
            {errors.unitId && <p className="mt-1 text-xs font-medium text-rose-600">{errors.unitId}</p>}
          </div>

          <div className="mb-3.5">
            <label htmlFor="provider" className="block text-xs font-bold text-ink-700 mb-1.5">المورد</label>
            <select
              id="provider"
              className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.providerId ? 'border-rose-500' : ''}`}
              value={providerId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProviderId(e.target.value)}
            >
              <option value="">اختر موردًا (اختياري)</option>
              {providers.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3.5">
            <label htmlFor="cost" className="block text-xs font-bold text-ink-700 mb-1.5">التكلفة للوحدة</label>
            <input
              type="number"
              id="cost"
              className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.cost ? 'border-rose-500' : ''}`}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="أدخل التكلفة"
              min="0"
              step="0.01"
            />
            {errors.cost && <p className="mt-1 text-xs font-medium text-rose-600">{errors.cost}</p>}
          </div>

          <div className="mb-3.5">
            <label htmlFor="personName" className="block text-xs font-bold text-ink-700 mb-1.5">اسم الشخص</label>
            <input
              type="text"
              id="personName"
              className="w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="أدخل اسم الشخص"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};
