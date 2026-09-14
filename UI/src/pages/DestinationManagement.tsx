/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDestinations } from '../hooks/useMetadata';
import { apiClient } from '../services/apiClient';
import { Plus, MapPin } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Destination } from '../types'; // Use the dedicated Destination type
import { ManagementItemCard } from '../components/ManagementItemCard';
import { PageLayout } from '../components/PageLayout';

type DestinationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  destination?: Destination;
  onSave: (destination: { id?: number; name: string }) => Promise<void>;
  initialName?: string;
  isSaving?: boolean;
  apiError?: string | null;
};

const DestinationModal = ({ isOpen, onClose, destination, onSave, initialName, isSaving, apiError }: DestinationModalProps) => {
  const [name, setName] = useState(initialName || destination?.name || '');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(initialName || destination?.name || '');
    setError('');
  }, [isOpen, destination, initialName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!name.trim()) {
      setError('اسم الوجهة مطلوب');
      return;
    }
    setError('');
    await onSave({ id: destination?.id, name });
  };

  const footer = (
    <>
      <button
        type="button"
        className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 shadow-2xs ml-2"
        onClick={onClose}
        disabled={isSaving}
      >
        إلغاء
      </button>
      <button
        type="submit"
        className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-xs"
        form="destination-form"
        disabled={isSaving}
      >
        {isSaving ? (destination ? 'جاري الحفظ...' : 'جاري الإضافة...') : (destination ? 'حفظ التغييرات' : 'إضافة وجهة')}
      </button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={destination ? 'تعديل وجهة' : 'إضافة وجهة جديدة'} footer={footer}>
      <form id="destination-form" onSubmit={handleSubmit}>
        <div className="mb-4">
          <label htmlFor="name" className="block text-xs font-bold text-ink-700 mb-1.5">اسم الوجهة <span className="text-error-500">*</span></label>
          <input
            type="text"
            id="name"
            className={`w-full h-10 px-3.5 py-2 bg-white border ${error || apiError ? 'border-rose-500' : 'border-gray-300'} rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all`}
            value={name}
            onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) setError(''); }}
            placeholder="أدخل اسم الوجهة"
            disabled={isSaving}
          />
          {error && <p className="mt-1 text-xs font-medium text-rose-600">{error}</p>}
          {apiError && <p className="mt-1 text-xs font-medium text-rose-600">{apiError}</p>}
        </div>
      </form>
    </Modal>
  );
};

type DeleteConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  destination: Destination | null;
  onConfirm: () => Promise<void>;
  isDeleting?: boolean;
};

const DeleteConfirmModal = ({ isOpen, onClose, destination, onConfirm, isDeleting }: DeleteConfirmModalProps) => {
  if (!destination) return null;

  const footer = (
    <>
      <button
        type="button"
        className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 shadow-2xs ml-2"
        onClick={onClose}
        disabled={isDeleting}
      >
        إلغاء
      </button>
      <button
        type="button"
        className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-rose-600 hover:bg-rose-700 text-white shadow-xs"
        onClick={onConfirm}
        disabled={isDeleting}
      >
        {isDeleting ? 'جاري الحذف...' : 'حذف'}
      </button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تأكيد الحذف" footer={footer} size="sm">
      <p className="mb-4">هل أنت متأكد من رغبتك في حذف الوجهة "{destination.name}"؟</p>
      <div className="bg-error-50 border border-error-200 rounded p-3">
        <p className="text-error-700 text-sm">ملاحظة: لا يمكن حذف الوجهة إذا كانت مستخدمة في أي سجل حركة.</p>
      </div>
    </Modal>
  );
};

export const DestinationManagement = () => {
  const queryClient = useQueryClient();
  const { data: destinations = [], isLoading: loading, error } = useDestinations();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentEditingDestination, setCurrentEditingDestination] = useState<Destination | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [destinationToDelete, setDestinationToDelete] = useState<Destination | null>(null);

  const [modalApiError, setModalApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: ['destinations'] });
    queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
  };



  const handleAddDestination = async (destinationData: { name: string }) => {
    if (isSaving) return;
    setIsSaving(true);
    setModalApiError(null);
    try {
      await apiClient.post('/destinations', destinationData);
      invalidateData();
      setIsAddModalOpen(false);
    } catch (err: any) {
      console.error("Failed to add destination:", err);
      setModalApiError(err.message || "فشل في إضافة الوجهة. قد يكون الاسم مستخدماً.");
    } finally {
      setIsSaving(false);
    }
  };

  const openEditModal = (destination: Destination) => {
    setCurrentEditingDestination(destination);
    setModalApiError(null);
    setIsEditModalOpen(true);
  };

  const handleEditDestination = async (destinationData: { id?: number; name: string }) => {
    if (destinationData.id === undefined || isSaving) return;
    setIsSaving(true);
    setModalApiError(null);
    try {
      await apiClient.put(`/destinations/${destinationData.id}`, { name: destinationData.name });
      invalidateData();
      setIsEditModalOpen(false);
      setCurrentEditingDestination(null);
    } catch (err: any) {
      console.error("Failed to update destination:", err);
      setModalApiError(err.message || "فشل في تعديل الوجهة. قد يكون الاسم مستخدماً.");
    } finally {
      setIsSaving(false);
    }
  };

  const openDeleteModal = (destination: Destination) => {
    setDestinationToDelete(destination);
    setModalApiError(null);
    setIsDeleteModalOpen(true);
  };

  const handleDeleteDestination = async () => {
    if (!destinationToDelete || isDeleting) return;
    setIsDeleting(true);
    setModalApiError(null);
    try {
      await apiClient.delete(`/destinations/${destinationToDelete.id}`);
      invalidateData();
      setIsDeleteModalOpen(false);
      setDestinationToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete destination:", err);
      setModalApiError(err.message || "فشل في حذف الوجهة. تأكد أنها ليست قيد الاستخدام.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <div className="text-center p-8">جاري تحميل الوجهات...</div>;
  }

  if (error && destinations.length === 0) {
    return <div className="text-center p-8 text-error-500">خطأ: {(error as Error).message} <button onClick={() => invalidateData()} className="text-sm font-semibold underline text-primary-600 hover:text-primary-700 cursor-pointer">حاول مرة أخرى</button></div>;
  }

  return (
    <PageLayout
      title="إدارة الوجهات"
      subtitle="إدارة جهات الصرف والأقسام المصرح لها باستلام المواد."
      icon={<MapPin size={22} className="text-primary-600" />}
      action={
        <button
          className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none cursor-pointer bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-xs"
          onClick={() => { setModalApiError(null); setIsAddModalOpen(true); }}
        >
          <Plus size={18} className="ml-2" />
          إضافة وجهة جديدة
        </button>
      }
    >
      <div>

      {error && destinations.length > 0 && (
        <div className="bg-error-100 border border-error-400 text-error-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">خطأ!</strong>
          <span className="block sm:inline"> {(error as Error).message}</span>
          <button onClick={() => invalidateData()} className="ml-4 text-sm underline">حاول مرة أخرى</button>
        </div>
      )}

      {destinations.length === 0 && !loading && !error && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-700">لا توجد وجهات بعد</h3>
          <p className="text-gray-500 mb-4">أضف الوجهات التي يتم إرسال الأصناف إليها</p>
          <button
            className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none cursor-pointer bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-xs"
            onClick={() => { setModalApiError(null); setIsAddModalOpen(true); }}
          >
            إضافة وجهة جديدة
          </button>
        </div>
      )}

      {destinations.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {destinations.map(destination => (
            <ManagementItemCard
              key={destination.id}
              item={destination}
              onEdit={openEditModal}
              onDelete={openDeleteModal}
            />
          ))}
        </div>
      )}

      <DestinationModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onSave={handleAddDestination} isSaving={isSaving} apiError={modalApiError} />

      {currentEditingDestination && (
        <DestinationModal
          isOpen={isEditModalOpen}
          onClose={() => { setIsEditModalOpen(false); setCurrentEditingDestination(null); }}
          destination={currentEditingDestination}
          initialName={currentEditingDestination.name}
          onSave={handleEditDestination}
          isSaving={isSaving}
          apiError={modalApiError}
        />
      )}

      {destinationToDelete && (
        <DeleteConfirmModal
          isOpen={isDeleteModalOpen}
          onClose={() => { setIsDeleteModalOpen(false); setDestinationToDelete(null); }}
          destination={destinationToDelete}
          onConfirm={handleDeleteDestination}
          isDeleting={isDeleting}
        />
      )}
      </div>
    </PageLayout>
  );
};
