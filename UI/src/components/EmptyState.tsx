import React from 'react';
import { PackageOpen } from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  className = '',
}) => {
  return (
    <div
      className={`py-12 px-4 text-center flex flex-col items-center justify-center select-none ${className}`}
      dir="rtl"
    >
      <div className="w-16 h-16 rounded-2xl bg-primary-50 border border-primary-100/80 text-primary-600 flex items-center justify-center mb-3.5 shadow-2xs">
        {icon || <PackageOpen size={30} className="stroke-[1.8]" />}
      </div>
      <h3 className="text-base font-bold text-ink-950 m-0 mb-1 leading-snug">
        {title}
      </h3>
      {description && (
        <p className="text-xs font-semibold text-slate-400 m-0 max-w-sm leading-relaxed mb-4">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold inline-flex items-center gap-2 shadow-xs hover:shadow-sm transition-all cursor-pointer"
        >
          {actionIcon}
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
};
