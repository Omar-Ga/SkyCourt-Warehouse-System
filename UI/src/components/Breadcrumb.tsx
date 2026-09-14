import React from 'react';
import { ChevronLeft } from 'lucide-react';

export interface BreadcrumbItemProps {
  id?: string;
  label: string;
  level?: string;
  isActive?: boolean;
  isClickable?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
}

export interface BreadcrumbProps {
  items: BreadcrumbItemProps[];
  className?: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className = '' }) => {
  if (!items || items.length === 0) return null;

  return (
    <nav
      className={`flex items-center gap-1.5 bg-white px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold shadow-xs select-none flex-wrap ${className}`}
      dir="rtl"
      aria-label="مسار التنقل"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const isClickable = item.isClickable ?? (!isLast && Boolean(item.onClick));

        return (
          <React.Fragment key={item.id || `${item.level || 'crumb'}-${index}`}>
            {index > 0 && (
              <ChevronLeft
                size={14}
                className="text-slate-400 shrink-0 mx-0.5"
                aria-hidden="true"
              />
            )}

            {isClickable && item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="inline-flex items-center gap-1.5 text-ink-600 hover:text-primary-600 hover:bg-primary-50 px-2 py-1 rounded-lg transition-colors cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary-500/20"
              >
                {item.icon && <span className="shrink-0 text-primary-600">{item.icon}</span>}
                <span className="leading-none">{item.label}</span>
              </button>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${
                  isLast || item.isActive
                    ? 'text-primary-600 font-bold bg-primary-50/60'
                    : 'text-ink-700'
                }`}
                aria-current={isLast || item.isActive ? 'page' : undefined}
              >
                {item.icon && <span className="shrink-0 text-primary-600">{item.icon}</span>}
                <span className="leading-none">{item.label}</span>
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
