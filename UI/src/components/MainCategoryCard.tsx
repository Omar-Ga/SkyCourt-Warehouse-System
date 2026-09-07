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
        className={`card bg-base-200 hover:bg-base-300 cursor-pointer transition-colors flex items-center justify-center ${className}`}
        onClick={handleSelect}
      >
        <Plus size={40} className="text-success" />
        <span className="text-lg font-bold mt-2">إضافة فئة رئيسية</span>
      </div>
    );
  }

  // Standard Category Card UI
  return (
    <div
      className={`card bg-base-100 shadow-md hover:shadow-lg transition-shadow cursor-pointer group ${className}`}
      onClick={handleSelect}
    >
      <div className="card-body p-4 flex flex-col justify-between items-center">
        <h2 className="card-title text-center block truncate">{category.name}</h2>
        {(onEdit || onDelete) && (
          <div className="card-actions justify-center items-center opacity-0 group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button className="btn btn-xs btn-ghost" onClick={handleEdit} title="تعديل الفئة">
                <Edit2 size={14} />
              </button>
            )}
            {onDelete && (
              <button className="btn btn-xs btn-ghost" onClick={handleDelete} title="حذف الفئة">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}; 