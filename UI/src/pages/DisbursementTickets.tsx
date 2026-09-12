import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Loader2, PackageCheck, Search, ShieldCheck } from 'lucide-react';
import { useTickets, useTicketsCount, useFulfillLeaveOrder, useRejectLeaveOrder, useLeaveOrderDetail } from '../hooks/useLeaveOrders';
import { generateIdempotencyKey } from '../services/apiClient';
import { LeaveOrderDetailModal } from '../components/LeaveOrderDetailModal';
import { Modal } from '../components/Modal';

export const DisbursementTickets: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [fulfillingTicketId, setFulfillingTicketId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [fulfillError, setFulfillError] = useState<string | null>(null);

  const { data, isLoading, isError } = useTickets({ status: 'open', search: search || undefined, page_size: 50 });
  const { data: count } = useTicketsCount();
  const { data: rejectingOrder } = useLeaveOrderDetail(rejectingId, { enabled: rejectingId !== null });
  const { data: fulfillingOrder, isLoading: loadingFulfilling } = useLeaveOrderDetail(fulfillingTicketId, { enabled: fulfillingTicketId !== null });

  const fulfill = useFulfillLeaveOrder();
  const reject = useRejectLeaveOrder();
  const tickets = data?.tickets || [];

  const handleConfirmFulfill = async () => {
    if (!fulfillingOrder) return;
    setFulfillError(null);
    try {
      await fulfill.mutateAsync({
        id: fulfillingOrder.id,
        expected_revision: fulfillingOrder.revision,
        idempotencyKey: generateIdempotencyKey()
      });
      setFulfillingTicketId(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل في تأكيد صرف التذكرة.';
      setFulfillError(message);
    }
  };

  const rejectTicket = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!rejectingOrder || !reason.trim()) return;
    await reject.mutateAsync({
      id: rejectingOrder.id,
      input: { expected_revision: rejectingOrder.revision, reason: reason.trim() },
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
                        {/* F06: Physical Handover Verification Trigger */}
                        <button
                          type="button"
                          className="px-4 py-2 rounded-xl bg-brand-violet hover:bg-brand-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                          onClick={() => {
                            setFulfillError(null);
                            setFulfillingTicketId(ticket.id);
                          }}
                          disabled={fulfill.isPending || reject.isPending}
                        >
                          <ShieldCheck size={16} />
                          <span>تسليم وصرف</span>
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl bg-white hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-rose-700 border border-rose-200 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          onClick={() => setRejectingId(ticket.id)}
                          disabled={reject.isPending || fulfill.isPending}
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

      {/* F06: Physical Handover Verification Dialog */}
      {fulfillingTicketId !== null && (
        <Modal
          isOpen={fulfillingTicketId !== null}
          onClose={() => {
            setFulfillingTicketId(null);
            setFulfillError(null);
          }}
          title={fulfillingOrder ? `تأكيد التسليم الفعلي لتذكرة الصرف: ${fulfillingOrder.order_number}` : 'تأكيد التسليم الفعلي'}
          size="lg"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setFulfillingTicketId(null);
                  setFulfillError(null);
                }}
                disabled={fulfill.isPending}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary bg-brand-violet hover:bg-purple-700 flex items-center gap-1.5"
                onClick={handleConfirmFulfill}
                disabled={fulfill.isPending || loadingFulfilling || !fulfillingOrder}
              >
                {fulfill.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>جاري تأكيد الصرف...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>تأكيد التسليم الفعلي والصرف</span>
                  </>
                )}
              </button>
            </div>
          }
        >
          {loadingFulfilling || !fulfillingOrder ? (
            <div className="p-8 text-center text-gray-500">جاري تحميل بيانات البنود للتأكيد...</div>
          ) : (
            <div className="space-y-4">
              {fulfillError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
                  <AlertTriangle size={16} />
                  <span>{fulfillError}</span>
                </div>
              )}

              <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-950 flex items-start gap-2.5">
                <ShieldCheck size={20} className="text-brand-violet shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-sm mb-1 text-purple-900">مراجعة الأصناف قبل خصم الرصيد</h4>
                  <p className="text-xs leading-relaxed text-purple-800 m-0">
                    يرجى مطابقة الأصناف والكميات المحجوزة في الجدول أدناه وفحصها والتأكد من تسليمها فعلياً للمستلم قبل تأكيد الصرف.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3 text-xs border border-gray-200">
                <div>
                  <span className="text-gray-500 block mb-0.5">اسم المستلم:</span>
                  <strong className="text-gray-900 text-sm">{fulfillingOrder.employee_name}</strong>
                </div>
                <div>
                  <span className="text-gray-500 block mb-0.5">جهة الصرف:</span>
                  <strong className="text-gray-900 text-sm">{fulfillingOrder.destination_name}</strong>
                </div>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-gray-50 text-gray-700 font-bold border-b border-gray-200">
                    <tr>
                      <th className="p-2.5 w-10 text-center">#</th>
                      <th className="p-2.5">اسم الصنف المطلوب صرفه</th>
                      <th className="p-2.5 text-center">الوحدة</th>
                      <th className="p-2.5 text-center">الكمية للتسليم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {fulfillingOrder.items.map((item, index) => (
                      <tr key={item.id} className="hover:bg-gray-50/50">
                        <td className="p-2.5 text-center text-gray-400">{index + 1}</td>
                        <td className="p-2.5 font-bold text-gray-900">{item.item_name}</td>
                        <td className="p-2.5 text-center text-gray-600">{item.unit_name}</td>
                        <td className="p-2.5 text-center font-extrabold text-brand-violet font-mono text-sm">
                          {item.requested_quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200 font-bold">
                    <tr>
                      <td colSpan={3} className="p-2.5 text-left text-gray-700">إجمالي الكميات المسلمة:</td>
                      <td className="p-2.5 text-center font-extrabold text-brand-violet font-mono text-base">
                        {fulfillingOrder.total_requested_quantity ?? fulfillingOrder.total_quantity}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Rejection Modal */}
      {rejectingId !== null && (
        <Modal
          isOpen={rejectingId !== null}
          onClose={() => {
            setRejectingId(null);
            setReason('');
          }}
          title="رفض تذكرة الصرف وإعادتها للمكتب"
          size="md"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setRejectingId(null);
                  setReason('');
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary bg-rose-600 hover:bg-rose-700 text-white border-rose-600 shadow-xs cursor-pointer"
                onClick={() => rejectTicket()}
                disabled={reject.isPending || !reason.trim()}
              >
                {reject.isPending ? 'جاري تأكيد الرفض...' : 'تأكيد رفض التذكرة'}
              </button>
            </div>
          }
        >
          <form onSubmit={rejectTicket} className="space-y-4">
            <p className="text-xs text-ink-600 leading-relaxed m-0">
              يرجى توضيح سبب الرفض بدقة (مثل: تلف المواد، خطأ في المواصفات، أو عدم تطابق). سبب الرفض إلزامي وسيظهر لموظف المكتب فوراً.
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                سبب الرفض <span className="text-rose-600">*</span>
              </label>
              <textarea
                className="w-full bg-slate-50 border border-gray-200 rounded-xl p-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="اكتب سبب رفض الصرف هنا..."
                required
              />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
