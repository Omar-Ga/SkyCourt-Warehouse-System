import React from 'react';

export interface FilterTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  badgeColor?: string;
}

export interface FilterTabsProps<T extends string = string> {
  tabs: FilterTabItem<T>[];
  activeTab: T;
  onTabChange: (id: T) => void;
  className?: string;
}

export function FilterTabs<T extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  className = '',
}: FilterTabsProps<T>): React.ReactElement {
  return (
    <div
      className={`inline-flex items-center gap-1.5 p-1.5 bg-slate-100/80 rounded-xl border border-slate-200/70 select-none flex-wrap ${className}`}
      dir="rtl"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2.5 transition-all duration-150 cursor-pointer ${
              isActive
                ? 'bg-white text-primary-600 shadow-xs font-black'
                : 'text-slate-600 hover:text-ink-950 hover:bg-white/60'
            }`}
          >
            <span className="leading-normal">{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold leading-normal flex items-center justify-center ${
                  isActive
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
