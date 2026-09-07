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

  return (
    <div className="flex items-center justify-end gap-2 " dir="ltr">
      {/* Edit Button */}
      <button 
        onClick={(e) => handleActionClick(e, () => onEdit(item))}
        className="btn btn-ghost btn-sm btn-circle"
        title="تعديل بيانات الصنف"
      >
        <Pencil size={16} />
      </button>

      {/* Adjust Quantity Button */}
      <button 
        onClick={(e) => handleActionClick(e, () => onAdjust(item))}
        className="btn btn-ghost btn-sm btn-circle"
        disabled={item.status !== 'active'}
        title="تعديل الكمية"
      >
        <SlidersHorizontal size={16} />
      </button>

      {/* Toggle Status Button */}
      { <button 
        onClick={(e) => handleActionClick(e, () => onToggleStatus(item))}
        className="btn btn-ghost btn-sm btn-circle"
        title={item.status === 'active' ? 'تعيين كـ "غير نشط"' : 'تعيين كـ "نشط"'}
      >
        {item.status === 'active' 
          ? <ToggleRight size={16} className="text-success" /> 
          : <ToggleLeft size={16} className="text-error" />}
      </button> }
    </div>
  );
}; 