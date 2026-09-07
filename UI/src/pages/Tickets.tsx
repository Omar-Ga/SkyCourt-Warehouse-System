import React, { useState } from 'react';
import { Receipt, Search, Eye, Undo2, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useTickets, useTicketsCount, useLeaveOrderDetail } from '../hooks/useLeaveOrders';
import { useAuth } from '../context/AuthContext';
import { LeaveOrderDetailModal } from '../components/LeaveOrderDetailModal';
import { ReturnModal } from '../components/ReturnModal';

export const Tickets: React.FC = () => {
  const { user } = useAuth();
  const canReturn = user?.role === 'office' || user?.role === 'admin';

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [statusFilter, setStatusFilter] = useState<string>('actionable');
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [returnTicketId, setReturnTicketId] = useState<number | null>(null);

  const { data, isLoading, isError, dataUpdatedAt, isFetching } = useTickets({
    page,
    page_size: pageSize,
    status: statusFilter || undefined,
    search: searchTerm || undefined
  });

  const { data: ticketsCountData, isError: isCountError } = useTicketsCount();
  const actionableCount = ticketsCountData?.count || 0;

  const { data: returnOrderDetail } = useLeaveOrderDetail(returnTicketId, {
    enabled: returnTicketId !== null
  });

  const tickets = data?.tickets || [];
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
            <Receipt className="text-primary-600" size={26} />
            تذاكر الصرف
            {isCountError ? (
              <span className="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1" title="تعذر تحديث العداد">
                <AlertTriangle size={12} /> تعذر التحديث
              </span>
            ) : actionableCount > 0 ? (
              <span className="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-bold">
                {actionableCount} معلقة
              </span>
            ) : null}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 mt-1">
            <p>
              متابعة تذاكر الصرف المفتوحة والمرتجعة جزئياً، تسجيل المرتجعات، وتوثيق الإغلاق.
            </p>
            {dataUpdatedAt > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                <Clock size={11} />
                آخر تحديث: {new Date(dataUpdatedAt).toLocaleTimeString('ar-EG')}
                {isFetching && <span className="text-primary-500 animate-pulse font-bold">...</span>}
              </span>
            )}
            {isError && (
              <span className="inline-flex items-center gap-1 text-xs text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded border border-red-100">
                <AlertTriangle size={12} /> تعذر تحديث القائمة
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: 'المعلقة (الافتراضي)', value: 'actionable' },
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
            placeholder="بحث برقم التذكرة، المستلم، أو الوجهة..."
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

      {/* Tickets Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">جاري تحميل تذاكر الصرف...</div>
        ) : isError ? (
          <div className="p-12 text-center text-red-500">حدث خطأ أثناء تحميل التذاكر.</div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            لا توجد تذاكر تطابق معايير البحث أو التصفية المحددة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-right">
              <thead className="bg-gray-50 text-gray-600 text-xs font-semibold border-b">
                <tr>
                  <th className="p-3">رقم التذكرة</th>
                  <th className="p-3">المستلم</th>
                  <th className="p-3">جهة الصرف</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">عدد الأصناف</th>
                  <th className="p-3">الكمية الأصلية</th>
                  <th className="p-3">المرتجع</th>
                  <th className="p-3">الرصيد المتبقي</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-gray-50/50">
                    <td className="p-3 font-semibold text-primary-700">
                      {ticket.order_number}
                    </td>
                    <td className="p-3 font-medium text-gray-800">{ticket.employee_name}</td>
                    <td className="p-3 text-gray-600">{ticket.destination_name}</td>
                    <td className="p-3 text-gray-500 text-xs">
                      {new Date(ticket.created_at).toLocaleDateString('ar-EG')}
                    </td>
                    <td className="p-3 text-gray-600">{ticket.items_count}</td>
                    <td className="p-3 font-semibold text-gray-700">{ticket.total_quantity}</td>
                    <td className="p-3 text-gray-600">{ticket.total_returned}</td>
                    <td className="p-3 font-bold text-primary-700">{ticket.remaining_quantity}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold">
                        {ticket.status === 'open' && (
                          <span className="text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Clock size={12} /> مفتوح
                          </span>
                        )}
                        {ticket.status === 'partially_returned' && (
                          <span className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <AlertTriangle size={12} /> مرتجع جزئياً
                          </span>
                        )}
                        {ticket.status === 'closed' && (
                          <span className="text-gray-700 bg-gray-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={12} /> مغلق
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          className="btn btn-xs btn-outline flex items-center gap-1 text-gray-600 hover:text-primary-600"
                          onClick={() => setSelectedTicketId(ticket.id)}
                          title="عرض التفاصيل"
                        >
                          <Eye size={14} />
                          عرض
                        </button>

                        {canReturn && ticket.remaining_quantity > 0 && (
                          <button
                            type="button"
                            className="btn btn-xs btn-primary bg-green-600 hover:bg-green-700 border-green-600 flex items-center gap-1 text-white"
                            onClick={() => setReturnTicketId(ticket.id)}
                            title="تسجيل مرتجع"
                          >
                            <Undo2 size={14} />
                            مرتجع
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex justify-between items-center text-xs text-gray-500">
            <span>
              عرض الصفحة {page} من {totalPages} (إجمالي {totalCount} تذكرة)
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="btn btn-xs btn-outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                السابق
              </button>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedTicketId !== null && (
        <LeaveOrderDetailModal
          orderId={selectedTicketId}
          isOpen={selectedTicketId !== null}
          onClose={() => setSelectedTicketId(null)}
        />
      )}

      {returnTicketId !== null && (
        <ReturnModal
          order={returnOrderDetail || null}
          isOpen={returnTicketId !== null}
          onClose={() => setReturnTicketId(null)}
        />
      )}
    </div>
  );
};

