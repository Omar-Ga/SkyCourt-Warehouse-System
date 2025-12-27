import React from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';

type TableProps = {
  columns: {
    key: string;
    header: string;
    render?: (value: any, row: any) => React.ReactNode;
    width?: string;
  }[];
  data: any[];
  keyField: string;
  onRowClick?: (row: any) => void;
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    totalItems?: number;
    itemsPerPage?: number;
  };
  isLoading?: boolean;
  rowClassName?: (row: any) => string;
};

export const Table = ({ columns, data, keyField, onRowClick, pagination, isLoading, rowClassName }: TableProps) => {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.width ? `w-${column.width}` : ''}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-gray-500">
                  <div className="flex justify-center items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    جاري التحميل...
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && data.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-gray-500">
                  لا توجد بيانات للعرض
                </td>
              </tr>
            )}
            {!isLoading && data.map((row) => (
              <tr
                key={row[keyField]}
                onClick={() => onRowClick && onRowClick(row)}
                className={`${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : ''} hover:bg-base-200 transition-colors`}
              >
                {columns.map((column) => (
                  <td key={`${row[keyField]}-${column.key}`}>
                    {column.render
                      ? column.render(row[column.key], row)
                      : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="py-3 px-4 border-t flex justify-start items-center gap-4">
          <div className="text-sm text-black">
            {pagination.itemsPerPage && pagination.totalItems !== undefined ? (
              `عرض ${Math.min((pagination.currentPage - 1) * pagination.itemsPerPage + 1, pagination.totalItems)} - ${Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems)} من ${pagination.totalItems} نتيجة`
            ) : (
              `صفحة ${pagination.currentPage} من ${pagination.totalPages}`
            )}
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary btn-sm"
              disabled={pagination.currentPage === 1}
              onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
            >
              <ChevronRight size={16} />
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={pagination.currentPage === pagination.totalPages}
              onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};