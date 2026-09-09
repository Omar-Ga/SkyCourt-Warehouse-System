import { Edit2, Trash2, Plus } from 'lucide-react';
import { Category } from '../types';

interface MainCategoryCardProps {
  category?: Category;
  onSelect?: (category: Category) => void;
  onEdit?: (category: Category) => void;
  onDelete?: (category: Category) => void;
  onClick?: () => void;
  className?: string;
}

export const MainCategoryCard = ({ 
  category, 
  onSelect, 
  onEdit, 
  onDelete, 
  onClick,
  className = '' 
}: MainCategoryCardProps) => {
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit && category) onEdit(category);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete && category) onDelete(category);
  };

  const handleSelect = () => {
    if (onClick) {
      onClick();
    } else if (onSelect && category) {
      onSelect(category);
    }
  };

  // "Add New" Card UI
  if (!category) {
    return (
      <div
        className={`bg-white hover:bg-purple-50/50 rounded-2xl border-2 border-dashed border-brand-violet/40 hover:border-brand-violet cursor-pointer transition-all flex flex-col items-center justify-center p-6 shadow-xs group ${className}`}
        onClick={handleSelect}
      >
        <div className="w-12 h-12 rounded-xl bg-purple-50 text-brand-violet group-hover:scale-110 flex items-center justify-center transition-transform mb-2">
          <Plus size={24} />
        </div>
        <span className="text-sm font-bold text-brand-violet">إضافة فئة رئيسية</span>
      </div>
    );
  }

  // Standard Category Card UI
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-200 hover:border-brand-violet/50 hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between p-5 relative shadow-xs ${className}`}
      onClick={handleSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-ink-950 block truncate leading-tight group-hover:text-brand-violet transition-colors">
          {category.name}
        </h3>
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button
                type="button"
                className="w-7 h-7 rounded-lg text-ink-500 hover:text-brand-violet hover:bg-purple-50 flex items-center justify-center transition-colors cursor-pointer"
                onClick={handleEdit}
                title="تعديل الفئة"
              >
                <Edit2 size={13} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="w-7 h-7 rounded-lg text-ink-500 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors cursor-pointer"
                onClick={handleDelete}
                title="حذف الفئة"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-ink-400">
        <span className="font-semibold">تصفح الأقسام الفرعية</span>
        <span className="text-brand-violet font-bold text-sm">←</span>
      </div>
    </div>
  );
}; 