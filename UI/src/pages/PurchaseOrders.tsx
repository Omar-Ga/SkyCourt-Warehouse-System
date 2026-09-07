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
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ClipboardList className="text-primary-600" size={26} />
            أوامر الشراء
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            إنشاء وإدارة ومتابعة أوامر الشراء للموردين وتتبع فترات الصلاحية والطباعة.
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            className="btn btn-primary flex items-center gap-2"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={18} />
            إنشاء أمر شراء جديد
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
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <input
            type="text"
            className="input w-full pl-9 pr-3 text-sm"
            placeholder="بحث برقم الأمر أو اسم المورد..."
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

      {/* Main Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">
            <span className="loading loading-spinner loading-md mb-2"></span>
            <p className="text-sm">جاري تحميل أوامر الشراء...</p>
          </div>
        ) : isError ? (
          <div className="p-12 text-center text-red-500">
            <AlertTriangle className="mx-auto mb-2 text-red-500" size={32} />
            <p className="font-semibold text-sm">حدث خطأ أثناء تحميل أوامر الشراء.</p>
            <button
              onClick={() => refetch()}
              className="btn btn-outline text-xs mt-3"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <ClipboardList className="mx-auto mb-2 text-gray-300" size={36} />
            <p className="font-semibold text-sm">لا توجد أوامر شراء مطابقة للبحث أو الفلتر المحدد.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">رقم الأمر</th>
                  <th className="py-3 px-4">المورد</th>
                  <th className="py-3 px-4">تاريخ الإنشاء</th>
                  <th className="py-3 px-4">صالح حتى</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4 text-center">عدد البنود</th>
                  <th className="py-3 px-4 text-center">إجمالي الكمية</th>
                  <th className="py-3 px-4 text-left">المبلغ الإجمالي</th>
                  <th className="py-3 px-4 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order: PurchaseOrderSummary) => (
                  <tr key={order.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-primary-700">
                      {order.po_number}
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-900">
                      {order.provider_name}
                    </td>
                    <td className="py-3 px-4 text-gray-500">{order.created_at}</td>
                    <td className="py-3 px-4 text-gray-500">{order.expires_at}</td>
                    <td className="py-3 px-4">{getStatusBadge(order.status)}</td>
                    <td className="py-3 px-4 text-center font-medium text-gray-700">
                      {order.line_count}
                    </td>
                    <td className="py-3 px-4 text-center font-medium text-gray-700">
                      {order.total_ordered_quantity}
                    </td>
                    <td className="py-3 px-4 text-left font-mono font-bold text-gray-800">
                      {order.total_amount} {order.currency}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => setSelectedPoId(order.id)}
                        className="btn btn-outline text-xs py-1 px-2.5 inline-flex items-center gap-1 text-primary-600 hover:text-primary-700"
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
        onCreated={() => {
          refetch();
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
