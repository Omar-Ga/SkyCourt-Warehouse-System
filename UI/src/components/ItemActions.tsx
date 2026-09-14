import React from 'react';
import { Pencil, SlidersHorizontal, ToggleLeft, ToggleRight } from 'lucide-react';
import { Item } from '../types';
import { useCapabilities } from '../hooks/useCapabilities';

interface ItemActionsProps {
  item: Item;
  onAdjust: (item: Item) => void;
  onEdit: (item: Item) => void;
  onToggleStatus: (item: Item) => void;
}

export const ItemActions: React.FC<ItemActionsProps> = ({ item, onAdjust, onEdit, onToggleStatus }) => {
  const { canMutateItems } = useCapabilities();

  // Office cannot render or invoke item actions
  if (!canMutateItems) {
    return null;
  }

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation(); // Prevent row click event
    action();
  };

  const actionBtnClass = "w-8 h-8 p-0 rounded-lg flex items-center justify-center bg-transparent hover:bg-slate-100 text-ink-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center justify-end gap-2" dir="ltr">
      {/* Edit Button */}
      <button 
        onClick={(e) => handleActionClick(e, () => onEdit(item))}
        className={actionBtnClass}
        title="تعديل بيانات الصنف"
      >
        <Pencil size={16} />
      </button>

      {/* Adjust Quantity Button */}
      <button 
        onClick={(e) => handleActionClick(e, () => onAdjust(item))}
        className={actionBtnClass}
        disabled={item.status !== 'active'}
        title="تعديل الكمية"
      >
        <SlidersHorizontal size={16} />
      </button>

      {/* Toggle Status Button */}
      <button 
        onClick={(e) => handleActionClick(e, () => onToggleStatus(item))}
        className={actionBtnClass}
        title={item.status === 'active' ? 'تعيين كـ "غير نشط"' : 'تعيين كـ "نشط"'}
      >
        {item.status === 'active' 
          ? <ToggleRight size={16} className="text-emerald-600" /> 
          : <ToggleLeft size={16} className="text-rose-600" />}
      </button>
    </div>
  );
};