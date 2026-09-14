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

      <header className="bg-white border border-gray-200 rounded-2xl px-6 sm:px-7 py-5 sm:py-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 shadow-xs">
        <div className="flex items-center gap-3.5">
          {icon && (
            <div className="w-12 h-12 rounded-2xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0 text-primary-600">
              {icon}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black text-ink-950 m-0 leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-ink-500 m-0 mt-1.5 max-w-xl leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {action && (
          <div className="flex items-center gap-3 mr-auto shrink-0 [&_button]:min-h-[44px] [&_button]:text-sm [&_button]:font-black [&_button]:py-2.5 [&_button]:px-5 [&_button]:rounded-xl [&_button]:leading-normal">
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
