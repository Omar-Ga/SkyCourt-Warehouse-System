import React, { useState } from 'react';
import { Eye, PackageCheck, Truck, Calendar, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { usePurchaseOrders, usePurchaseOrderDetail } from '../hooks/usePurchaseOrders';
import { POReceiptModal } from '../components/POReceiptModal';
import { PODetailModal } from '../components/PODetailModal';

export const POTickets: React.FC = () => {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const { data, isLoading } = usePurchaseOrders({ status: 'open', page_size: 50 });
  const { data: selected, isLoading: detailLoading } = usePurchaseOrderDetail(selectedId, { enabled: selectedId !== null });
  const { data: receipt } = usePurchaseOrderDetail(receiptId, { enabled: receiptId !== null });
  const orders = data?.purchase_orders || [];

  const totalUnitsExpected = orders.reduce((sum, order) => sum + (Number(order.total_ordered_quantity) || 0), 0);

  return (
    <div className="space-y-6 max-w-[1520px] mx-auto">
      {/* Quick Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-ink-500 mb-1">أوامر بانتظار الاستلام الفعلي</p>
            <h3 className="text-3xl font-extrabold text-ink-950 leading-none">{orders.length}</h3>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-brand-violet border border-purple-100 flex items-center justify-center shrink-0">
            <PackageCheck size={24} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-ink-500 mb-1">إجمالي الوحدات المتوقع فحصها</p>
            <h3 className="text-3xl font-extrabold text-brand-violet leading-none">{totalUnitsExpected.toLocaleString('ar-EG')}</h3>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center shrink-0">
            <Truck size={24} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-ink-500 mb-1">طبيعة العملية بالمخزن</p>
            <p className="text-sm font-bold text-emerald-700 leading-tight">استلام كامل وإضافة فورية للأرصدة</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center shrink-0">
            <CheckCircle2 size={24} />
          </div>
        </div>
      </div>

      {/* Main Receiving Tickets Table Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink-950 flex items-center gap-2">
            <PackageCheck size={20} className="text-brand-violet" />
            <span>قائمة تذاكر الشراء المفتوحة</span>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-brand-violet">
              {orders.length} تذكرة
            </span>
          </h2>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-ink-500">
            <div className="inline-block w-8 h-8 border-3 border-brand-violet border-t-transparent rounded-full animate-spin mb-3" />
            <p className="font-semibold text-sm">جاري تحميل أوامر الشراء المفتوحة...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-ink-600">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={28} />
            </div>
            <h4 className="text-base font-bold text-ink-900 mb-1">لا توجد أوامر شراء مفتوحة حالياً</h4>
            <p className="text-xs text-ink-500 max-w-sm mx-auto">
              تم استلام وإغلاق جميع التوريدات السابقة وإضافتها لأرصدة المستودع بنجاح.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-surface-canvas border-b border-gray-200 text-xs font-bold text-ink-600">
                <tr>
                  <th className="px-6 py-3.5">رقم الأمر</th>
                  <th className="px-6 py-3.5">المورد</th>
                  <th className="px-6 py-3.5">تاريخ الإرسال</th>
                  <th className="px-6 py-3.5">تاريخ الانتهاء</th>
                  <th className="px-6 py-3.5">إجمالي الكمية</th>
                  <th className="px-6 py-3.5 text-center">الإجراءات التشغيلية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 font-bold text-brand-violet">
                      <span className="font-mono text-sm">{order.po_number}</span>
                    </td>
                    <td className="px-6 py-4 font-semibold text-ink-900">
                      <div className="flex items-center gap-2">
                        <Truck size={16} className="text-ink-400 shrink-0" />
                        <span>{order.provider_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-ink-600">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={14} className="text-ink-400 shrink-0" />
                        <span>{order.dispatched_at || '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-ink-600">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className="text-ink-400 shrink-0" />
                        <span>{order.expires_at || '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-ink-900 text-xs font-bold font-mono">
                        {order.total_ordered_quantity} وحدة
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          className="px-4 py-2 rounded-xl bg-brand-violet hover:bg-brand-violet-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                          onClick={() => setReceiptId(order.id)}
                        >
                          <PackageCheck size={16} />
                          <span>استلام وإغلاق</span>
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          onClick={() => setSelectedId(order.id)}
                        >
                          <Eye size={15} />
                          <span>عرض</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <POReceiptModal
        order={receipt || null}
        isOpen={receiptId !== null}
        onClose={() => setReceiptId(null)}
        onSuccess={() => setReceiptId(null)}
      />
      <PODetailModal
        order={selected}
        isOpen={selectedId !== null}
        onClose={() => setSelectedId(null)}
        onUpdated={() => setSelectedId(null)}
        canVoid={false}
        isLoading={detailLoading}
      />
    </div>
  );
};
