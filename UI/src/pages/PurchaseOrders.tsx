import React, { useState } from 'react';
import {
  ClipboardList,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Eye
} from 'lucide-react';
import { usePurchaseOrders, usePurchaseOrderDetail } from '../hooks/usePurchaseOrders';
import { useCapabilities } from '../hooks/useCapabilities';
import { CreatePOModal } from '../components/CreatePOModal';
import { PODetailModal } from '../components/PODetailModal';
import { PurchaseOrderSummary } from '../services/poService';
import { formatSafeDate } from '../services/statsService';

export const PurchaseOrders: React.FC = () => {
  const capabilities = useCapabilities();
  const canCreate = capabilities.canManagePOs;

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = usePurchaseOrders({
    page,
    page_size: pageSize,
    status: statusFilter || undefined,
    search: searchTerm || undefined
  });

  const { data: selectedOrderDetail, isLoading: isLoadingDetail } = usePurchaseOrderDetail(selectedPoId, {
    enabled: selectedPoId !== null
  });

  const orders = data?.purchase_orders || [];
  const totalCount = data?.total_count || 0;
  const totalPages = data?.total_pages || 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
            <Clock size={12} />
            مسودة
          </span>
        );
      case 'open':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Clock size={12} />
            مفتوح
          </span>
        );
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 size={12} />
            مغلق
          </span>
        );
      case 'void':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <Ban size={12} />
            ملغي
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle size={12} />
            منتهي الصلاحية
          </span>
        );
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action & Search Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { label: 'الكل', value: '' },
            { label: 'مسودة', value: 'draft' },
            { label: 'مفتوح', value: 'open' },
            { label: 'منتهي الصلاحية', value: 'expired' },
            { label: 'مغلق (مستلم)', value: 'closed' },
            { label: 'ملغي', value: 'void' }
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

        {/* Search & New PO Action */}
        <div className="flex items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="relative w-full md:w-72">
            <input
              type="text"
              className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 pl-10 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-violet/20 focus:border-brand-violet transition-all"
              placeholder="بحث برقم الأمر أو اسم المورد..."
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
              <span>إنشاء أمر شراء جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-ink-500">
            <div className="inline-block w-8 h-8 border-3 border-brand-violet border-t-transparent rounded-full animate-spin mb-3" />
            <p className="font-semibold text-sm">جاري تحميل أوامر الشراء...</p>
          </div>
        ) : isError ? (
          <div className="py-16 text-center text-rose-600">
            <AlertTriangle className="mx-auto mb-2 text-rose-500" size={32} />
            <p className="font-bold text-sm">حدث خطأ أثناء تحميل أوامر الشراء.</p>
            <button
              onClick={() => refetch()}
              className="mt-3 px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 text-xs font-semibold cursor-pointer"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-ink-600">
            <div className="w-14 h-14 rounded-2xl bg-purple-50 text-brand-violet border border-purple-100 flex items-center justify-center mx-auto mb-3">
              <ClipboardList size={28} />
            </div>
            <h4 className="text-base font-bold text-ink-900 mb-1">لا توجد أوامر شراء مطابقة للبحث أو الفلتر المحدد</h4>
            <p className="text-xs text-ink-500 max-w-sm mx-auto">
              يمكنك إنشاء أمر شراء جديد وإرساله للمورد وللمخزن للاستلام.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-surface-canvas text-ink-600 border-b border-gray-200 font-bold">
                <tr>
                  <th className="py-3.5 px-4">رقم الأمر</th>
                  <th className="py-3.5 px-4">المورد</th>
                  <th className="py-3.5 px-4">تاريخ الإنشاء</th>
                  <th className="py-3.5 px-4">صالح حتى</th>
                  <th className="py-3.5 px-4">الحالة</th>
                  <th className="py-3.5 px-4 text-center">عدد البنود</th>
                  <th className="py-3.5 px-4 text-center">إجمالي الكمية</th>
                  <th className="py-3.5 px-4 text-left">المبلغ الإجمالي</th>
                  <th className="py-3.5 px-4 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order: PurchaseOrderSummary) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-brand-violet">
                      {order.po_number}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-ink-900">
                      {order.provider_name}
                    </td>
                    <td className="py-3.5 px-4 text-ink-500">{formatSafeDate(order.created_at)}</td>
                    <td className="py-3.5 px-4 text-ink-500">{order.status === 'draft' ? 'لا يوجد' : (order.expires_at ? formatSafeDate(order.expires_at) : '—')}</td>
                    <td className="py-3.5 px-4">{getStatusBadge(order.status)}</td>
                    <td className="py-3.5 px-4 text-center font-bold text-ink-800">
                      {order.line_count}
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-brand-violet">
                      {order.total_ordered_quantity}
                    </td>
                    <td className="py-3.5 px-4 text-left font-mono font-bold text-ink-900">
                      {order.total_amount} {order.currency}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => setSelectedPoId(order.id)}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                        title="عرض التفاصيل والطباعة"
                      >
                        <Eye size={14} />
                        عرض
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="p-4 border-t border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-500">
            <div>
              إجمالي النتائج: <strong className="text-gray-800">{totalCount}</strong> • الصفحة{' '}
              <strong className="text-gray-800">{page}</strong> من{' '}
              <strong className="text-gray-800">{totalPages}</strong>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn btn-outline py-1 px-2 text-xs"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                السابق
              </button>
              <button
                type="button"
                className="btn btn-outline py-1 px-2 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Purchase Order Modal */}
      <CreatePOModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(createdPO) => {
          refetch();
          if (createdPO?.id) {
            setSelectedPoId(createdPO.id);
          }
        }}
      />

      {/* Purchase Order Detail Modal */}
      {selectedPoId !== null && (
        <PODetailModal
          order={selectedOrderDetail || null}
          isOpen={selectedPoId !== null}
          onClose={() => setSelectedPoId(null)}
          onUpdated={() => {
            refetch();
          }}
          canVoid={canCreate}
          isLoading={isLoadingDetail}
        />
      )}
    </div>
  );
};
