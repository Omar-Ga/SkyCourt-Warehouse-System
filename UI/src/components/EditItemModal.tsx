/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Item, Unit } from '../types'; // Import shared types
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../services/apiClient';
import { useCapabilities } from '../hooks/useCapabilities';

type EditItemModalProps = {
  isOpen: boolean;
  onClose: () => void;
  item: Item | null; // Use shared Item type
  units: Unit[]; // Use shared Unit type
  onItemUpdated: () => void; // Callback to refresh items list
};

interface UpdateItemPayload {
  name: string;
  unit_id: number;
  sub_category_id?: number | null;
  person_name?: string;
  force_unit_change?: boolean; // Optional property
}

export const EditItemModal = ({ isOpen, onClose, item, units, onItemUpdated }: EditItemModalProps) => {
  const { canMutateItems } = useCapabilities();
  if (!canMutateItems) return null;

  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState('');
  const [subCategoryId, setSubCategoryId] = useState<number | null | undefined>(null);
  const [personName, setPersonName] = useState('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setUnitId(String(item.unit_id));
      setSubCategoryId(item.sub_category_id);
      setPersonName('');
      setErrors({});
      setIsSaving(false);
    } else {

      setName('');
      setUnitId('');
      setSubCategoryId(null);
      setPersonName('');
      setErrors({});
      setIsSaving(false);
    }
  }, [item, isOpen]);

  const validate = () => {
    const newErrors: { [key: string]: string } = {};
    if (!name.trim()) newErrors.name = 'اسم الصنف مطلوب';
    if (!unitId) newErrors.unitId = 'وحدة القياس مطلوبة';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!item) return;
    setErrors({});

    if (validate()) {
      setIsSaving(true);
      const updatedItemPayload: Omit<UpdateItemPayload, 'force_unit_change'> = {
        name: name.trim(),
        unit_id: Number(unitId),
        sub_category_id: subCategoryId,
        person_name: personName.trim() || 'System',
      };

      const attemptSubmit = async (forceChange = false) => {
        const payload: UpdateItemPayload = { ...updatedItemPayload };
        if (forceChange) {
          payload.force_unit_change = true;
        }

        try {
          await apiClient.put(`/items/${item.id}`, payload);
          onItemUpdated();
          onClose();
          toast.success(`تم تحديث الصنف "${item.name}" بنجاح.`);
        } catch (apiErr: any) {
          if (apiErr instanceof ApiError && apiErr.status === 409 && apiErr.data?.type === 'UNIT_CHANGE_CONFIRMATION') {
            if (window.confirm(apiErr.data.message || apiErr.message)) {
              await attemptSubmit(true);
            } else {
              setErrors({ api: "Update cancelled by user." });
              setIsSaving(false);
            }
          } else {
            const errorMessage = apiErr.data?.message || apiErr.data?.error || apiErr.message || 'Failed to update item';
            if (apiErr.data?.errors) {
              setErrors(prevErrors => ({ ...prevErrors, ...apiErr.data.errors, api: errorMessage }));
            } else {
              setErrors({ api: errorMessage });
            }
            setIsSaving(false);
          }
        }
      };

      await attemptSubmit();
    }
  };

  const handleClose = () => {
    onClose();
  }

  const footer = (
    <>
      <button
        type="button"
        className="btn btn-outline ml-2"
        onClick={handleClose}
        disabled={isSaving}
      >
        إلغاء
      </button>
      <button
        type="button"
        className="btn btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
        onClick={() => handleSubmit()}
        disabled={isSaving}
      >
        {isSaving && <Loader2 size={16} className="ml-1 animate-spin" />}
        {isSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
      </button>
    </>
  );

  if (!item) return null; // Don't render if no item is selected

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`تعديل الصنف: ${item.name}`}
      footer={footer}
    >
      {errors.api && <p className="form-error bg-error-100 text-error-700 p-3 rounded-md mb-4">{errors.api}</p>}
      <form id="edit-item-form" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="form-group md:col-span-2">
            <label htmlFor="edit-name" className="form-label">اسم الصنف <span className="text-error-500">*</span></label>
            <input
              type="text"
              id="edit-name"
              className={`input ${errors.name ? 'border-error-500' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && <p className="form-error">{errors.name}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="edit-unit" className="form-label">وحدة القياس <span className="text-error-500">*</span></label>
            <select
              id="edit-unit"
              className={`select ${errors.unitId ? 'border-error-500' : ''}`}
              value={unitId} // unitId is string state for form
              onChange={(e) => setUnitId(e.target.value)}
            >
              <option value="">اختر وحدة</option>
              {units.map((u) => (
                <option key={u.id} value={String(u.id)}> {/* Ensure value is string for select options */}
                  {u.name}
                </option>
              ))}
            </select>
            {errors.unitId && <p className="form-error">{errors.unitId}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="edit-personName" className="form-label">اسم المُعدِّل</label>
            <input
              type="text"
              id="edit-personName"
              className="input"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="أدخل اسمك"
            />
          </div>

          <div className="form-group md:col-span-2">
            <label className="form-label">الفئة</label>
            <input
              type="text"
              className="input bg-base-200"
              disabled
              value={item.sub_category_name || 'N/A'}
            />
            <p className="text-xs text-gray-500 mt-1">لا يمكن تغيير الفئة من هنا. يرجى نقل الصنف إذا لزم الأمر.</p>
          </div>

        </div>
      </form>
    </Modal>
  );
};
