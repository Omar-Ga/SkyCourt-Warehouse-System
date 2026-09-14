/* eslint-disable */
import React from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { EmptyState } from './EmptyState';

export type Column<T = any> = {
  key: string;
  header: string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  width?: string;
  align?: 'right' | 'center' | 'left';
  headerClassName?: string;
  cellClassName?: string;
};

export type TablePagination = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
};

export type TableProps<T = any> = {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T | string;
  onRowClick?: (row: T) => void;
  pagination?: TablePagination;
  isLoading?: boolean;
  skeletonRows?: number;
  rowClassName?: (row: T) => string;
  emptyState?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
  emptyActionLabel?: string;
  emptyOnAction?: () => void;
};

export const resolveColumnAlignment = (align?: 'right' | 'center' | 'left'): string => {
  if (align === 'center') return 'text-center';
  if (align === 'left') return 'text-left';
  return 'text-right';
};

export function Table<T extends Record<string, any>>({
  columns,
  data,
  keyField,
  onRowClick,
  pagination,
  isLoading,
  skeletonRows = 5,
  rowClassName,
  emptyState,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyActionLabel,
  emptyOnAction,
}: TableProps<T>) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-right text-xs">
          <thead className="bg-surface-canvas text-ink-600 font-bold border-b border-gray-200">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={`py-3.5 px-4 font-bold text-xs tracking-tight ${resolveColumnAlignment(column.align)} ${column.headerClassName || ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading &&
              Array.from({ length: Math.max(0, skeletonRows) }).map((_, rIdx) => (
                <tr key={`skeleton-${rIdx}`} className="animate-pulse">
                  {columns.map((column, cIdx) => (
                    <td key={`skeleton-cell-${cIdx}`} className={`py-3.5 px-4 ${resolveColumnAlignment(column.align)}`}>
                      <div
                        className={`h-4 bg-slate-200 rounded-md animate-pulse ${
                          column.align === 'center'
                            ? 'mx-auto w-12'
                            : column.align === 'left'
                            ? 'w-16'
                            : 'w-3/4'
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && data.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-0 border-none">
                  {emptyState || (
                    <EmptyState
                      title={emptyTitle || 'لا توجد بيانات للعرض'}
                      description={emptyDescription || 'لم يتم العثور على أي عناصر مسجلة في هذا الجدول.'}
                      icon={emptyIcon}
                      actionLabel={emptyActionLabel}
                      onAction={emptyOnAction}
                    />
                  )}
                </td>
              </tr>
            )}

            {!isLoading &&
              data.map((row, index) => (
                <tr
                  key={String(row[keyField] ?? index)}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={`hover:bg-slate-50/80 transition-colors ${
                    onRowClick ? 'cursor-pointer' : ''
                  } ${rowClassName ? rowClassName(row) : ''}`}
                >
                  {columns.map((column) => (
                    <td
                      key={`${String(row[keyField] ?? index)}-${column.key}`}
                      className={`py-3.5 px-4 text-xs text-ink-900 ${resolveColumnAlignment(column.align)} ${
                        column.cellClassName || ''
                      }`}
                    >
                      {column.render
                        ? column.render(row[column.key], row, index)
                        : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {pagination && (pagination.totalPages > 1 || (pagination.totalItems !== undefined && pagination.totalItems > 0)) && (
        <div className="py-3.5 px-4.5 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-ink-500">
          <div>
            {pagination.totalItems !== undefined ? (
              <>
                إجمالي النتائج: <strong className="text-ink-900">{pagination.totalItems}</strong> • الصفحة{' '}
                <strong className="text-ink-900">{pagination.currentPage}</strong> من{' '}
                <strong className="text-ink-900">{pagination.totalPages || 1}</strong>
              </>
            ) : (
              <>
                الصفحة <strong className="text-ink-900">{pagination.currentPage}</strong> من{' '}
                <strong className="text-ink-900">{pagination.totalPages}</strong>
              </>
            )}
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                disabled={pagination.currentPage <= 1}
                onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
              >
                <ChevronRight size={15} />
                <span>السابق</span>
              </button>
              <button
                type="button"
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                disabled={pagination.currentPage >= pagination.totalPages}
                onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
              >
                <span>التالي</span>
                <ChevronLeft size={15} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Table;
