import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Item, Unit } from '../types'; // Import shared types
import toast from 'react-hot-toast';
import { Printer, RefreshCw, Loader2 } from 'lucide-react';
import { PrintableBarcode } from './PrintableBarcode';

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
  barcode?: string | null;
  person_name?: string;
  force_unit_change?: boolean; // Optional property
}

export const EditItemModal = ({ isOpen, onClose, item, units, onItemUpdated }: EditItemModalProps) => {
  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState('');
  const [subCategoryId, setSubCategoryId] = useState<number | null | undefined>(null);
  const [barcode, setBarcode] = useState('');
  const [personName, setPersonName] = useState('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setUnitId(String(item.unit_id));
      setSubCategoryId(item.sub_category_id);
      setBarcode(item.barcode || '');
      setPersonName('');
      setErrors({});
      setIsSaving(false);
    } else {

      setName('');
      setUnitId('');
      setSubCategoryId(null);
      setBarcode('');
      setPersonName('');
      setErrors({});
      setIsSaving(false);
    }
  }, [item, isOpen]);

  const generateBarcode = () => {

    const random12 = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
    setBarcode(random12);
  };

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
        barcode: barcode.trim() || null,
        person_name: personName.trim() || 'System',
      };

      const attemptSubmit = async (forceChange = false) => {
        let payload: UpdateItemPayload = { ...updatedItemPayload };
        if (forceChange) {
          payload.force_unit_change = true;
        }

        try {
          const response = await fetch(`/api/items/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const responseData = await response.json();

          if (!response.ok) {
            if (response.status === 409 && responseData.type === "UNIT_CHANGE_CONFIRMATION") {
              // We need to keep isSaving true while confirm dialog is shown or reset it if cancelled?
              // The browser confirm is synchronous (blocking), so execution halts here.
              if (window.confirm(responseData.message)) {
                await attemptSubmit(true);
              } else {
                setErrors({ api: "Update cancelled by user." });
                setIsSaving(false);
              }
            } else {
              const errorMessage = responseData.message || responseData.error || 'Failed to update item';
              if (responseData.errors) {
                setErrors(prevErrors => ({ ...prevErrors, ...responseData.errors, api: errorMessage }));
              } else {
                setErrors({ api: errorMessage });
              }
              setIsSaving(false);
            }
            return;
          }
          onItemUpdated();
          onClose();
          toast.success(`تم تحديث الصنف "${item.name}" بنجاح.`);
          // No need to setIsSaving(false) here because component might unmount or reset on next open
        } catch (apiError: any) {
          console.error("Failed to update item:", apiError);
          setErrors({ api: apiError.message || "An unexpected error occurred." });
          setIsSaving(false);
        }
      };

      await attemptSubmit();
    }
  };

  const handleClose = () => {
    onClose();
  }

  const handlePrintClick = () => {
    if (barcode.trim()) {
      setIsPrintModalOpen(true);
    }
  };

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
            <label htmlFor="edit-barcode" className="form-label">
              <span>الباركود</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                id="edit-barcode"
                className="input flex-1"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder={item.barcode ? '' : "توليد أو إدخال الباركود"}
                disabled={!!item.barcode}
              />
              <button
                type="button"
                onClick={generateBarcode}
                className="btn btn-ghost btn-square"
                disabled={!!item.barcode || !!barcode}
                title={(!!item.barcode || !!barcode) ? 'لا يمكن تغيير الباركود بعد تعيينه' : 'توليد باركود تلقائي'}
              >
                <RefreshCw size={20} />
              </button>
              <button type="button" onClick={handlePrintClick} disabled={!barcode.trim()} className="btn btn-primary flex items-center gap-1 disabled:opacity-50">
                <Printer size={16} />
                طباعة
              </button>
            </div>
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
      {isPrintModalOpen && barcode && (
        <PrintableBarcode
          barcodeValue={barcode}
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
        />
      )}
    </Modal>
  );
}; 