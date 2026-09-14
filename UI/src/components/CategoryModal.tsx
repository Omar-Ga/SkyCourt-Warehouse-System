/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Category } from '../types';
import { useCapabilities } from '../hooks/useCapabilities';
import { useCreateCategory, useUpdateCategory } from '../hooks/useMetadata';

type CategoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  categoryToEdit?: Category | null;
  parentId?: number | null;
};

export const CategoryModal = ({ isOpen, onClose, onSave, categoryToEdit, parentId }: CategoryModalProps) => {
  const { canMutateCategories } = useCapabilities();
  if (!canMutateCategories) return null;

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const createCategoryMutation = useCreateCategory();
  const updateCategoryMutation = useUpdateCategory();
  const isPending = isSaving || createCategoryMutation.isPending || updateCategoryMutation.isPending;

  const isEditing = !!categoryToEdit;
  const title = isEditing
    ? `تعديل القسم: ${categoryToEdit.name}`
    : parentId
      ? 'إضافة قسم فرعي جديد'
      : 'إضافة قسم رئيسي جديد';

  useEffect(() => {
    if (isOpen) {
      if (isEditing && categoryToEdit) {
        setName(categoryToEdit.name);
      } else {
        setName('');
      }
      setError(null);
      setIsSaving(false);
    }
  }, [isOpen, isEditing, categoryToEdit]);

  const validate = () => {
    if (!name.trim()) {
      setError('اسم القسم مطلوب');
      return false;
    }
    setError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isPending) return;

    setError(null);
    setIsSaving(true);

    try {
      if (isEditing && categoryToEdit) {
        await updateCategoryMutation.mutateAsync({ id: categoryToEdit.id, name: name.trim() });
      } else {
        await createCategoryMutation.mutateAsync({ name: name.trim(), parent_id: parentId });
      }

      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message || 'فشل حفظ القسم');
    } finally {
      setIsSaving(false);
    }
  };

  const footer = (
    <>
      <button
        type="button"
        className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 shadow-2xs ml-2"
        onClick={onClose}
        disabled={isPending}
      >
        إلغاء
      </button>
      <button
        type="submit"
        className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-xs"
        form="category-form"
        disabled={isPending}
      >
        {isPending ? 'جارٍ الحفظ...' : isEditing ? 'حفظ التعديلات' : 'حفظ'}
      </button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} footer={footer}>
      <form id="category-form" onSubmit={handleSubmit}>
        {error && <p className="text-rose-600 text-xs font-medium mb-4">{error}</p>}
        <div className="mb-4">
          <label htmlFor="category-name" className="block text-xs font-bold text-ink-700 mb-1.5">
            اسم القسم <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            id="category-name"
            className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${error ? 'border-rose-500' : ''}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="أدخل اسم القسم"
            disabled={isPending}
            autoFocus
          />
        </div>
      </form>
    </Modal>
  );
};

