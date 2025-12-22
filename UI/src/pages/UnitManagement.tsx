import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUnits } from '../hooks/useMetadata';
import { apiClient } from '../services/apiClient';
import { Plus } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Unit } from '../types'; // Import shared Unit type
import { ManagementItemCard } from '../components/ManagementItemCard';




type UnitModalProps = {
  isOpen: boolean;
  onClose: () => void;
  unit?: Unit; // Use shared Unit type
  onSave: (unit: { id?: number; name: string }) => Promise<void>; // id is number from shared Unit
  initialName?: string; // For edit modal prefill
  isSaving?: boolean; // To disable save button during API call
  apiError?: string | null; // To display API errors in modal
};

const UnitModal = ({ isOpen, onClose, unit, onSave, initialName, isSaving, apiError }: UnitModalProps) => {
  const [name, setName] = useState(initialName || unit?.name || '');
  const [error, setError] = useState('');

  useEffect(() => {
    // Update name if initialName or unit changes (for edit)
    setName(initialName || unit?.name || '');
    setError(''); // Clear local error when modal reopens or unit changes
  }, [isOpen, unit, initialName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('اسم الوحدة مطلوب');
      return;
    }
    setError('');
    await onSave({ id: unit?.id, name }); // unit.id is number
  };

  const footer = (
    <>
      <button
        type="button"
        className="btn btn-outline ml-2"
        onClick={onClose}
        disabled={isSaving}
      >
        إلغاء
      </button>
      <button
        type="submit"
        className="btn btn-primary"
        form="unit-form"
        disabled={isSaving}
      >
        {isSaving ? (unit ? 'جاري الحفظ...' : 'جاري الإضافة...') : (unit ? 'حفظ التغييرات' : 'إضافة وحدة')}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={unit ? 'تعديل وحدة قياس' : 'إضافة وحدة قياس جديدة'}
      footer={footer}
    >
      <form id="unit-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name" className="form-label">
            اسم الوحدة <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            id="name"
            className={`input ${(error || apiError) ? 'border-error-500' : ''}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setError('');
            }}
            placeholder="أدخل اسم الوحدة (مثل: قطعة، متر، كيلو)"
            disabled={isSaving}
          />
          {error && <p className="form-error">{error}</p>}
          {apiError && <p className="form-error">{apiError}</p>}
        </div>
      </form>
    </Modal>
  );
};

type DeleteConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  unit: Unit | null; // Use shared Unit type
  onConfirm: () => Promise<void>;
  isDeleting?: boolean;
};

const DeleteConfirmModal = ({ isOpen, onClose, unit, onConfirm, isDeleting }: DeleteConfirmModalProps) => {
  if (!unit) return null;

  const footer = (
    <>
      <button
        type="button"
        className="btn btn-outline ml-2"
        onClick={onClose}
        disabled={isDeleting}
      >
        إلغاء
      </button>
      <button
        type="button"
        className="btn btn-danger"
        onClick={onConfirm}
        disabled={isDeleting}
      >
        {isDeleting ? 'جاري الحذف...' : 'حذف'}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="تأكيد الحذف"
      footer={footer}
      size="sm"
    >
      <p className="mb-4">
        هل أنت متأكد من رغبتك في حذف وحدة القياس "{unit.name}"؟
      </p>
      <div className="bg-error-50 border border-error-200 rounded p-3">
        <p className="text-error-700 text-sm">
          ملاحظة: لا يمكن حذف الوحدة إذا كانت مستخدمة من قبل أي صنف.
        </p>
      </div>
    </Modal>
  );
};

export const UnitManagement = () => {
  const queryClient = useQueryClient();
  const { data: units = [], isLoading: loading, error } = useUnits();

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentEditingUnit, setCurrentEditingUnit] = useState<Unit | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [unitToDelete, setUnitToDelete] = useState<Unit | null>(null);

  // Action States
  const [modalApiError, setModalApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: ['units'] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
  };

  const handleAddUnit = async (unitData: { name: string }) => {
    setIsSaving(true);
    setModalApiError(null);
    try {
      await apiClient.post('/units', unitData);
      invalidateData();
      setIsAddModalOpen(false);
    } catch (err: any) {
      console.error("Failed to add unit:", err);
      setModalApiError(err.message || "فشل في إضافة الوحدة. قد يكون الاسم مستخدماً.");
    } finally {
      setIsSaving(false);
    }
  };

  const openEditModal = (unit: Unit) => {
    setCurrentEditingUnit(unit);
    setModalApiError(null);
    setIsEditModalOpen(true);
  };

  const handleEditUnit = async (unitData: { id?: number; name: string }) => {
    if (unitData.id === undefined) return;
    setIsSaving(true);
    setModalApiError(null);
    try {
      await apiClient.put(`/units/${unitData.id}`, { name: unitData.name });
      invalidateData();
      setIsEditModalOpen(false);
      setCurrentEditingUnit(null);
    } catch (err: any) {
      console.error("Failed to update unit:", err);
      setModalApiError(err.message || "فشل في تعديل الوحدة. قد يكون الاسم مستخدماً.");
    } finally {
      setIsSaving(false);
    }
  };

  const openDeleteModal = (unit: Unit) => {
    setUnitToDelete(unit);
    setModalApiError(null); // Clear previous errors
    setIsDeleteModalOpen(true);
  };

  const handleDeleteUnit = async () => {
    if (!unitToDelete) return;
    setIsDeleting(true);
    setModalApiError(null);
    try {
      await apiClient.delete(`/units/${unitToDelete.id}`);
      invalidateData();
      setIsDeleteModalOpen(false);
      setUnitToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete unit:", err);
      setModalApiError(err.message || "فشل في حذف الوحدة. تأكد أنها ليست قيد الاستخدام.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <div className="text-center p-8">جاري تحميل الوحدات...</div>;
  }

  if (error && units.length === 0) { // Show general error only if no units are displayed
    return <div className="text-center p-8 text-error-500">خطأ: {(error as Error).message} <button onClick={() => invalidateData()} className="btn btn-sm btn-link">حاول مرة أخرى</button></div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6"> {/* Adjusted margin */}
        <h1 className="text-2xl font-bold m-0">إدارة وحدات القياس</h1>
        <button
          className="btn btn-primary flex items-center"
          onClick={() => {
            setModalApiError(null);
            setIsAddModalOpen(true);
          }}
        >
          <Plus size={18} className="ml-2" />
          إضافة وحدة جديدة
        </button>
      </div>

      {error && units.length > 0 && (
        <div className="bg-error-100 border border-error-400 text-error-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">خطأ!</strong>
          <span className="block sm:inline"> {(error as Error).message}</span>
          <button onClick={() => invalidateData()} className="ml-4 text-sm underline">حاول مرة أخرى</button>
        </div>
      )}

      {units.length === 0 && !loading && !error && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-700">
            لا توجد وحدات قياس بعد
          </h3>
          <p className="text-gray-500 mb-4">
            أضف وحدات القياس التي ستستخدمها في النظام
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              setModalApiError(null);
              setIsAddModalOpen(true);
            }}
          >
            إضافة وحدة جديدة
          </button>
        </div>
      )}

      {units.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"> {/* Responsive grid */}
          {units.map(unit => (
            <ManagementItemCard
              key={unit.id}
              item={unit}
              onEdit={openEditModal}
              onDelete={openDeleteModal}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <UnitModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddUnit}
        isSaving={isSaving}
        apiError={modalApiError}
      />

      {currentEditingUnit && (
        <UnitModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setCurrentEditingUnit(null);
          }}
          unit={currentEditingUnit}
          initialName={currentEditingUnit.name} // Pass initial name for controlled input
          onSave={handleEditUnit}
          isSaving={isSaving}
          apiError={modalApiError}
        />
      )}

      {unitToDelete && (
        <DeleteConfirmModal
          isOpen={isDeleteModalOpen}
          onClose={() => {
            setIsDeleteModalOpen(false);
            setUnitToDelete(null);
          }}
          unit={unitToDelete}
          onConfirm={handleDeleteUnit}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
};