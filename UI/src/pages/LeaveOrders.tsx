import React, { useState } from 'react';
import { Plus, Search, Send, Clock, CheckCircle2, AlertTriangle, Eye } from 'lucide-react';
import { useLeaveOrders } from '../hooks/useLeaveOrders';
import { useAuth } from '../context/AuthContext';
import { CreateLeaveOrderModal } from '../components/CreateLeaveOrderModal';
import { LeaveOrderDetailModal } from '../components/LeaveOrderDetailModal';
import { formatSafeDate } from '../services/statsService';

export const LeaveOrders: React.FC = () => {
  const { user } = useAuth();
  const canCreate = user?.role === 'office' || user?.role === 'admin';

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useLeaveOrders({
    page,
    page_size: pageSize,
    status: statusFilter || undefined,
    search: searchTerm || undefined
  });

  const orders = data?.leave_orders || [];
  const totalCount = data?.total_count || 0;
  const totalPages = data?.total_pages || 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & Search Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { label: 'الكل', value: '' },
            { label: 'مفتوح بالمخزن', value: 'open' },
            { label: 'مرفوض', value: 'rejected' },
            { label: 'مرتجع جزئياً', value: 'partially_returned' },
            { label: 'مغلق', value: 'closed' }
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                statusFilter === tab.value
                  ? 'bg-brand-violet text-white shadow-xs'
                  : 'bg-slate-100 text-ink-700 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search and New Leave Order Action */}
        <div className="flex items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="relative w-full md:w-72">
            <input
              type="text"
              className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 pl-10 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-violet/20 focus:border-brand-violet transition-all"
              placeholder="بحث برقم الإذن، المستلم، أو الوجهة..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button
              type="submit"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
            >
              <Search size={16} />
            </button>
          </form>

          {canCreate && (
            <button
              type="button"
              className="px-4 py-2.5 rounded-xl bg-brand-violet hover:bg-brand-violet-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors shrink-0 cursor-pointer"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus size={16} />
              <span>إنشاء إذن صرف جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Orders Table Card */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-ink-500">
            <div className="inline-block w-8 h-8 border-3 border-brand-violet border-t-transparent rounded-full animate-spin mb-3" />
            <p className="font-semibold text-sm">جاري تحميل أذونات الصرف...</p>
          </div>
        ) : isError ? (
          <div className="py-16 text-center text-rose-600">
            <AlertTriangle className="mx-auto mb-2 text-rose-500" size={32} />
            <p className="font-bold text-sm">حدث خطأ أثناء تحميل أذونات الصرف. يرجى المحاولة مرة أخرى.</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-ink-600">
            <div className="w-14 h-14 rounded-2xl bg-purple-50 text-brand-violet border border-purple-100 flex items-center justify-center mx-auto mb-3">
              <Send size={28} />
            </div>
            <h4 className="text-base font-bold text-ink-900 mb-1">لا توجد أذونات صرف مطابقة للبحث أو الفلتر المحدد</h4>
            <p className="text-xs text-ink-500 max-w-sm mx-auto">
              {searchTerm || statusFilter
                ? 'جرب تغيير شروط البحث أو الفلترة لتوسيع النتائج.'
                : 'يمكنك إنشاء إذن صرف جديد وحجزه ليقوم أمين المخزن بتسليمه.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-surface-canvas text-ink-600 border-b border-gray-200 font-bold">
                <tr>
                  <th className="py-3.5 px-4">رقم الإذن</th>
                  <th className="py-3.5 px-4">المستلم / الموظف</th>
                  <th className="py-3.5 px-4">جهة الصرف</th>
                  <th className="py-3.5 px-4">الحالة</th>
                  <th className="py-3.5 px-4 text-center">عدد الأصناف</th>
                  <th className="py-3.5 px-4 text-center">الكمية المطلوبة</th>
                  <th className="py-3.5 px-4 text-center">الكمية المصروفة</th>
                  <th className="py-3.5 px-4 text-center">المتبقي بالخارج</th>
                  <th className="py-3.5 px-4">تاريخ الإنشاء</th>
                  <th className="p-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="p-3 font-mono font-bold text-gray-800">
                      {order.order_number}
                    </td>
                    <td className="p-3 font-medium text-gray-900">{order.employee_name}</td>
                    <td className="p-3 text-gray-600">{order.destination_name}</td>
                    <td className="p-3">
                      {order.status === 'open' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                          <Clock size={12} /> مفتوح بالمخزن
                        </span>
                      )}
                      {order.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                          <AlertTriangle size={12} /> مرفوض
                        </span>
                      )}
                      {order.status === 'partially_returned' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          <AlertTriangle size={12} /> مرتجع جزئياً
                        </span>
                      )}
                      {order.status === 'closed' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                          <CheckCircle2 size={12} /> مغلق
                        </span>
                      )}
                      {order.status === 'cancelled' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">
                          ملغي
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-gray-600 text-center">{order.items_count}</td>
                    <td className="p-3 font-semibold text-gray-800 text-center">{order.total_requested_quantity ?? order.total_quantity}</td>
                    <td className="p-3 font-semibold text-emerald-700 text-center">{order.total_dispensed_quantity ?? 0}</td>
                    <td className="p-3 font-semibold text-primary-700 text-center">
                      {order.remaining_quantity}
                    </td>
                    <td className="p-3 text-xs text-gray-500">
                      {formatSafeDate(order.created_at)}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => setSelectedOrderId(order.id)}
                        className="btn btn-xs btn-outline flex items-center gap-1 mx-auto text-primary-600 border-primary-200 hover:bg-primary-50"
                      >
                        <Eye size={13} /> عرض التفاصيل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <div>
              إجمالي النتائج: <span className="font-semibold text-gray-700">{totalCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-xs btn-outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                السابق
              </button>
              <span>
                صفحة <span className="font-semibold text-gray-700">{page}</span> من{' '}
                <span className="font-semibold text-gray-700">{totalPages}</span>
              </span>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Creation Modal */}
      <CreateLeaveOrderModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={(created) => {
          refetch();
          if (created?.id) {
            setSelectedOrderId(created.id);
          }
        }}
      />

      {/* Detail Modal */}
      <LeaveOrderDetailModal
        orderId={selectedOrderId}
        isOpen={selectedOrderId !== null}
        onClose={() => setSelectedOrderId(null)}
      />
    </div>
  );
};
