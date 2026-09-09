/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProviders } from '../hooks/useMetadata';
import { apiClient } from '../services/apiClient';
import { Plus } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Provider } from '../types';
import { ManagementItemCard } from '../components/ManagementItemCard';

// A dedicated modal for Adding/Editing a Provider
type ProviderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  provider?: Provider;
  onSave: (provider: { id?: number; name: string }) => Promise<void>;
  isSaving?: boolean;
  apiError?: string | null;
};

const ProviderModal: React.FC<ProviderModalProps> = ({ isOpen, onClose, provider, onSave, isSaving, apiError }) => {
  const [name, setName] = useState(provider?.name || '');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(provider?.name || '');
    setError('');
  }, [isOpen, provider]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('اسم المورد مطلوب');
      return;
    }
    setError('');
    await onSave({ id: provider?.id, name });
  };

  const footer = (
    <>
      <button type="button" className="btn btn-outline ml-2" onClick={onClose} disabled={isSaving}>
        إلغاء
      </button>
      <button type="submit" className="btn btn-primary" form="provider-form" disabled={isSaving}>
        {isSaving ? (provider ? 'جاري الحفظ...' : 'جاري الإضافة...') : (provider ? 'حفظ التغييرات' : 'إضافة مورد')}
      </button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={provider ? 'تعديل مورد' : 'إضافة مورد جديد'} footer={footer}>
      <form id="provider-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name" className="form-label">
            اسم المورد <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            id="name"
            className={`input input-bordered w-full ${(error || apiError) ? 'border-error-500' : ''}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setError('');
            }}
            placeholder="أدخل اسم المورد"
            disabled={isSaving}
          />
          {error && <p className="form-error">{error}</p>}
          {apiError && <p className="form-error">{apiError}</p>}
        </div>
      </form>
    </Modal>
  );
};

// A dedicated modal for confirming deletion
type DeleteConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  provider: Provider | null;
  onConfirm: () => Promise<void>;
  isDeleting?: boolean;
  apiError?: string | null;
};

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ isOpen, onClose, provider, onConfirm, isDeleting, apiError }) => {
  if (!provider) return null;

  const footer = (
    <>
      <button type="button" className="btn btn-outline ml-2" onClick={onClose} disabled={isDeleting}>
        إلغاء
      </button>
      <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isDeleting}>
        {isDeleting ? 'جاري الحذف...' : 'حذف'}
      </button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تأكيد الحذف" footer={footer} size="sm">
      <p className="mb-4">
        هل أنت متأكد من رغبتك في حذف المورد "{provider.name}"؟
      </p>
      {apiError ? (
        <div className="bg-error-100 border-l-4 border-error-500 text-error-700 p-4 mb-4" role="alert">
          <p className="font-bold">فشل الحذف</p>
          <p>{apiError}</p>
        </div>
      ) : (
        <div className="bg-warning-50 border border-warning-200 rounded p-3">
          <p className="text-warning-700 text-sm">
            ملاحظة: لا يمكن حذف المورد إذا كان مستخدماً من قبل أي صنف.
          </p>
        </div>
      )}
    </Modal>
  );
};

export const ProviderManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: providers = [], isLoading: loading, error } = useProviders();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentEditingProvider, setCurrentEditingProvider] = useState<Provider | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<Provider | null>(null);

  const [modalApiError, setModalApiError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: ['providers'] });
    queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
  };

  const handleAddProvider = async (providerData: { name: string }) => {
    setIsSaving(true);
    setModalApiError(null);
    try {
      await apiClient.post('/providers', providerData);
      invalidateData();
      setIsAddModalOpen(false);
    } catch (err: any) {
      setModalApiError(err.message || "فشل في إضافة المورد. قد يكون الاسم مستخدماً.");
    } finally {
      setIsSaving(false);
    }
  };

  const openEditModal = (provider: Provider) => {
    setCurrentEditingProvider(provider);
    setModalApiError(null);
    setIsEditModalOpen(true);
  };

  const handleEditProvider = async (providerData: { id?: number; name: string }) => {
    if (providerData.id === undefined) return;
    setIsSaving(true);
    setModalApiError(null);
    try {
      await apiClient.put(`/providers/${providerData.id}`, { name: providerData.name });
      invalidateData();
      setIsEditModalOpen(false);
      setCurrentEditingProvider(null);
    } catch (err: any) {
      setModalApiError(err.message || "فشل في تعديل المورد. قد يكون الاسم مستخدماً.");
    } finally {
      setIsSaving(false);
    }
  };

  const openDeleteModal = (provider: Provider) => {
    setProviderToDelete(provider);
    setModalApiError(null);
    setIsDeleteModalOpen(true);
  };

  const handleDeleteProvider = async () => {
    if (!providerToDelete) return;
    setIsDeleting(true);
    setModalApiError(null);
    try {
      await apiClient.delete(`/providers/${providerToDelete.id}`);
      invalidateData();
      setIsDeleteModalOpen(false);
      setProviderToDelete(null);
    } catch (err: any) {
      setModalApiError(err.message || "فشل في حذف المورد. تأكد أنه ليس قيد الاستخدام.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <div className="text-center p-8">جاري تحميل الموردين...</div>;
  }

  if (error && providers.length === 0) {
    return <div className="text-center p-8 text-error-500">خطأ: {(error as Error).message} <button onClick={() => invalidateData()} className="btn btn-sm btn-link">حاول مرة أخرى</button></div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold m-0">إدارة الموردين</h1>
        <button
          className="btn btn-primary flex items-center"
          onClick={() => {
            setModalApiError(null);
            setIsAddModalOpen(true);
          }}
        >
          <Plus size={18} className="ml-2" />
          إضافة مورد جديد
        </button>
      </div>

      {error && providers.length > 0 && (
        <div className="bg-error-100 border border-error-400 text-error-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">خطأ!</strong>
          <span className="block sm:inline"> {(error as Error).message}</span>
          <button onClick={() => invalidateData()} className="ml-4 text-sm underline">حاول مرة أخرى</button>
        </div>
      )}

      {providers.length === 0 && !loading && !error && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-700">لا يوجد موردين بعد</h3>
          <p className="text-gray-500 mb-4">أضف الموردين الذين يتم شراء الأصناف منهم</p>
          <button className="btn btn-primary" onClick={() => { setModalApiError(null); setIsAddModalOpen(true); }}>
            إضافة مورد جديد
          </button>
        </div>
      )}

      {providers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {providers.map((provider) => (
            <ManagementItemCard
              key={provider.id}
              item={{ id: provider.id, name: provider.name }}
              onEdit={() => openEditModal(provider)}
              onDelete={() => openDeleteModal(provider)}
            />
          ))}
        </div>
      )}

      <ProviderModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddProvider}
        isSaving={isSaving}
        apiError={modalApiError}
      />

      {currentEditingProvider && (
        <ProviderModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setCurrentEditingProvider(null);
          }}
          provider={currentEditingProvider}
          onSave={handleEditProvider}
          isSaving={isSaving}
          apiError={modalApiError}
        />
      )}

      {providerToDelete && (
        <DeleteConfirmModal
          isOpen={isDeleteModalOpen}
          onClose={() => {
            setIsDeleteModalOpen(false);
            setProviderToDelete(null);
          }}
          provider={providerToDelete}
          onConfirm={handleDeleteProvider}
          isDeleting={isDeleting}
          apiError={modalApiError}
        />
      )}
    </div>
  );
};
