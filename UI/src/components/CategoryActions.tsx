import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Category } from '../types';
import { useCapabilities } from '../hooks/useCapabilities';

interface CategoryActionsProps {
  category: Category;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}

export const CategoryActions: React.FC<CategoryActionsProps> = ({ category, onEdit, onDelete }) => {
  const { canMutateCategories } = useCapabilities();

  // Office cannot render or invoke category actions
  if (!canMutateCategories) {
    return null;
  }

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  const actionBtnClass = "w-8 h-8 p-0 rounded-lg flex items-center justify-center bg-transparent hover:bg-slate-100 text-ink-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center justify-start gap-2" dir="ltr">
      {/* Edit Button */}
      <button 
        onClick={(e) => handleActionClick(e, () => onEdit(category))}
        className={actionBtnClass}
        title="تعديل اسم الفئة"
      >
        <Pencil size={16} />
      </button>

      {/* Delete Button */}
      <button 
        onClick={(e) => handleActionClick(e, () => onDelete(category))}
        className={`${actionBtnClass} text-rose-600 hover:text-rose-700 hover:bg-rose-50`}
        title="حذف الفئة"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
};