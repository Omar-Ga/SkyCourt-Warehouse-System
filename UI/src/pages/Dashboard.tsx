import { useState } from 'react';
import {
  Archive, ArrowUpCircle, ArrowDownCircle, Activity, Edit3, Info, AlertTriangle,
  PlusCircle, BarChart3, ScanLine, Search, RotateCcw
} from 'lucide-react';
import { AsyncPaginate, LoadOptions } from 'react-select-async-paginate';
import type { GroupBase, OptionsOrGroups } from 'react-select';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '../context/AppContext';
import { MovementLogEntry, Item } from '../types';
import { AddItemModal } from '../components/AddItemModal';
import { useDashboardStats, useRecentLogs } from '../hooks/useDashboardStats';
import { useUnits } from '../hooks/useMetadata';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { SoftRefreshButton } from '../components/SoftRefreshButton';
import { apiClient } from '../services/apiClient';
import { useCapabilities } from '../hooks/useCapabilities';

// Define ItemOption for react-select-async-paginate
interface ItemOption {
  value: number; // Item ID
  label: string; // Display string
  data: Item; // Full item object
}

// Define LoadAdditional for pagination state
interface LoadAdditional {
  offset: number;
}

const ITEMS_PER_PAGE = 20;

const AsyncPaginateComponent = AsyncPaginate as any; // Workaround for TS2786

export const Dashboard = () => {
  const { setActivePage, openScanner } = useAppContext();
  const { canAdjustQuantity, canMutateItems, canManagePOs } = useCapabilities();
  const queryClient = useQueryClient();

  // Hooks
  const { data: syncStatus = { connected: true, mode: 'cloud' } } = useSyncStatus();
  const { data: dashboardUnits = [] } = useUnits();

  const {
    data: stats = { additionsToday: 0, withdrawalsToday: 0, returnsToday: 0 },
    isLoading: isLoadingStats,
    error: statsError
  } = useDashboardStats();

  const {
    data: recentLogs = [],
    isLoading: isLoadingRecentLogs,
    error: recentLogsError
  } = useRecentLogs();

  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

  const handleItemAdded = () => {
    setIsAddItemModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
  };

  // Search Logic
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

      const apiResponse = await apiClient.get<{ items: Item[]; total_count: number }>(`/items?${params.toString()}`);

      const newOptions: ItemOption[] = apiResponse.items.map((item: Item) => ({
        value: item.id,
        label: `${item.name} (${item.unit_name || 'N/A'}) - ${item.barcode || 'No Barcode'}`,
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

  const handleSearchSelect = (selectedOption: ItemOption | null) => {
    if (!selectedOption) return;

    const item = selectedOption.data;

    // Store navigation data in sessionStorage
    const navigationData = {
      mainCategoryId: item.main_category_id,
      subCategoryId: item.sub_category_id,
      itemId: item.id,
      timestamp: Date.now()
    };

    sessionStorage.setItem('dashboardSearchNavigation', JSON.stringify(navigationData));

    // Navigate to Items Management
    setActivePage('Items');
  };

  const statsToDisplay = [
    {
      label: 'إضافات اليوم',
      value: stats.additionsToday.toString(),
      icon: <ArrowUpCircle className="text-primary-500" size={24} />,
      bgColor: 'bg-primary-100'
    },
    {
      label: 'مسحوبات اليوم',
      value: stats.withdrawalsToday.toString(),
      icon: <ArrowDownCircle className="text-error-500" size={24} />,
      bgColor: 'bg-error-100'
    },
    {
      label: 'مرتجعات اليوم',
      value: (stats.returnsToday ?? 0).toString(),
      icon: <RotateCcw className="text-amber-600" size={24} />,
      bgColor: 'bg-amber-100'
    },
  ];

  // Helper function to format timestamp
  const formatTimeAgo = (isoTimestamp: string) => {
    if (!isoTimestamp) return '';
    const date = (isoTimestamp.endsWith('Z') || isoTimestamp.includes('+'))
      ? new Date(isoTimestamp)
      : new Date(isoTimestamp.replace(' ', 'T'));
    const now = new Date();
    const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (seconds < 60) return `منذ ${Math.max(0, seconds)} ثوان`;
    if (minutes < 60) return `منذ ${minutes} دقائق`;
    if (hours < 24) return `منذ ${hours} ساعات`;
    return `منذ ${days} أيام`;
  };

  // Helper to get log icon and descriptive text
  const getLogDetails = (log: MovementLogEntry) => {
    let icon = <Activity size={18} className="text-gray-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
    let text = `${log.action_type} for item ${log.item_name}`;

    const actor = log.actor_name || log.person_name || 'بواسطة النظام';
    const absQty = Math.abs(log.quantity_changed ?? 0);

    switch (log.action_type) {
      case 'Addition': {
        icon = <ArrowUpCircle size={18} className="text-success-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
        const refInfo = log.po_line_id ? ` (أمر شراء #${log.po_line_id})` : '';
        text = `${actor} أضاف ${absQty} من "${log.item_name}"${refInfo}`;
        if (log.details && log.details.includes("created and initial quantity set")) {
          icon = <Archive size={18} className="text-primary-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
          text = `تم إنشاء "${log.item_name}"`;
        }
        break;
      }
      case 'Removal': {
        icon = <ArrowDownCircle size={18} className="text-error-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
        const refInfo = log.leave_line_id ? ` (إذن #${log.leave_line_id})` : '';
        text = `${actor} سحب ${absQty} من "${log.item_name}"${refInfo}`;
        break;
      }
      case 'Return': {
        icon = <RotateCcw size={18} className="text-amber-600 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
        const refInfo = log.return_event_id ? ` (مرتجع #${log.return_event_id})` : log.leave_line_id ? ` (إذن #${log.leave_line_id})` : '';
        text = `${actor} أرجع ${absQty} من "${log.item_name}"${refInfo}`;
        break;
      }
      case 'Update':
        icon = <Edit3 size={18} className="text-blue-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
        text = `تم تحديث بيانات "${log.item_name}". ${log.details ? `(${log.details})` : ''} بواسطة ${actor}.`;
        break;
      case 'Status Changed to Active':
        icon = <Info size={18} className="text-green-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
        text = `تم تفعيل الصنف "${log.item_name}" بواسطة ${actor}.`;
        break;
      case 'Status Changed to Inactive':
        icon = <AlertTriangle size={18} className="text-yellow-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
        text = `تم إلغاء تنشيط الصنف "${log.item_name}" بواسطة ${actor}.`;
        break;
      case 'Creation':
        icon = <PlusCircle size={18} className="text-primary-500 ml-3 rtl:mr-3 rtl:ml-0 flex-shrink-0" />;
        text = `تم إنشاء "${log.item_name}" بواسطة ${actor}`;
        break;
      default:
        text = `${log.action_type}: "${log.item_name}". ${log.details ? `(${log.details})` : ''} بواسطة ${actor}.`;
    }
    return { icon, text };
  };

  if (isLoadingStats) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
        <p className="ml-4 text-lg">جارٍ تحميل بيانات لوحة التحكم...</p>
      </div>
    );
  }

  if (statsError) {
    return (
      <div className="p-4 my-4 text-sm text-red-700 bg-red-100 rounded-lg" role="alert">
        <span className="font-medium">خطأ!</span> {(statsError as Error).message || "An error occurred"}
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold m-0">لوحة التحكم</h1>

        <div className="flex items-center space-x-4 rtl:space-x-reverse">
          {/* Soft Refresh Button */}
          <SoftRefreshButton />

          {/* Status Indicator */}
          <div className="flex items-center space-x-2 rtl:space-x-reverse">
            <div className={`flex items-center px-3 py-1 rounded-full text-xs font-medium ${syncStatus.connected
              ? 'bg-success-100 text-success-700'
              : 'bg-error-100 text-error-700'
              }`}>
              <div className={`w-2 h-2 rounded-full mr-2 rtl:ml-2 rtl:mr-0 ${syncStatus.connected ? 'bg-success-500' : 'bg-error-500 animate-pulse'
                }`} />
              {syncStatus.connected ? 'متصل' : 'غير متصل'}
            </div>
            {syncStatus.mode === 'local' && (
              <span className="text-[10px] text-gray-400 font-normal">(محلي فقط)</span>
            )}
          </div>
        </div>
      </div>



      {/* Stats Cards & Search */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-10">
        {/* Search Bar - Takes up 2 columns on desktop */}
        <div className="md:col-span-2 card p-5 flex flex-col justify-center shadow-sm">
          <label className="text-sm font-medium text-gray-600 mb-2 flex items-center gap-2">
            <Search size={16} />
            بحث سريع عن صنف
          </label>
          <AsyncPaginateComponent
            loadOptions={loadItems}
            onChange={handleSearchSelect}
            placeholder="ابحث باسم الصنف أو الباركود..."
            debounceTimeout={300}
            classNamePrefix="react-select"
            isClearable
            noOptionsMessage={() => "لا توجد نتائج"}
            additional={{ offset: 0 }}
          />
        </div>

        {statsToDisplay.map((stat, index) => (
          <div key={index} className="card flex items-center p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className={`p-3 rounded-full ml-4 rtl:mr-4 rtl:ml-0 ${stat.bgColor || 'bg-primary-100'}`}>
              {stat.icon}
            </div>
            <div>
              <p className="text-gray-500 text-sm">{stat.label}</p>
              <h3 className="text-2xl font-bold">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions Section */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 text-gray-700">إجراءات سريعة</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {canAdjustQuantity && (
            <button
              className="btn btn-primary btn-lg flex items-center justify-center py-4 px-6 text-base"
              onClick={openScanner}
            >
              <ScanLine size={20} className="ml-2 rtl:mr-2 rtl:ml-0" />
              قراءة الباركود
            </button>
          )}
          {canManagePOs && (
            <button
              className="btn btn-primary btn-lg flex items-center justify-center py-4 px-6 text-base"
              onClick={() => setActivePage('PurchaseOrders')}
            >
              <BarChart3 size={20} className="ml-2 rtl:mr-2 rtl:ml-0" />
              أوامر الشراء
            </button>
          )}
          <button
            className="btn btn-primary btn-lg flex items-center justify-center py-4 px-6 text-base"
            onClick={() => setActivePage('Logs')}
          >
            <BarChart3 size={20} className="ml-2 rtl:mr-2 rtl:ml-0" />
            عرض سجل الحركات
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 gap-8">
        {/* Recent Activity Section */}
        <div className="card p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-6 text-gray-700 text-center">آخر النشاطات</h2>
          {isLoadingRecentLogs && (
            <div className="flex justify-center items-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500"></div>
              <p className="ml-3 text-gray-600">جارٍ تحميل آخر النشاطات...</p>
            </div>
          )}
          {recentLogsError && (
            <div className="p-4 my-2 text-sm text-red-700 bg-red-100 rounded-lg text-center" role="alert">
              <span className="font-medium">خطأ في تحميل النشاطات!</span> {(recentLogsError as Error).message}
            </div>
          )}
          {!isLoadingRecentLogs && !recentLogsError && recentLogs.length === 0 && (
            <p className="text-center text-gray-500 py-4">لا توجد نشاطات حديثة لعرضها.</p>
          )}
          {!isLoadingRecentLogs && !recentLogsError && recentLogs.length > 0 && (
            <div className="space-y-4">
              {recentLogs.map((log) => {
                const { icon, text } = getLogDetails(log);
                return (
                  <div key={log.id} className="flex flex-col items-center p-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors">
                    <div className="flex items-center">
                      {icon}
                      <div className="text-center mx-3">
                        <p className="text-sm font-medium text-gray-800">{text}</p>
                        <p className="text-xs text-gray-500">{formatTimeAgo(log.timestamp)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="text-center mt-6">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setActivePage('Logs');
                  }}
                  className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                >
                  عرض كل النشاطات &rarr;
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AddItemModal Render */}
      {canMutateItems && isAddItemModalOpen && (
        <AddItemModal
          isOpen={isAddItemModalOpen}
          onClose={() => setIsAddItemModalOpen(false)}
          units={dashboardUnits}
          onItemAdded={handleItemAdded}
        />
      )}
    </div >
  );
};