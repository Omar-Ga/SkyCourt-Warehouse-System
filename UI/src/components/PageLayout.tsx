import React from 'react';

export interface PageLayoutProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const PageLayout: React.FC<PageLayoutProps> = ({
  title,
  subtitle,
  icon,
  action,
  breadcrumbs,
  children,
  className = '',
}) => {
  return (
    <div className={`flex flex-col gap-6 w-full ${className}`} dir="rtl">
      {breadcrumbs && <div className="shrink-0">{breadcrumbs}</div>}

      <header className="bg-white border border-gray-200 rounded-2xl px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 shadow-xs">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0 text-primary-600">
              {icon}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-ink-950 m-0 leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-ink-500 m-0 mt-1 max-w-xl">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {action && (
          <div className="flex items-center gap-3 mr-auto shrink-0">
            {action}
          </div>
        )}
      </header>

      <div className="flex-1 w-full">
        {children}
      </div>
    </div>
  );
};

export default PageLayout;
