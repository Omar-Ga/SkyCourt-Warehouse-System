import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { Unit, Provider } from '../types'; // Import shared Unit and Provider types
import { RefreshCw, Printer } from 'lucide-react';
import { PrintableBarcode } from './PrintableBarcode';
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
  const [barcode, setBarcode] = useState('');
  const [personName, setPersonName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
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
      generateBarcode(); // Automatically generate barcode when modal opens
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
        barcode: barcode.trim() || null,
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
        if (window.confirm(`An item named "${payload.name}" is inactive or archived. Would you like to restore it to this category?`)) {
          handleRestoreItem(err.data.item_id);
        } else {
          setApiError("Please choose a different name or restore the existing item.");
          setIsSaving(false); 
        }
      } else {
        setApiError(err.message || 'Failed to add item. Please try again.');
        setIsSaving(false);
      }
    }
  };

  const handleRestoreItem = async (itemId: number) => {
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
      setApiError(err.message || 'Failed to restore item.');
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setName('');
    setQuantity('');
    setUnitId(''); // Reset to empty string for select
    setProviderId(''); // Reset providerId
    setCost('');
    setBarcode('');
    setPersonName('');
    setErrors({});
  };

  const generateBarcode = () => {
    // Generate a random 12-digit numeric string (EAN13 without checksum)
    const random12 = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
    setBarcode(random12);
  };

  const handlePrintClick = () => {
    if (barcode.trim()) {
      setIsPrintModalOpen(true);
    }
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
      primaryActionText="إضافة الصنف"
      onPrimaryAction={triggerSubmit}
      isPrimaryActionDisabled={isSaving}
      secondaryActionText="إلغاء"
      onSecondaryAction={onClose}
    >
      {apiError && <p className="form-error bg-error-100 text-error-700 p-3 rounded-md mb-4">{apiError}</p>}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="form-group md:col-span-2">
            <label htmlFor="name" className="form-label">اسم الصنف <span className="text-error-500">*</span></label>
            <input
              ref={nameInputRef}
              type="text"
              id="name"
              className={`input ${errors.name ? 'border-error-500' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="أدخل اسم الصنف"
            />
            {errors.name && <p className="form-error">{errors.name}</p>}
          </div>
          
          <div className="form-group">
            <label htmlFor="quantity" className="form-label">الكمية المبدئية <span className="text-error-500">*</span></label>
            <input
              type="number"
              id="quantity"
              className={`input ${errors.quantity ? 'border-error-500' : ''}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="أدخل الكمية"
              min="0"
            />
            {errors.quantity && <p className="form-error">{errors.quantity}</p>}
          </div>
          
          <div className="form-group">
            <label htmlFor="unit" className="form-label">الوحدة <span className="text-error-500">*</span></label>
            <select
              id="unit"
              className={`select ${errors.unitId ? 'border-error-500' : ''}`}
              value={unitId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUnitId(e.target.value)}
            >
              <option value="">اختر وحدة</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {errors.unitId && <p className="form-error">{errors.unitId}</p>}
          </div>
          
          <div className="form-group">
            <label htmlFor="provider" className="form-label">المورد</label>
            <select
              id="provider"
              className={`select ${errors.providerId ? 'border-error-500' : ''}`}
              value={providerId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProviderId(e.target.value)}
            >
              <option value="">اختر موردًا (اختياري)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label htmlFor="cost" className="form-label">التكلفة للوحدة</label>
            <input
              type="number"
              id="cost"
              className={`input ${errors.cost ? 'border-error-500' : ''}`}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="أدخل التكلفة"
              min="0"
              step="0.01"
            />
            {errors.cost && <p className="form-error">{errors.cost}</p>}
          </div>
          
          <div className="form-group">
            <label htmlFor="barcode" className="form-label flex items-center gap-2">
              <span>رمز الباركود</span>
              <button type="button" onClick={generateBarcode} title="توليد باركود تلقائي" className="text-primary-600 hover:text-primary-700">
                <RefreshCw size={20} />
              </button>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                id="barcode"
                className="input flex-1"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="أدخل رمز الباركود"
              />
              <button type="button" onClick={handlePrintClick} disabled={!barcode.trim()} className="btn btn-primary flex items-center gap-1 disabled:opacity-50">
                <Printer size={16} />
                طباعة
              </button>
            </div>
          </div>
          
          <div className="form-group">
            <label htmlFor="personName" className="form-label">اسم الشخص</label>
            <input
              type="text"
              id="personName"
              className="input"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="أدخل اسم الشخص"
            />
          </div>
        </div>
      </div>
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