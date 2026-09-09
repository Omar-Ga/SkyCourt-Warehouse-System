import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, PackageCheck, Search } from 'lucide-react';
import { useTickets, useTicketsCount, useFulfillLeaveOrder, useRejectLeaveOrder, useLeaveOrderDetail } from '../hooks/useLeaveOrders';
import { generateIdempotencyKey } from '../services/apiClient';
import { LeaveOrderDetailModal } from '../components/LeaveOrderDetailModal';

export const DisbursementTickets: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading, isError } = useTickets({ status: 'open', search: search || undefined, page_size: 50 });
  const { data: count } = useTicketsCount();
  const { data: selected } = useLeaveOrderDetail(rejectingId, { enabled: rejectingId !== null });
  const fulfill = useFulfillLeaveOrder();
  const reject = useRejectLeaveOrder();
  const tickets = data?.tickets || [];

  const fulfillTicket = async (id: number, revision: number) => {
    await fulfill.mutateAsync({ id, expected_revision: revision, idempotencyKey: generateIdempotencyKey() });
  };

  const rejectTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    await reject.mutateAsync({
      id: selected.id,
      input: { expected_revision: selected.revision, reason: reason.trim() },
      idempotencyKey: generateIdempotencyKey()
    });
    setReason('');
    setRejectingId(null);
  };

  return (
    <div className="space-y-6 max-w-[1520px] mx-auto">
      {/* Search and Filters Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-brand-violet border border-purple-100 flex items-center justify-center shrink-0">
            <PackageCheck size={22} />
          </div>
          <div>
            <h3 className="text-base font-bold text-ink-950 m-0 leading-tight">
              طلبات الصرف المحجوزة بالمخزن
            </h3>
            <p className="text-xs text-ink-500 m-0 mt-0.5">
              إجمالي {count?.count || 0} طلب جاهز للتسليم الفعلي
            </p>
          </div>
        </div>

        <div className="relative w-full md:w-80">
          <input
            className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 pl-10 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-violet/20 focus:border-brand-violet transition-all"
            placeholder="بحث برقم التذكرة أو الوجهة أو المستلم..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
        </div>
      </div>

      {/* Main Tickets Table Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink-950 flex items-center gap-2">
            <span>تذاكر الصرف بانتظار التسليم</span>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-brand-violet">
              {tickets.length} تذكرة
            </span>
          </h2>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-ink-500">
            <div className="inline-block w-8 h-8 border-3 border-brand-violet border-t-transparent rounded-full animate-spin mb-3" />
            <p className="font-semibold text-sm">جاري تحميل تذاكر الصرف...</p>
          </div>
        ) : isError ? (
          <div className="py-16 text-center text-rose-600">
            <AlertTriangle size={32} className="mx-auto mb-2 text-rose-500" />
            <p className="font-bold text-sm">تعذر تحميل تذاكر الصرف. يرجى إعادة المحاولة.</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="py-16 text-center text-ink-600">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={28} />
            </div>
            <h4 className="text-base font-bold text-ink-900 mb-1">لا توجد طلبات صرف مفتوحة حالياً</h4>
            <p className="text-xs text-ink-500 max-w-sm mx-auto">
              تم تنفيذ وتسليم جميع أذونات الصرف السابقة وإغلاق تذاكرها بنجاح.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-surface-canvas border-b border-gray-200 text-xs font-bold text-ink-600">
                <tr>
                  <th className="px-6 py-3.5">رقم التذكرة</th>
                  <th className="px-6 py-3.5">المستلم / الموظف</th>
                  <th className="px-6 py-3.5">جهة الصرف / القسم</th>
                  <th className="px-6 py-3.5 text-center">عدد الأصناف</th>
                  <th className="px-6 py-3.5 text-center">الكمية المحجوزة</th>
                  <th className="px-6 py-3.5 text-center">الإجراءات التنفيذية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 font-bold text-brand-violet">
                      <span className="font-mono text-sm">{ticket.order_number}</span>
                    </td>
                    <td className="px-6 py-4 font-semibold text-ink-900">
                      {ticket.employee_name}
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-ink-600">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-100 text-slate-800">
                        {ticket.destination_name}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-mono font-bold text-ink-900 text-xs">
                        {ticket.items_count} صنف
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-purple-50 text-brand-violet text-xs font-bold font-mono">
                        {ticket.total_quantity} وحدة
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          className="px-4 py-2 rounded-xl bg-brand-violet hover:bg-brand-violet-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                          onClick={() => fulfillTicket(ticket.id, ticket.revision)}
                          disabled={fulfill.isPending}
                        >
                          <CheckCircle2 size={16} />
                          <span>صرف وإغلاق</span>
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          onClick={() => setRejectingId(ticket.id)}
                          disabled={reject.isPending}
                        >
                          <span>رفض</span>
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          onClick={() => setSelectedId(ticket.id)}
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

      <LeaveOrderDetailModal orderId={selectedId} isOpen={selectedId !== null} onClose={() => setSelectedId(null)} />

      {rejectingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={rejectTicket} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 border border-gray-200">
            <h2 className="font-bold text-lg flex items-center gap-2 text-rose-700">
              <AlertTriangle className="text-rose-600" />
              <span>رفض تذكرة الصرف وإعادتها للمكتب</span>
            </h2>
            <p className="text-xs text-ink-600 leading-relaxed">
              يرجى توضيح سبب الرفض بدقة (مثل: تلف المواد، خطأ في المواصفات، أو عدم تطابق). سبب الرفض إلزامي وسيظهر لموظف المكتب فوراً.
            </p>
            <textarea
              className="w-full bg-slate-50 border border-gray-200 rounded-xl p-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="اكتب سبب رفض الصرف هنا..."
              required
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 text-xs font-semibold transition-colors cursor-pointer"
                onClick={() => setRejectingId(null)}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                disabled={reject.isPending || !reason.trim()}
              >
                تأكيد رفض التذكرة
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
