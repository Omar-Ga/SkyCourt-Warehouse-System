/* eslint-disable */
import React, { useState } from 'react';
import {
  Package, ArrowDown, RotateCcw, Settings,
  PlusSquare, FileText, BarChart3, Bell, Clock,
  CheckCircle2
} from 'lucide-react';
import { AsyncPaginate, LoadOptions } from 'react-select-async-paginate';
import type { GroupBase, OptionsOrGroups } from 'react-select';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '../../context/AppContext';
import { useDashboardStats, useRecentLogs } from '../../hooks/useDashboardStats';
import { usePurchaseOrders } from '../../hooks/usePurchaseOrders';
import { useLeaveOrders } from '../../hooks/useLeaveOrders';
import { CreatePOModal } from '../../components/CreatePOModal';
import { CreateLeaveOrderModal } from '../../components/CreateLeaveOrderModal';
import { LeaveOrderDetailModal } from '../../components/LeaveOrderDetailModal';
import { apiClient } from '../../services/apiClient';
import { Item, MovementLogEntry } from '../../types';

interface ItemOption {
  value: number;
  label: string;
  data: Item;
}

interface LoadAdditional {
  offset: number;
}

const ITEMS_PER_PAGE = 20;
const AsyncPaginateComponent = AsyncPaginate as any;

export const OfficeDashboard: React.FC = () => {
  const { setActivePage, openPODetail } = useAppContext();
  const queryClient = useQueryClient();

  // State for modals
  const [isCreatePOOpen, setIsCreatePOOpen] = useState(false);
  const [isCreateLeaveOrderOpen, setIsCreateLeaveOrderOpen] = useState(false);
  const [selectedLeaveOrderId, setSelectedLeaveOrderId] = useState<number | null>(null);

  // Live query hooks
  const {
    data: stats = { additionsToday: 0, withdrawalsToday: 0, returnsToday: 0 },
  } = useDashboardStats();

  const {
    data: recentLogs = [],
  } = useRecentLogs(6);

  // Actionable Follow-up items: pending draft POs and rejected leave orders
  const { data: poData } = usePurchaseOrders({ status: 'draft', page_size: 5 });
  const { data: leaveOrderData } = useLeaveOrders({ status: 'rejected', page_size: 5 });

  // Convert numbers to Arabic-Indic digits to match mockup styling
  const toArabicDigits = (num: number | string | undefined | null) => {
    if (num === undefined || num === null) return '٠';
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return String(num).replace(/[0-9]/g, (w) => arabicDigits[+w]);
  };

  // Async Item Search
  const loadItems: LoadOptions<ItemOption, GroupBase<ItemOption>, LoadAdditional | undefined> = async (
    searchQuery: string,
    _loadedOptions: OptionsOrGroups<ItemOption, GroupBase<ItemOption>>,
    additional?: LoadAdditional
  ) => {
    const offset = additional?.offset || 0;
    try {
      const params = new URLSearchParams();
      params.append('offset', String(offset));
      params.append('limit', String(ITEMS_PER_PAGE));
      if (searchQuery) {
        params.append('q', searchQuery);
      }

      const res = await apiClient.get<{ items: Item[]; total_count: number }>(`/items?${params.toString()}`);
      const options: ItemOption[] = (res.items || []).map((item: Item) => ({
        value: item.id,
        label: `${item.name} (${item.unit_name || 'N/A'}) - #${item.id}`,
        data: item,
      }));

      const newOffset = offset + options.length;
      return {
        options,
        hasMore: newOffset < res.total_count,
        additional: { offset: newOffset }
      };
    } catch {
      return { options: [], hasMore: false, additional: { offset } };
    }
  };

  const handleSearchSelect = (selected: ItemOption | null) => {
    if (!selected) return;
    const item = selected.data;
    sessionStorage.setItem('dashboardSearchNavigation', JSON.stringify({
      mainCategoryId: item.main_category_id,
      subCategoryId: item.sub_category_id,
      itemId: item.id,
      timestamp: Date.now()
    }));
    setActivePage('Items');
  };

  // Format relative time in Arabic
  const formatTimeAgo = (isoTimestamp: string) => {
    if (!isoTimestamp) return '';
    const date = (isoTimestamp.endsWith('Z') || isoTimestamp.includes('+'))
      ? new Date(isoTimestamp)
      : new Date(isoTimestamp.replace(' ', 'T'));
    const now = new Date();
    const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);

    if (seconds < 60) return 'منذ لحظات';
    if (minutes < 60) return `منذ ${toArabicDigits(minutes)} دقيقة`;
    if (hours === 1) return 'منذ ساعة';
    if (hours === 2) return 'منذ ساعتين';
    if (hours < 24) return `منذ ${toArabicDigits(hours)} ساعات`;
    return `منذ ${toArabicDigits(Math.round(hours / 24))} أيام`;
  };

  // Format log activity row
  const formatLogRow = (log: MovementLogEntry) => {
    const actor = log.actor_name || log.person_name || 'النظام';
    const absQty = Math.abs(log.quantity_changed ?? 0);

    switch (log.action_type) {
      case 'Addition':
        return {
          user: actor,
          actionText: `أضاف ${toArabicDigits(absQty)} من ${log.item_name}`,
          refText: log.po_line_id ? `أمر شراء PO-${log.po_line_id}` : '',
          badgeType: 'addition' as const,
        };
      case 'Removal':
        return {
          user: actor,
          actionText: `أنشأ إذن صرف ${log.item_name}`,
          refText: log.leave_line_id ? `رقم ISS-${log.leave_line_id}` : '',
          badgeType: 'removal' as const,
        };
      case 'Return':
        return {
          user: actor,
          actionText: `قام بإرجاع ${toArabicDigits(absQty)} من ${log.item_name}`,
          refText: log.return_event_id ? `رقم RTN-${log.return_event_id}` : '',
          badgeType: 'return' as const,
        };
      default:
        return {
          user: actor,
          actionText: `${log.action_type} - ${log.item_name}`,
          refText: '',
          badgeType: 'addition' as const,
        };
    }
  };

  // Build actionable items list
  const draftPOs = poData?.purchase_orders || [];
  const rejectedLeaveOrders = leaveOrderData?.leave_orders || [];
  const hasFollowUps = draftPOs.length > 0 || rejectedLeaveOrders.length > 0;

  return (
    <div className="w-full max-w-[1520px] mx-auto pb-12 font-sans" dir="rtl">
      {/* 1. Header & Dedicated Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight m-0">لوحة تحكم المكتب</h1>
          <p className="text-xs font-semibold text-slate-400 m-0 mt-1">
            متابعة حركة المخزون، أوامر الشراء، وأذونات الصرف اليومية
          </p>
        </div>
        <div className="w-full md:w-96 lg:w-[420px]">
          <AsyncPaginateComponent
            loadOptions={loadItems}
            onChange={handleSearchSelect}
            placeholder="🔍 بحث سريع عن صنف بالاسم أو الكود..."
            debounceTimeout={300}
            classNamePrefix="office-search"
            isClearable
            noOptionsMessage={() => 'لا توجد أصناف مطابقة'}
            additional={{ offset: 0 }}
            styles={{
              control: (base: any) => ({
                ...base,
                borderRadius: '12px',
                borderColor: '#e2e8f0',
                boxShadow: 'none',
                backgroundColor: '#f8fafc',
                padding: '2px 6px',
                fontSize: '13px',
                fontFamily: 'Cairo',
                '&:hover': {
                  borderColor: '#cbd5e1'
                }
              }),
              placeholder: (base: any) => ({
                ...base,
                color: '#94a3b8',
                fontSize: '13px'
              })
            }}
          />
        </div>
      </div>

      {/* 2. Top Metric KPI Cards (3 Clean Cards in a Row) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        {/* Card 1: إضافات اليوم */}
        <div className="bg-white rounded-2xl border border-slate-100/90 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-bold text-slate-800">إضافات اليوم</span>
            <div className="w-12 h-12 rounded-full bg-[#e8f8ed] text-[#16a34a] flex items-center justify-center shrink-0">
              <Package size={22} className="stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-1">
            <div className="text-4xl lg:text-[42px] font-black text-[#16a34a] tracking-tight leading-none mb-1">
              {toArabicDigits(stats.additionsToday)}
            </div>
            <p className="text-xs font-semibold text-slate-400 m-0">صنف تمت إضافته</p>
          </div>
        </div>

        {/* Card 2: مسحوبات اليوم */}
        <div className="bg-white rounded-2xl border border-slate-100/90 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-bold text-slate-800">مسحوبات اليوم</span>
            <div className="w-12 h-12 rounded-full bg-[#fef3c7] text-[#d97706] flex items-center justify-center shrink-0">
              <ArrowDown size={22} className="stroke-[2.5]" />
            </div>
          </div>
          <div className="mt-1">
            <div className="text-4xl lg:text-[42px] font-black text-[#d97706] tracking-tight leading-none mb-1">
              {toArabicDigits(stats.withdrawalsToday)}
            </div>
            <p className="text-xs font-semibold text-slate-400 m-0">صنف تم صرفه</p>
          </div>
        </div>

        {/* Card 3: مرتجعات اليوم */}
        <div className="bg-white rounded-2xl border border-slate-100/90 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-bold text-slate-800">مرتجعات اليوم</span>
            <div className="w-12 h-12 rounded-full bg-[#fee2e2] text-[#dc2626] flex items-center justify-center shrink-0">
              <RotateCcw size={22} className="stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-1">
            <div className="text-4xl lg:text-[42px] font-black text-[#dc2626] tracking-tight leading-none mb-1">
              {toArabicDigits(stats.returnsToday)}
            </div>
            <p className="text-xs font-semibold text-slate-400 m-0">صنف تم إرجاعه</p>
          </div>
        </div>
      </div>

      {/* 3. Quick Actions Section (`إجراءات المكتب`) */}
      <div className="bg-white rounded-2xl border border-slate-100/90 p-6 shadow-xs mb-6">
        <div className="flex items-center gap-2.5 mb-5">
          <Settings size={22} className="text-[#1e3a8a] stroke-[2.2]" />
          <div>
            <h2 className="text-xl font-bold text-[#0f172a] tracking-tight m-0">
              إجراءات المكتب
            </h2>
            <p className="text-xs font-semibold text-slate-400 m-0 mt-0.5">
              أبرز العمليات التي يمكنك تنفيذها
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Action 1: إنشاء أمر شراء */}
          <button
            type="button"
            onClick={() => setIsCreatePOOpen(true)}
            className="w-full bg-[#004b87] hover:bg-[#003866] text-white font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-3 text-base shadow-sm hover:shadow-md transition-all cursor-pointer"
          >
            <PlusSquare size={22} className="stroke-[2.2]" />
            <span>إنشاء أمر شراء</span>
          </button>

          {/* Action 2: إنشاء إذن صرف */}
          <button
            type="button"
            onClick={() => setIsCreateLeaveOrderOpen(true)}
            className="w-full bg-white hover:bg-purple-50/50 border-2 border-[#5e2b8c] text-[#5e2b8c] font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-3 text-base shadow-xs hover:shadow-sm transition-all cursor-pointer"
          >
            <FileText size={22} className="stroke-[2.2]" />
            <span>إنشاء إذن صرف</span>
          </button>

          {/* Action 3: عرض التقارير */}
          <button
            type="button"
            onClick={() => setActivePage('Logs')}
            className="w-full bg-white hover:bg-slate-50 border-2 border-[#1e3a8a] text-[#1e3a8a] font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-3 text-base shadow-xs hover:shadow-sm transition-all cursor-pointer"
          >
            <BarChart3 size={22} className="stroke-[2.2]" />
            <span>عرض التقارير</span>
          </button>
        </div>
      </div>

      {/* 4. Bottom Grid: Actionable Follow-up Items & Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Right Column: طلبات تحتاج متابعة */}
        <div className="bg-white rounded-2xl border border-slate-100/90 p-6 shadow-xs flex flex-col">
          <div className="flex items-center gap-2.5 mb-5">
            <Bell size={20} className="text-[#0f172a] stroke-[2.2]" />
            <div>
              <h3 className="text-lg font-bold text-[#0f172a] tracking-tight m-0">
                طلبات تحتاج متابعة
              </h3>
              <p className="text-xs font-semibold text-slate-400 m-0 mt-0.5">
                طلبات وأوامر تتطلب إجراء من المكتب
              </p>
            </div>
          </div>

          <div className="space-y-3 flex-1">
            {hasFollowUps ? (
              <>
                {draftPOs.map((po) => (
                  <div
                    key={`po-${po.id}`}
                    className="bg-[#f8fafc] border border-slate-200/70 rounded-xl p-3.5 flex items-center justify-between hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 m-0">
                          أمر شراء مسودة ({po.po_number})
                        </h4>
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mt-0.5">
                          <span>المورد: {po.provider_name}</span>
                          <span>•</span>
                          <span>{toArabicDigits(po.line_count)} بنود</span>
                          <span>•</span>
                          <span>مسودة (بانتظار الإرسال)</span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openPODetail(po as any)}
                      className="px-4 py-1.5 rounded-lg bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1967d2] font-bold text-xs transition-colors cursor-pointer"
                    >
                      عرض وتعديل
                    </button>
                  </div>
                ))}

                {rejectedLeaveOrders.map((order) => (
                  <div
                    key={`lo-${order.id}`}
                    className="bg-[#fff5f5] border border-red-200/70 rounded-xl p-3.5 flex items-center justify-between hover:border-red-300 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0 mt-1.5" />
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 m-0">
                          إذن صرف مرفوض ({order.order_number})
                        </h4>
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mt-0.5">
                          <span>المستلم: {order.employee_name}</span>
                          <span>•</span>
                          <span>{order.destination_name}</span>
                          {order.rejection_reason && (
                            <>
                              <span>•</span>
                              <span className="text-red-600 font-medium truncate max-w-xs">{order.rejection_reason}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedLeaveOrderId(order.id)}
                      className="px-4 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs transition-colors cursor-pointer border border-rose-200"
                    >
                      تصحيح وإعادة إرسال
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <div className="py-12 px-4 text-center text-slate-500 flex flex-col items-center justify-center h-full">
                <CheckCircle2 size={36} className="text-emerald-500 mb-2 opacity-80" />
                <p className="font-bold text-slate-700 text-sm">لا توجد طلبات معلقة تتطلب المتابعة حالياً</p>
                <p className="text-xs text-slate-400 mt-1">جميع أوامر الشراء وأذونات الصرف مكتملة ومحدّثة.</p>
              </div>
            )}
          </div>
        </div>

        {/* Left Column: آخر النشاطات */}
        <div className="bg-white rounded-2xl border border-slate-100/90 p-6 shadow-xs flex flex-col">
          <div className="flex items-center gap-2.5 mb-5">
            <Clock size={20} className="text-[#1e3a8a] stroke-[2.2]" />
            <div>
              <h3 className="text-lg font-bold text-[#0f172a] tracking-tight m-0">
                آخر النشاطات
              </h3>
              <p className="text-xs font-semibold text-slate-400 m-0 mt-0.5">
                أحدث العمليات التي تمت في النظام
              </p>
            </div>
          </div>

          {recentLogs.length > 0 ? (
            <>
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-2 bg-[#f1f5f9] text-slate-700 font-bold text-xs py-2.5 px-4 rounded-xl mb-2">
                <div className="col-span-3 text-right">المستخدم</div>
                <div className="col-span-6 text-right">النشاط</div>
                <div className="col-span-3 text-left">الوقت</div>
              </div>

              {/* Table Rows */}
              <div className="divide-y divide-slate-100 flex-1">
                {recentLogs.slice(0, 5).map((log) => {
                  const formatted = formatLogRow(log);
                  return (
                    <div key={log.id} className="grid grid-cols-12 gap-2 items-center py-3 px-3 hover:bg-slate-50/70 rounded-lg transition-colors">
                      {/* User */}
                      <div className="col-span-3 text-sm font-bold text-slate-800 truncate">
                        {formatted.user}
                      </div>

                      {/* Activity */}
                      <div className="col-span-6 flex items-center gap-2.5">
                        {formatted.badgeType === 'addition' && (
                          <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 font-bold text-sm">
                            +
                          </div>
                        )}
                        {formatted.badgeType === 'removal' && (
                          <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 text-xs">
                            ➜
                          </div>
                        )}
                        {formatted.badgeType === 'return' && (
                          <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0 text-xs font-bold">
                            ↺
                          </div>
                        )}
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold text-slate-800 truncate m-0">
                            {formatted.actionText}
                          </p>
                          {formatted.refText && (
                            <p className="text-[11px] font-semibold text-slate-400 truncate m-0">
                              {formatted.refText}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Time */}
                      <div className="col-span-3 text-xs font-medium text-slate-400 text-left">
                        {formatTimeAgo(log.timestamp)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="py-12 px-4 text-center text-slate-500 flex flex-col items-center justify-center h-full">
              <Clock size={36} className="text-slate-300 mb-2" />
              <p className="font-bold text-slate-700 text-sm">لا توجد حركات مسجلة مؤخراً</p>
              <p className="text-xs text-slate-400 mt-1">ستظهر هنا أحدث عمليات الإضافة والصرف والإرجاع تلقائياً فور تسجيلها.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {isCreatePOOpen && (
        <CreatePOModal
          isOpen={isCreatePOOpen}
          onClose={() => setIsCreatePOOpen(false)}
          onCreated={() => {
            setIsCreatePOOpen(false);
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
          }}
        />
      )}

      {isCreateLeaveOrderOpen && (
        <CreateLeaveOrderModal
          isOpen={isCreateLeaveOrderOpen}
          onClose={() => setIsCreateLeaveOrderOpen(false)}
          onSuccess={() => {
            setIsCreateLeaveOrderOpen(false);
            queryClient.invalidateQueries({ queryKey: ['leave-orders'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
          }}
        />
      )}

      {selectedLeaveOrderId && (
        <LeaveOrderDetailModal
          orderId={selectedLeaveOrderId}
          isOpen={!!selectedLeaveOrderId}
          onClose={() => setSelectedLeaveOrderId(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['leave-orders'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
          }}
        />
      )}
    </div>
  );
};
