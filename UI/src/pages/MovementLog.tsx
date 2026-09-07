import React, { useState } from 'react';
import { Filter, ArrowDown, ArrowUp, Package, User, Trash2, RotateCcw } from 'lucide-react';
import { Table } from '../components/Table';
import { AsyncPaginate, LoadOptions } from 'react-select-async-paginate';
import type { GroupBase, OptionsOrGroups } from 'react-select';
import { Item as SharedItem, MovementLogEntry } from '../types';
import { PrintReportButton } from '../components/PrintReportButton';
import { useDestinations, useProviders } from '../hooks/useMetadata';
import { useMovementLogs, FetchLogsParams, LogsResponse } from '../hooks/useMovementLogs';
import { UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';

import { formatMovementTimestamp } from '../services/statsService';

// Define ItemOption for react-select-async-paginate
interface ItemOption {
  value: number; // Item ID
  label: string; // Display string (e.g., "Item Name (Unit)")
  data: SharedItem; // Use shared Item type for the full item object
}

// Define LoadAdditional for pagination state
interface LoadAdditional {
  offset: number;
}

const ITEMS_PER_PAGE = 50; // Page size for fetching items

const AsyncPaginateComponent = AsyncPaginate as any; // Workaround for TS2786

const formatDate = (dateString: string) => {
  if (!dateString) return <span className="text-gray-400">-</span>;
  const { displayDate, displayTime } = formatMovementTimestamp(dateString);
  return (
    <div className="flex flex-col">
      <span>{displayDate}</span>
      <span className="text-xs text-gray-500 mt-1">{displayTime}</span>
    </div>
  );
};

export const MovementLog = () => {
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [filters, setFilters] = useState<FetchLogsParams>({
    date_from: '',
    date_to: '',
    item_id: '',
    provider_id: '',
    destination_id: '',
    action_type: '',
  });
  const [activeFilters, setActiveFilters] = useState<FetchLogsParams>({});
  const [selectedItemOption, setSelectedItemOption] = useState<ItemOption | null>(null);

  // Data Hooks
  const { data: destinations = [] } = useDestinations();
  const { data: providers = [] } = useProviders();

  const {
    data: logsData,
    isLoading: logsLoading,
    error: logsError
  } = useMovementLogs(activeFilters, { enabled: filtersApplied }) as UseQueryResult<LogsResponse, Error>;

  const logs = logsData?.logs || [];
  const totalLogs = logsData?.total_count || 0;
  const totalPages = logsData?.total_pages || 0;
  const currentPage = activeFilters.page || 1;
  const logsPerPage = 15;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Map input names to filter keys
    const keyMap: Record<string, keyof FetchLogsParams> = {
      fromDate: 'date_from',
      toDate: 'date_to'
    };
    const key = keyMap[name] || name as keyof FetchLogsParams;
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleItemSelectChange = (selectedOption: ItemOption | null) => {
    setSelectedItemOption(selectedOption);
    setFilters(prev => ({
      ...prev,
      item_id: selectedOption ? String(selectedOption.value) : '',
    }));
  };

  const loadItems: LoadOptions<ItemOption, GroupBase<ItemOption>, LoadAdditional | undefined> = async (
    searchQuery: string,
    _loadedOptions: OptionsOrGroups<ItemOption, GroupBase<ItemOption>>,
    additional?: LoadAdditional
  ): Promise<{ options: ItemOption[]; hasMore: boolean; additional?: LoadAdditional }> => {
    const offset = additional?.offset || 0;
    try {
      const params = new URLSearchParams();
      params.append('offset', String(offset));
      params.append('limit', String(ITEMS_PER_PAGE));
      if (searchQuery) {
        params.append('q', searchQuery);
      }

      const apiResponse = await apiClient.get<{ items: SharedItem[]; total_count: number }>(`/items?${params.toString()}`);

      const newOptions: ItemOption[] = apiResponse.items.map((item: SharedItem) => ({
        value: item.id,
        label: `${item.name} (${item.unit_name || 'N/A'})`,
        data: item,
      }));

      const currentTotalFetchedDirectlyInThisCall = newOptions.length;
      const newOffset = offset + currentTotalFetchedDirectlyInThisCall;

      const hasMore = newOffset < apiResponse.total_count;

      return {
        options: newOptions,
        hasMore: hasMore,
        additional: {
          offset: newOffset,
        },
      };
    } catch (error) {
      console.error('Error loading items:', error);
      return { options: [], hasMore: false, additional: { offset } };
    }
  };

  const applyFilters = (page = 1) => {
    setFiltersApplied(true);
    setActiveFilters({
      ...filters,
      page,
      page_size: logsPerPage
    });
  };

  const resetFilters = () => {
    setFilters({
      date_from: '',
      date_to: '',
      item_id: '',
      provider_id: '',
      destination_id: '',
      action_type: '',
    });
    setSelectedItemOption(null);
    setFiltersApplied(false);
    setActiveFilters({});
  };

  const columns = [
    {
      key: 'timestamp',
      header: 'التاريخ والوقت',
      render: (value: string) => formatDate(value),
      width: 'w-1/12 md:w-1/6'
    },
    {
      key: 'item_name',
      header: 'الصنف',
      render: (value: string, row: MovementLogEntry) => {
        const reference = row.return_event_id
          ? `مرتجع #${row.return_event_id}`
          : row.leave_line_id
          ? `إذن صرف #${row.leave_line_id}`
          : row.po_line_id
          ? `أمر شراء #${row.po_line_id}`
          : null;
        return (
          <div>
            <div className="flex items-center">
              <div className="p-1 rounded-full bg-primary-100 text-primary-600 mr-2 rtl:ml-2 rtl:mr-0">
                <Package size={16} />
              </div>
              <span className="font-medium">{value}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 ml-8 rtl:mr-8 rtl:ml-0">
              <span>#{row.item_id}</span>
              {reference && (
                <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[11px] font-medium">
                  {reference}
                </span>
              )}
            </div>
          </div>
        );
      },
      width: 'w-2/12 md:w-1/4'
    },
    {
      key: 'action_type',
      header: 'نوع الحركة',
      render: (value: string) => {
        if (value === 'Addition') {
          return (
            <div className="flex items-center text-success-600 font-medium">
              <ArrowUp size={16} className="mr-1 rtl:ml-1 rtl:mr-0" />
              <span>إضافة</span>
            </div>
          );
        } else if (value === 'Removal') {
          return (
            <div className="flex items-center text-error-600 font-medium">
              <ArrowDown size={16} className="mr-1 rtl:ml-1 rtl:mr-0" />
              <span>سحب</span>
            </div>
          );
        } else if (value === 'Return') {
          return (
            <div className="flex items-center text-amber-600 font-medium">
              <RotateCcw size={16} className="mr-1 rtl:ml-1 rtl:mr-0" />
              <span>مرتجع</span>
            </div>
          );
        } else {
          return <span className="text-gray-700">{value}</span>;
        }
      },
      width: 'w-1/12 md:w-1/12'
    },
    {
      key: 'person_name',
      header: 'بواسطة',
      render: (value: string | null | undefined, row: MovementLogEntry) => {
        const actor = row.actor_name || value;
        return actor ? (
          <div className="flex items-center text-sm text-gray-600">
            <User size={14} className="mr-1 rtl:ml-1 rtl:mr-0 text-gray-400" />
            {actor}
          </div>
        ) : (
          <span className="text-xs text-gray-400">غير محدد</span>
        );
      },
      width: 'w-1/12 md:w-1/6'
    },
    {
      key: 'quantity_changed',
      header: 'الكمية',
      render: (value?: number | null) => (value !== null && value !== undefined ? Math.abs(value) : '-'),
      width: 'w-1/12 md:w-1/12'
    },
    {
      key: 'destination_name',
      header: 'الوجهة',
      render: (value?: string | null) => value || '-',
      width: 'w-1/12 md:w-1/6'
    },
    {
      key: 'provider',
      header: 'المورد',
      render: (value?: string | null) => value || '-',
      width: 'w-1/12 md:w-1/6'
    },
    {
      key: 'cost_per_item',
      header: 'التكلفة',
      render: (value?: number | null) => (value !== null && value !== undefined ? value.toFixed(2) : '-'),
      width: 'w-1/12 md:w-1/12 hidden sm:table-cell'
    },
    {
      key: 'resulting_quantity',
      header: 'الرصيد',
      render: (value?: number | null) => value ?? '-',
      width: 'w-1/12 md:w-1/12'
    }
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">سجل الحركات</h1>

      <div className="card mb-6">
        <h2 className="text-lg font-medium mb-4">تصفية النتائج</h2>

        <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg shadow">
          {/* Date Filters */}
          <div className="flex-grow md:flex-grow-0">
            <label htmlFor="fromDate" className="text-sm font-medium text-gray-600 mb-1 block">من تاريخ</label>
            <input
              type="date"
              id="fromDate"
              name="fromDate"
              value={filters.date_from}
              onChange={handleInputChange}
              className="input input-bordered w-full"
            />
          </div>
          <div className="flex-grow md:flex-grow-0">
            <label htmlFor="toDate" className="text-sm font-medium text-gray-600 mb-1 block">إلى تاريخ</label>
            <input
              type="date"
              id="toDate"
              name="toDate"
              value={filters.date_to}
              onChange={handleInputChange}
              className="input input-bordered w-full"
            />
          </div>

          {/* Action Type Filter */}
          <div className="flex-grow md:flex-grow-0">
            <label htmlFor="actionType" className="text-sm font-medium text-gray-600 mb-1 block">نوع الحركة</label>
            <select
              id="actionType"
              name="actionType"
              value={filters.action_type || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, action_type: e.target.value }))}
              className="input input-bordered w-full"
            >
              <option value="">الكل</option>
              <option value="Addition">إضافة</option>
              <option value="Removal">سحب</option>
              <option value="Return">مرتجع</option>
            </select>
          </div>

          {/* Item Select */}
          <div className="flex-grow" style={{ minWidth: '250px' }}>
            <label htmlFor="item-select" className="text-sm font-medium text-gray-600 mb-1 block">
              الصنف
            </label>
            <AsyncPaginateComponent
              id="item-select"
              value={selectedItemOption}
              loadOptions={loadItems}
              onChange={handleItemSelectChange}
              isClearable
              placeholder="ابحث عن صنف..."
              debounceTimeout={300}
              classNamePrefix="react-select"
            />
          </div>

          {/* Destination Filter */}
          <div className="flex-grow md:flex-grow-0">
            <label htmlFor="destinationId" className="text-sm font-medium text-gray-600 mb-1 block">الوجهة</label>
            <select
              id="destinationId"
              name="destinationId"
              value={filters.destination_id}
              onChange={(e) => setFilters(prev => ({ ...prev, destination_id: e.target.value }))}
              className="input input-bordered w-full"
              disabled={false}
            >
              <option value="">الكل</option>
              {destinations.map((dest: any) => (
                <option key={dest.id} value={dest.id}>{dest.name}</option>
              ))}
            </select>
          </div>

          {/* Provider Filter */}
          <div className="flex-grow md:flex-grow-0">
            <label htmlFor="providerId" className="text-sm font-medium text-gray-600 mb-1 block">المورد</label>
            <select
              id="providerId"
              name="providerId"
              value={filters.provider_id}
              onChange={(e) => setFilters(prev => ({ ...prev, provider_id: e.target.value }))}
              className="input input-bordered w-full"
              disabled={false}
            >
              <option value="">الكل</option>
              {providers.map((prov: any) => (
                <option key={prov.id} value={prov.id}>{prov.name}</option>
              ))}
            </select>
          </div>

          {/* Action Buttons */}
          <div className="flex items-end gap-2">
            <button onClick={() => applyFilters(1)} className="btn btn-primary">
              <Filter size={16} className="ml-2 rtl:mr-2 rtl:ml-0" />
              تطبيق الفلاتر
            </button>
            <button onClick={resetFilters} className="btn btn-danger">
              <Trash2 size={16} className="ml-2 rtl:mr-2 rtl:ml-0" />
              مسح
            </button>
            <PrintReportButton
              filters={{
                fromDate: activeFilters.date_from || '',
                toDate: activeFilters.date_to || '',
                itemId: activeFilters.item_id || '',
                providerId: activeFilters.provider_id || '',
                destinationId: activeFilters.destination_id || '',
                actionType: activeFilters.action_type || ''
              }}
              disabled={!filtersApplied || logs.length === 0}
            />
          </div>
        </div>
      </div>

      {/* Log Display Area */}
      {logsLoading && (
        <div className="text-center p-8">
          <p>جاري تحميل سجل الحركات...</p>
        </div>
      )}

      {!logsLoading && logsError && (
        <div className="text-center p-8 text-error-500">
          <p>خطأ في تحميل السجل: {(logsError as Error).message}</p>
          <button onClick={() => applyFilters(currentPage as number)} className="btn btn-sm btn-link mt-2">
            حاول مرة أخرى
          </button>
        </div>
      )}

      {!logsLoading && !logsError && !filtersApplied && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <div className="text-gray-400 mb-4">
            <Filter size={48} className="mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-700">
            يرجى تحديد معايير التصفية وضغط "تطبيق الفلاتر"
          </h3>
          <p className="text-gray-500">
            يمكنك البحث حسب الفترة الزمنية والصنف والمورد
          </p>
        </div>
      )}

      {!logsLoading && !logsError && filtersApplied && logs.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <div className="text-gray-400 mb-4">
            <Filter size={48} className="mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-700">
            لا توجد سجلات تطابق معايير البحث.
          </h3>
          <p className="text-gray-500 mb-4">
            يرجى تعديل الفلاتر والمحاولة مرة أخرى.
          </p>
        </div>
      )}

      {!logsLoading && !logsError && filtersApplied && logs.length > 0 && (
        <>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-600">
              عرض {logs.length} من إجمالي {totalLogs} سجلات (صفحة {currentPage} من {totalPages})
            </p>
          </div>
          <Table
            columns={columns}
            data={logs}
            keyField="id"
            pagination={{
              currentPage,
              totalPages: totalPages,
              onPageChange: (newPage) => applyFilters(newPage),
              totalItems: totalLogs,
              itemsPerPage: logsPerPage
            }}
            isLoading={logsLoading}
          />
        </>
      )}
    </div>
  );
};