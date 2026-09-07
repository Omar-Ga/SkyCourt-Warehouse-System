import React, { useState } from 'react';
import { Plus, Search, Send, Clock, CheckCircle2, AlertTriangle, Eye } from 'lucide-react';
import { useLeaveOrders } from '../hooks/useLeaveOrders';
import { useAuth } from '../context/AuthContext';
import { CreateLeaveOrderModal } from '../components/CreateLeaveOrderModal';
import { LeaveOrderDetailModal } from '../components/LeaveOrderDetailModal';

export const LeaveOrders: React.FC = () => {
  const { user } = useAuth();
  const canCreate = user?.role === 'warehouse' || user?.role === 'admin';

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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Send className="text-primary-600" size={26} />
            أذونات الصرف
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            صرف المواد وتتبع الكميات المتبقية بالخارج وتذاكر الاسترجاع.
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            className="btn btn-primary flex items-center gap-2"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={18} />
            إنشاء إذن صرف جديد
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: 'الكل', value: '' },
            { label: 'مفتوح', value: 'open' },
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === tab.value
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-72">
          <input
            type="text"
            className="input w-full pl-9 pr-3 text-sm"
            placeholder="بحث برقم الإذن، المستلم، أو الوجهة..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button
            type="submit"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <Search size={16} />
          </button>
        </form>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">جاري تحميل أذونات الصرف...</div>
        ) : isError ? (
          <div className="p-12 text-center text-red-500">
            حدث خطأ أثناء تحميل أذونات الصرف. يرجى المحاولة مرة أخرى.
          </div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto w-12 h-12 mb-3 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
              <Send size={24} />
            </div>
            <h3 className="text-base font-semibold text-gray-700">لا توجد أذونات صرف مطابقة</h3>
            <p className="text-xs text-gray-500 mt-1">
              {searchTerm || statusFilter
                ? 'جرب تغيير شروط البحث أو الفلترة.'
                : 'يمكنك إنشاء إذن صرف جديد للصرف من المخزن.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-right text-sm">
              <thead className="bg-gray-50/80 text-gray-600 font-semibold border-b border-gray-100">
                <tr>
                  <th className="p-3">رقم الإذن</th>
                  <th className="p-3">المستلم / الموظف</th>
                  <th className="p-3">جهة الصرف</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">عدد الأصناف</th>
                  <th className="p-3">إجمالي المنصرف</th>
                  <th className="p-3">المتبقي بالخارج</th>
                  <th className="p-3">تاريخ الإنشاء</th>
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
                          <Clock size={12} /> مفتوح
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
                    </td>
                    <td className="p-3 text-gray-600">{order.items_count}</td>
                    <td className="p-3 font-semibold text-gray-800">{order.total_quantity}</td>
                    <td className="p-3 font-semibold text-primary-700">
                      {order.remaining_quantity}
                    </td>
                    <td className="p-3 text-xs text-gray-500">
                      {new Date(order.created_at).toLocaleDateString('ar-EG')}
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
        onSuccess={() => refetch()}
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
