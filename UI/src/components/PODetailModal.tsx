import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useReactToPrint } from 'react-to-print';
import { X, Printer, Ban, AlertCircle, FileText, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import {
  PurchaseOrderDetail,
  BarcodeResponse,
  getPurchaseOrderBarcode
} from '../services/poService';
import { useVoidPurchaseOrder } from '../hooks/usePurchaseOrders';
import { PrintablePurchaseOrder } from './PrintablePurchaseOrder';

interface PODetailModalProps {
  order: PurchaseOrderDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  canVoid: boolean;
  isLoading?: boolean;
}

export const PODetailModal: React.FC<PODetailModalProps> = ({
  order,
  isOpen,
  onClose,
  onUpdated,
  canVoid,
  isLoading = false
}) => {
  const [isVoidPromptOpen, setIsVoidPromptOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);

  // Printing state
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [barcodeData, setBarcodeData] = useState<BarcodeResponse | null>(null);

  const printComponentRef = useRef<HTMLDivElement>(null);
  const voidMutation = useVoidPurchaseOrder();

  // Prefetch barcode when modal is open and order details are ready
  useEffect(() => {
    if (isOpen && order?.id) {
      getPurchaseOrderBarcode(order.id)
        .then((bc) => setBarcodeData(bc))
        .catch((err) => console.warn('Failed to prefetch barcode:', err));
    } else {
      setBarcodeData(null);
    }
  }, [isOpen, order?.id]);

  const handlePrint = useReactToPrint({
    contentRef: printComponentRef,
    ignoreGlobalStyles: true,
    pageStyle: `
      @page {
        size: A4 portrait;
        margin: 12mm;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        thead {
          display: table-header-group;
        }
        tr {
          page-break-inside: avoid;
        }
      }
    `
  });

  if (!isOpen) return null;

  if (isLoading || !order) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-8 text-center flex flex-col items-center gap-3">
          <span className="loading loading-spinner loading-lg text-primary-600"></span>
          <p className="text-sm font-semibold text-gray-700">جاري تحميل تفاصيل أمر الشراء...</p>
          <button type="button" onClick={onClose} className="btn btn-outline text-xs mt-2">
            إغلاق
          </button>
        </div>
      </div>
    );
  }

  // Print preparation: wait for assets (fonts, logo, barcode image) without fixed delay assumptions
  const handlePrepareAndPrint = async () => {
    setIsPreparingPrint(true);
    setPrintError(null);

    try {
      // 1. Fetch barcode data from backend if not already preloaded
      let bc = barcodeData;
      if (!bc && order) {
        bc = await getPurchaseOrderBarcode(order.id);
        setBarcodeData(bc);
      }

      // 2. Preload barcode image
      if (bc?.imageData) {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('فشل تحميل صورة الباركود للطباعة'));
          img.src = `data:image/png;base64,${bc.imageData}`;
        });
      }

      // 3. Preload logo image if configured
      if (order.company?.logo_url) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => {
            console.warn('Company logo failed to load, proceeding with document print.');
            resolve(); // Non-fatal for printing document
          };
          img.src = order.company.logo_url!;
        });
      }

      // 4. Wait for fonts to be ready
      if (typeof document !== 'undefined' && 'fonts' in document) {
        await (document as any).fonts.ready;
      }

      // 5. Trigger print
      handlePrint();
    } catch (err: any) {
      console.error('Error preparing purchase order for printing:', err);
      setPrintError(err.message || 'تعذر إعداد أمر الشراء للطباعة');
    } finally {
      setIsPreparingPrint(false);
    }
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoidError(null);

    const trimmed = voidReason.trim();
    if (!trimmed) {
      setVoidError('يرجى كتابة سبب إلغاء أمر الشراء.');
      return;
    }

    try {
      await voidMutation.mutateAsync({
        id: order.id,
        input: {
          expected_revision: order.revision,
          reason: trimmed
        }
      });
      setIsVoidPromptOpen(false);
      setVoidReason('');
      onUpdated();
    } catch (err: any) {
      setVoidError(err.message || 'فشل في إلغاء أمر الشراء.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Clock size={14} />
            مفتوح (ساري)
          </span>
        );
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 size={14} />
            مغلق (مستلم)
          </span>
        );
      case 'void':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <Ban size={14} />
            ملغي
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle size={14} />
            منتهي الصلاحية
          </span>
        );
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary-50 text-primary-600">
                <FileText size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-800">{order.po_number}</h2>
                  {getStatusBadge(order.status)}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  تاريخ الإنشاء: {order.created_at} • إصدار الوثيقة: #{order.revision}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
            >
              <X size={20} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {printError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
                <AlertCircle size={18} className="flex-shrink-0" />
                <span>{printError}</span>
              </div>
            )}

            {/* Header Metadata Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200/80 text-xs">
              <div>
                <span className="text-gray-500 block mb-1">المورد</span>
                <span className="font-semibold text-gray-900 text-sm">{order.provider_name}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">صالح حتى (48 ساعة)</span>
                <span className="font-semibold text-gray-900">{order.expires_at}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">محرر الطلب</span>
                <span className="font-semibold text-gray-900">{order.creator_name || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">الباركود</span>
                <span className="font-mono font-semibold text-gray-900">{order.barcode}</span>
              </div>

              {order.status === 'closed' && (
                <div className="col-span-2 md:col-span-4 bg-blue-50/70 p-3 rounded-lg border border-blue-100 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-blue-700 block mb-0.5">مستلم الشحنة:</span>
                    <strong className="text-blue-950 font-bold">{order.receiver_name || 'أمين المخزن'}</strong>
                  </div>
                  <div>
                    <span className="text-blue-700 block mb-0.5">تاريخ ووقت الاستلام:</span>
                    <strong className="text-blue-950 font-bold">{order.closed_at}</strong>
                  </div>
                  <div>
                    <span className="text-blue-700 block mb-0.5">إجمالي الكمية المستلمة:</span>
                    <strong className="text-blue-950 font-bold">{order.total_received_quantity}</strong>
                  </div>
                </div>
              )}

              {order.void_reason && (
                <div className="col-span-2 md:col-span-4 bg-red-50 p-2.5 rounded border border-red-100 text-red-800">
                  <span className="font-bold">سبب الإلغاء / الانتهاء: </span>
                  <span>{order.void_reason}</span> ({order.voided_at || '-'})
                  {order.void_actor_name && <span> بواسطة: {order.void_actor_name}</span>}
                </div>
              )}

              {order.notes && (
                <div className="col-span-2 md:col-span-4 border-t border-gray-200 pt-2 text-gray-700">
                  <span className="font-semibold text-gray-500">ملاحظات: </span>
                  <span>{order.notes}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2">أصناف أمر الشراء ({order.items.length})</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                    <tr>
                      <th className="py-2.5 px-3 w-8 text-center">#</th>
                      <th className="py-2.5 px-3">الصنف</th>
                      <th className="py-2.5 px-3 text-center">الوحدة</th>
                      <th className="py-2.5 px-3">البيان</th>
                      <th className="py-2.5 px-3 text-center">الكمية المطلوبة</th>
                      {order.status === 'closed' && (
                        <th className="py-2.5 px-3 text-center">الكمية المستلمة</th>
                      )}
                      <th className="py-2.5 px-3 text-left">السعر ({order.currency})</th>
                      <th className="py-2.5 px-3 text-left">الإجمالي ({order.currency})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {order.items.map((item, idx) => {
                      const isStruck = item.disposition === 'struck_off';
                      return (
                        <tr key={item.id || idx} className={isStruck ? 'bg-gray-50/60' : 'hover:bg-gray-50/50'}>
                          <td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>
                          <td className="py-2 px-3 font-semibold">
                            <span className={isStruck ? 'line-through text-gray-400' : 'text-gray-900'}>
                              {item.item_name}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center text-gray-500">{item.unit_name}</td>
                          <td className="py-2 px-3 text-gray-500">{item.line_description || '-'}</td>
                          <td className="py-2 px-3 text-center font-bold">{item.ordered_quantity}</td>
                          {order.status === 'closed' && (
                            <td className="py-2 px-3 text-center">
                              {isStruck ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                  مشطوب (0)
                                </span>
                              ) : (
                                <span className="font-bold text-blue-600">
                                  {item.received_quantity ?? 0}
                                </span>
                              )}
                            </td>
                          )}
                          <td className="py-2 px-3 text-left font-mono">{item.unit_price}</td>
                          <td className="py-2 px-3 text-left font-mono font-bold text-gray-800">
                            {item.line_total}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-between items-center bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm">
              <div className="text-gray-600 flex gap-6">
                <span>إجمالي الأصناف: <strong className="text-gray-900">{order.line_count}</strong></span>
                <span>إجمالي الكمية المطلوبة: <strong className="text-gray-900">{order.total_ordered_quantity}</strong></span>
                {order.status === 'closed' && (
                  <span>إجمالي الكمية المستلمة: <strong className="text-blue-700">{order.total_received_quantity}</strong></span>
                )}
              </div>
              <div className="text-base font-bold text-gray-800">
                المبلغ الإجمالي: <span className="text-primary-600 font-mono text-xl">{order.total_amount} {order.currency}</span>
              </div>
            </div>
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex justify-between items-center px-6 py-4 border-t border-gray-100 bg-gray-50/50">
            <div>
              {canVoid && order.allowed_actions?.includes('void') && (
                <button
                  type="button"
                  onClick={() => setIsVoidPromptOpen(true)}
                  className="btn btn-outline border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-xs"
                >
                  <Ban size={15} />
                  إلغاء أمر الشراء
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePrepareAndPrint}
                className="btn btn-primary flex items-center gap-1.5"
                disabled={isPreparingPrint}
              >
                <Printer size={16} />
                {isPreparingPrint ? 'جاري تجهيز الطباعة...' : 'طباعة أمر الشراء (A4)'}
              </button>
              <button type="button" onClick={onClose} className="btn btn-outline">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden printable component rendered into DOM for react-to-print portal */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div style={{ display: 'none' }}>
            <PrintablePurchaseOrder ref={printComponentRef} order={order} barcodeData={barcodeData} />
          </div>,
          document.body
        )}

      {/* Void Confirmation Modal */}
      {isVoidPromptOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-60 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-2 text-red-600 mb-3">
              <Ban size={22} />
              <h3 className="text-lg font-bold">تأكيد إلغاء أمر الشراء</h3>
            </div>
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              أنت على وشك إلغاء أمر الشراء <strong>{order.po_number}</strong>. هذه العملية نهائية ولن يمكن استقبال الشحنة بموجب هذا الأمر.
            </p>

            {voidError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{voidError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmVoid} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  سبب الإلغاء <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="input w-full text-xs py-2 px-3 h-20 resize-none"
                  placeholder="اكتب سبب إلغاء هذا الطلب بالتفصيل..."
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsVoidPromptOpen(false)}
                  className="btn btn-outline text-xs"
                  disabled={voidMutation.isPending}
                >
                  تراجع
                </button>
                <button
                  type="submit"
                  className="btn bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                  disabled={voidMutation.isPending}
                >
                  {voidMutation.isPending ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
