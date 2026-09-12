/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { AsyncPaginate, LoadOptions } from 'react-select-async-paginate';
import type { GroupBase, OptionsOrGroups } from 'react-select';
import { useLeaveOrderDetail, useCancelLeaveOrder, useResubmitLeaveOrder } from '../hooks/useLeaveOrders';
import { apiClient, generateIdempotencyKey } from '../services/apiClient';
import { formatCloseReason } from '../services/leaveOrderService';
import { formatSafeDate } from '../services/statsService';
import { useAuth } from '../context/AuthContext';
import { ReturnModal } from './ReturnModal';
import { CheckCircle2, Clock, AlertTriangle, Undo2, RefreshCw, Edit3, Plus, Trash2 } from 'lucide-react';
import { Item } from '../types';

interface LeaveOrderDetailModalProps {
  orderId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onUpdated?: () => void;
}

interface ItemOption {
  value: number;
  label: string;
  item: Item;
}

interface EditLine {
  item: Item | null;
  quantity: number | '';
}

const ITEMS_PER_PAGE = 20;
const AsyncPaginateComponent = AsyncPaginate as any;

export const LeaveOrderDetailModal: React.FC<LeaveOrderDetailModalProps> = ({
  orderId,
  isOpen,
  onClose
}) => {
  const { user } = useAuth();
  const { data: order, isLoading, refetch } = useLeaveOrderDetail(orderId, { enabled: isOpen && orderId !== null });
  const cancelMutation = useCancelLeaveOrder();
  const resubmitMutation = useResubmitLeaveOrder();

  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // F09: In-place rejected request correction state
  const [isEditingRejected, setIsEditingRejected] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editNotes, setEditNotes] = useState('');

  // Sync edit lines when order loads or changes
  useEffect(() => {
    if (order && order.status === 'rejected') {
      setEditNotes(order.notes || '');
      setEditLines(
        order.items.map((i) => ({
          item: {
            id: i.item_id,
            name: i.item_name,
            unit_name: i.unit_name,
            status: (i.current_item_status as any) || 'active'
          } as Item,
          quantity: i.requested_quantity
        }))
      );
    } else {
      setIsEditingRejected(false);
    }
  }, [order]);

  const canReturn = (user?.role === 'office' || user?.role === 'admin') && order && order.remaining_quantity > 0;
  const canManageRejected = (user?.role === 'office' || user?.role === 'admin') && order?.status === 'rejected';

  // F02: Async item options for correction
  const loadItemOptions: LoadOptions<ItemOption, GroupBase<ItemOption>, { offset: number } | undefined> = async (
    searchQuery: string,
    _loadedOptions: OptionsOrGroups<ItemOption, GroupBase<ItemOption>>,
    additional?: { offset: number }
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
      const activeItems = (res.items || []).filter((it: Item) => it.status === 'active' || !it.status);
      const options: ItemOption[] = activeItems.map((it: Item) => {
        const avail = it.available_quantity ?? (it.current_quantity !== undefined ? it.current_quantity - (it.reserved_quantity || 0) : 0);
        return {
          value: it.id,
          label: `${it.name} (${it.unit_name || 'وحدة'}) - المتاح: ${avail}`,
          item: it
        };
      });

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

  const handleResubmitAsIs = async () => {
    if (!order) return;
    try {
      await resubmitMutation.mutateAsync({
        id: order.id,
        input: {
          expected_revision: order.revision,
          notes: order.notes || undefined
        },
        idempotencyKey: generateIdempotencyKey()
      });
      setErrorMsg(null);
      setIsEditingRejected(false);
      refetch();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل في إعادة إرسال الإذن.');
    }
  };

  const handleSaveCorrectionAndResubmit = async () => {
    if (!order) return;
    setErrorMsg(null);

    const validLines = editLines.filter((l) => l.item !== null);
    if (validLines.length === 0) {
      setErrorMsg('يجب إضافة صنف واحد على الأقل.');
      return;
    }

    const seen = new Set<number>();
    const formatted = [];
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (seen.has(l.item!.id)) {
        setErrorMsg(`الصنف "${l.item!.name}" مكرر.`);
        return;
      }
      seen.add(l.item!.id);
      const q = Number(l.quantity);
      if (!q || q <= 0) {
        setErrorMsg(`يرجى إدخال كمية صحيحة في البند ${i + 1}.`);
        return;
      }
      formatted.push({
        item_id: l.item!.id,
        requested_quantity: q
      });
    }

    try {
      await resubmitMutation.mutateAsync({
        id: order.id,
        input: {
          expected_revision: order.revision,
          items: formatted,
          notes: editNotes.trim() || undefined
        },
        idempotencyKey: generateIdempotencyKey()
      });
      setIsEditingRejected(false);
      setErrorMsg(null);
      refetch();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل في حفظ التعديلات وإعادة إرسال الإذن.');
    }
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    try {
      await cancelMutation.mutateAsync({
        id: order.id,
        expected_revision: order.revision,
        idempotencyKey: generateIdempotencyKey()
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل في إلغاء الإذن.');
    }
  };

  if (!isOpen || orderId === null) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setErrorMsg(null);
        setIsEditingRejected(false);
        onClose();
      }}
      title={order ? `تفاصيل إذن الصرف: ${order.order_number}` : 'تفاصيل إذن الصرف'}
      size="lg"
      footer={
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            {canReturn && (
              <button
                type="button"
                className="btn btn-primary bg-green-600 hover:bg-green-700 border-green-600 flex items-center gap-1"
                onClick={() => setIsReturnOpen(true)}
              >
                <Undo2 size={16} />
                تسجيل مرتجع
              </button>
            )}

            {canManageRejected && !isEditingRejected && (
              <>
                <button
                  type="button"
                  className="btn btn-primary bg-brand-violet hover:bg-purple-700 flex items-center gap-1"
                  onClick={() => setIsEditingRejected(true)}
                >
                  <Edit3 size={15} />
                  <span>تعديل البنود وإعادة الإرسال</span>
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleResubmitAsIs}
                  disabled={resubmitMutation.isPending}
                >
                  إعادة إرسال كما هو
                </button>
                <button
                  type="button"
                  className="btn btn-outline text-red-600 hover:bg-red-50"
                  onClick={handleCancelOrder}
                  disabled={cancelMutation.isPending}
                >
                  إلغاء الطلب
                </button>
              </>
            )}

            {canManageRejected && isEditingRejected && (
              <>
                <button
                  type="button"
                  className="btn btn-primary bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleSaveCorrectionAndResubmit}
                  disabled={resubmitMutation.isPending}
                >
                  {resubmitMutation.isPending ? 'جاري الإرسال...' : 'تأكيد التعديل وإعادة الإرسال'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsEditingRejected(false)}
                  disabled={resubmitMutation.isPending}
                >
                  إلغاء التعديل
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="تحديث البيانات يدويّاً"
            >
              <RefreshCw size={18} />
            </button>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              إغلاق النافذة
            </button>
          </div>
        </div>
      }
    >
      {isLoading || !order ? (
        <div className="p-8 text-center text-gray-500">جاري تحميل التفاصيل...</div>
      ) : (
        <div className="space-y-6">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Status Header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 text-xs">
            <div>
              <span className="text-gray-500 block mb-1">رقم الإذن</span>
              <span className="font-bold text-gray-800 text-sm font-mono">{order.order_number}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">الحالة</span>
              <span className="inline-flex items-center gap-1 font-semibold text-xs">
                {order.status === 'open' && (
                  <span className="text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <Clock size={12} /> مفتوح بالمخزن
                  </span>
                )}
                {order.status === 'rejected' && (
                  <span className="text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <AlertTriangle size={12} /> مرفوض
                  </span>
                )}
                {order.status === 'partially_returned' && (
                  <span className="text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <AlertTriangle size={12} /> مرتجع جزئياً
                  </span>
                )}
                {order.status === 'closed' && (
                  <span className="text-gray-700 bg-gray-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 size={12} /> مغلق
                  </span>
                )}
                {order.status === 'cancelled' && (
                  <span className="text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    ملغي
                  </span>
                )}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">المستلم / الموظف</span>
              <span className="font-semibold text-gray-800 text-sm">{order.employee_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">جهة الصرف</span>
              <span className="font-semibold text-gray-800 text-sm">{order.destination_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">تاريخ الإنشاء</span>
              <span className="text-gray-700">{formatSafeDate(order.created_at)}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">منشئ الإذن</span>
              <span className="text-gray-700">{order.creator_name || 'غير محدد'}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">تاريخ الإغلاق / الرفض</span>
              <span className="text-gray-700">
                {order.closed_at ? formatSafeDate(order.closed_at) : order.rejected_at ? formatSafeDate(order.rejected_at) : '—'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">المسؤول عن الإجراء</span>
              <span className="text-gray-700">{order.closer_name || (order as any).rejector_name || '—'}</span>
            </div>
          </div>

          {/* F04: 4-Metric Truthful Quantity Summary Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <span className="text-xs font-bold text-slate-500 block mb-1">الكمية المطلوبة</span>
              <span className="text-xl font-extrabold text-slate-900 font-mono">
                {order.total_requested_quantity ?? order.total_quantity}
              </span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
              <span className="text-xs font-bold text-emerald-700 block mb-1">الكمية المصروفة فعلياً</span>
              <span className="text-xl font-extrabold text-emerald-800 font-mono">
                {order.total_dispensed_quantity ?? 0}
              </span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <span className="text-xs font-bold text-amber-700 block mb-1">إجمالي المرتجع</span>
              <span className="text-xl font-extrabold text-amber-800 font-mono">
                {order.total_returned ?? 0}
              </span>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
              <span className="text-xs font-bold text-brand-violet block mb-1">الرصيد المتبقي بالخارج</span>
              <span className="text-xl font-extrabold text-brand-violet font-mono">
                {order.remaining_quantity}
              </span>
            </div>
          </div>

          {order.notes && (
            <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-xs text-gray-700">
              <span className="font-bold text-blue-900 block mb-1">ملاحظات الإذن:</span>
              {order.notes}
            </div>
          )}

          {order.close_reason && (
            <div className="p-3 bg-gray-100 rounded-xl border border-gray-200 text-xs text-gray-700">
              <span className="font-bold text-gray-800 block mb-1">
                سبب الإغلاق (بواسطة {order.closer_name || 'المستودع'}):
              </span>
              {formatCloseReason(order.close_reason)}
            </div>
          )}

          {order.rejection_reason && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
              <strong className="block mb-1">سبب الرفض بالمخزن:</strong>
              {order.rejection_reason}
            </div>
          )}

          {/* F09: Editable Lines Mode for Rejected Request */}
          {isEditingRejected ? (
            <div className="border border-purple-200 rounded-xl p-4 bg-purple-50/30 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-purple-900 flex items-center gap-1.5">
                  <Edit3 size={16} />
                  <span>تعديل بنود الإذن المرفوض تمهيداً لإعادة إرساله</span>
                </h4>
                <button
                  type="button"
                  className="btn btn-xs btn-outline bg-white flex items-center gap-1"
                  onClick={() => setEditLines([...editLines, { item: null, quantity: '' }])}
                >
                  <Plus size={13} /> إضافة بند
                </button>
              </div>

              <div className="space-y-3">
                {editLines.map((line, idx) => {
                  const selectedOption = line.item
                    ? {
                        value: line.item.id,
                        label: `${line.item.name} (${line.item.unit_name || 'وحدة'})`,
                        item: line.item
                      }
                    : null;

                  return (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200">
                      <div className="flex-1">
                        <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                          الصنف #{idx + 1}
                        </label>
                        <AsyncPaginateComponent
                          loadOptions={loadItemOptions}
                          value={selectedOption}
                          onChange={(opt: ItemOption | null) => {
                            const updated = [...editLines];
                            updated[idx] = { ...updated[idx], item: opt ? opt.item : null };
                            setEditLines(updated);
                          }}
                          placeholder="ابحث واختر الصنف البديل..."
                          debounceTimeout={300}
                          isClearable
                          noOptionsMessage={() => 'لا توجد نتائج'}
                          additional={{ offset: 0 }}
                          menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                          styles={{
                            control: (base: any) => ({
                              ...base,
                              minHeight: '34px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontFamily: 'Cairo, sans-serif'
                            }),
                            menuPortal: (base: any) => ({ ...base, zIndex: 9999 })
                          }}
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                          الكمية {line.item ? `(${line.item.unit_name || 'وحدة'})` : ''}
                        </label>
                        <input
                          type="number"
                          min="1"
                          className="input w-full text-xs py-1.5 px-2 text-center"
                          placeholder="الكمية"
                          value={line.quantity}
                          onChange={(e) => {
                            const updated = [...editLines];
                            const p = parseInt(e.target.value, 10);
                            updated[idx] = { ...updated[idx], quantity: isNaN(p) ? '' : p };
                            setEditLines(updated);
                          }}
                        />
                      </div>
                      {editLines.length > 1 && (
                        <div className="pt-4">
                          <button
                            type="button"
                            onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}
                            className="text-gray-400 hover:text-red-600 p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ملاحظات التعديل
                </label>
                <input
                  type="text"
                  className="input w-full text-xs"
                  placeholder="توضيح التعديلات المنفذة لمسؤول المخزن..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            </div>
          ) : (
            /* Items Table (Normal View) */
            <div>
              <h4 className="font-bold text-sm text-gray-800 mb-2">أصناف إذن الصرف</h4>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-right text-xs">
                  <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                    <tr>
                      <th className="p-3">الصنف</th>
                      <th className="p-3">الوحدة</th>
                      <th className="p-3 text-center">الكمية المطلوبة</th>
                      <th className="p-3 text-center">الكمية المصروفة</th>
                      <th className="p-3 text-center">المرتجع</th>
                      <th className="p-3 text-center">المتبقي بالخارج</th>
                      <th className="p-3">حالة الصنف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {order.items.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50/50">
                        <td className="p-3 font-semibold text-gray-900">{item.item_name}</td>
                        <td className="p-3 text-gray-600">{item.unit_name}</td>
                        <td className="p-3 text-center font-bold text-gray-800">{item.requested_quantity}</td>
                        <td className="p-3 text-center font-bold text-emerald-700">{item.dispensed_quantity}</td>
                        <td className="p-3 text-center text-gray-600">{item.returned_quantity}</td>
                        <td className="p-3 text-center font-bold text-brand-violet">{item.remaining_quantity}</td>
                        <td className="p-3">
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              item.current_item_status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {item.current_item_status === 'active' ? 'نشط' : item.current_item_status || 'غير معروف'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Return History */}
          {order.return_events && order.return_events.length > 0 && (
            <div>
              <h4 className="font-bold text-sm text-gray-800 mb-2">سجل المرتجعات ({order.return_events.length})</h4>
              <div className="space-y-3">
                {order.return_events.map((event: any) => (
                  <div key={event.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-gray-800">
                        مرتجع بتاريخ {formatSafeDate(event.created_at)}
                      </span>
                      <span className="text-gray-500">
                        بواسطة: {event.actor_name || 'غير محدد'}
                      </span>
                    </div>
                    {event.notes && (
                      <p className="text-gray-600 mb-2 bg-white p-1.5 rounded border border-gray-100">
                        <strong>ملاحظات:</strong> {event.notes}
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-gray-100 text-gray-600 font-semibold">
                          <tr>
                            <th className="p-2">الصنف</th>
                            <th className="p-2">الوحدة</th>
                            <th className="p-2 text-center">الكمية المسترجعة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {event.items &&
                            event.items.map((ei: any) => (
                              <tr key={ei.id}>
                                <td className="p-2">{ei.item_name}</td>
                                <td className="p-2">{ei.unit_name}</td>
                                <td className="p-2 text-center font-bold text-green-700">+{ei.quantity}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isReturnOpen && order && (
        <ReturnModal
          order={order}
          isOpen={isReturnOpen}
          onClose={() => {
            setIsReturnOpen(false);
            refetch();
          }}
          onSuccess={() => refetch()}
        />
      )}
    </Modal>
  );
};
