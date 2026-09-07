import React, { useState } from 'react';
import {
  PackageCheck,
  ScanLine,
  Search,
  CheckCircle2,
  Clock,
  Printer,
  Building,
  AlertCircle,
  X
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { usePurchaseOrders } from '../hooks/usePurchaseOrders';
import {
  PurchaseOrderDetail,
  getPurchaseOrderByBarcode,
  getPurchaseOrderDetail
} from '../services/poService';

export const POScan: React.FC = () => {
  const { openScanner, openPOReceipt, openPODetail, lastReceipt, setLastReceipt } = useAppContext();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Fetch open purchase orders awaiting receipt
  const { data: openOrdersData, isLoading: isOpenOrdersLoading } = usePurchaseOrders({
    status: 'open',
    page_size: 50
  });

  const handleSearchAndDispatch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const term = barcodeInput.trim();
    if (!term || isSearching) return;

    setIsSearching(true);
    setSearchError(null);

    try {
      let po: PurchaseOrderDetail;
      // If user entered integer ID or standard PO barcode
      if (/^\d+$/.test(term)) {
        po = await getPurchaseOrderDetail(parseInt(term, 10));
      } else {
        po = await getPurchaseOrderByBarcode(term);
      }

      setBarcodeInput('');
      if (po.status === 'closed' || po.status === 'void' || po.status === 'expired') {
        // Duplicate scan or terminal PO shows committed receipt details instead of confirmation
        openPODetail(po);
      } else {
        // Open PO opens receipt confirmation modal
        openPOReceipt(po);
      }
    } catch (err: any) {
      setSearchError(err.message || 'لم يتم العثور على أمر شراء مطابق للرمز المدخل.');
    } finally {
      setIsSearching(false);
    }
  };

  const openOrders = openOrdersData?.purchase_orders || [];

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
            <PackageCheck className="text-primary-600" size={32} />
            استلام أوامر الشراء
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            مسح واستلام شحنات أوامر الشراء، فحص البنود الواردة، وتحديث أرصدة المخزن آلياً.
          </p>
        </div>

        <button
          type="button"
          onClick={openScanner}
          className="btn btn-primary flex items-center gap-2 shadow-sm text-sm"
        >
          <ScanLine size={18} />
          <span>فتح قارئ الباركود</span>
        </button>
      </header>

      {/* Barcode Search / Scan Bar */}
      <div className="card p-5 bg-white shadow-sm rounded-xl border border-gray-100">
        <form onSubmit={handleSearchAndDispatch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              className="input w-full pl-4 pr-10 text-sm"
              placeholder="امسح باركود أمر الشراء أو أدخل رقمه (مثال: PO-000001)..."
              value={barcodeInput}
              onChange={(e) => {
                setBarcodeInput(e.target.value);
                if (searchError) setSearchError(null);
              }}
              disabled={isSearching}
            />
            <ScanLine size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>

          <button
            type="submit"
            className="btn btn-primary flex items-center gap-2 text-sm font-semibold"
            disabled={isSearching || !barcodeInput.trim()}
          >
            <Search size={16} />
            {isSearching ? 'جاري البحث...' : 'بحث واستلام'}
          </button>
        </form>

        {searchError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span>{searchError}</span>
          </div>
        )}
      </div>

      {/* Success Notification Banner for Completed Receipt */}
      {lastReceipt && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm text-emerald-900 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={20} className="text-emerald-600" />
              <h3 className="font-bold text-sm">
                تم استلام أمر الشراء {lastReceipt.po_number} بنجاح وإغلاقه
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openPODetail(lastReceipt)}
                className="btn btn-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1"
              >
                <Printer size={13} />
                عرض وطباعة الإشعار
              </button>
              <button
                type="button"
                onClick={() => setLastReceipt(null)}
                className="text-emerald-700 hover:text-emerald-900 p-0.5 rounded"
                title="إغلاق الإشعار"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="text-xs text-emerald-800 flex gap-6">
            <span>المستلم: <strong>{lastReceipt.receiver_name || 'أمين المخزن'}</strong></span>
            <span>تاريخ الإغلاق: <strong>{lastReceipt.closed_at}</strong></span>
            <span>إجمالي الكمية المستلمة: <strong>{lastReceipt.total_received_quantity}</strong></span>
          </div>

          {lastReceipt.affected_balances && lastReceipt.affected_balances.length > 0 && (
            <div className="pt-2 border-t border-emerald-200/60">
              <span className="text-xs font-semibold text-emerald-800 block mb-1.5">الأرصدة المحدثة بالمخزن:</span>
              <div className="flex flex-wrap gap-2">
                {lastReceipt.affected_balances.map((bal) => (
                  <span
                    key={bal.item_id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs font-mono"
                  >
                    +{bal.quantity_changed} {bal.name} (الرصيد: {bal.resulting_quantity})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Open Purchase Orders Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Clock size={18} className="text-primary-600" />
            أوامر الشراء المفتوحة الجاهزة للاستلام ({openOrders.length})
          </h2>
        </div>

        {isOpenOrdersLoading ? (
          <div className="card p-12 text-center bg-white rounded-xl shadow-sm border border-gray-100">
            <span className="loading loading-spinner loading-md text-primary-600"></span>
            <p className="text-xs text-gray-500 mt-2">جاري تحميل أوامر الشراء المفتوحة...</p>
          </div>
        ) : openOrders.length === 0 ? (
          <div className="card p-12 text-center bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={24} />
            </div>
            <h3 className="font-semibold text-gray-700 text-sm">لا توجد شحنات معلقة حالياً</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
              جميع أوامر الشراء الصادرة تم استلامها أو إغلاقها. عند إصدار أمر شراء جديد من المكتب سيظهر هنا تلقائياً.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {openOrders.map((po) => (
              <div
                key={po.id}
                className="card p-5 bg-white rounded-xl shadow-sm border border-gray-200/80 hover:border-primary-300 transition-all flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-primary-700 text-base">{po.po_number}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Clock size={12} />
                      مفتوح
                    </span>
                  </div>

                  <div className="space-y-1 text-xs text-gray-600">
                    <div className="flex items-center gap-1.5 font-medium text-gray-800">
                      <Building size={14} className="text-gray-400" />
                      <span>{po.provider_name}</span>
                    </div>
                    <div className="text-gray-500">
                      تاريخ الإنشاء: <span>{po.created_at}</span>
                    </div>
                    <div className="text-amber-700 font-medium">
                      صالح حتى: <span>{po.expires_at}</span>
                    </div>
                    <div className="text-gray-700 pt-1 border-t border-gray-100 flex justify-between">
                      <span>عدد الأصناف: <strong>{po.line_count}</strong></span>
                      <span>إجمالي الكمية: <strong>{po.total_ordered_quantity}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 mt-3 border-t border-gray-100 flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const full = await getPurchaseOrderDetail(po.id);
                        openPOReceipt(full);
                      } catch (err: any) {
                        setSearchError(err.message || 'تعذر تحميل تفاصيل أمر الشراء');
                      }
                    }}
                    className="btn btn-sm btn-primary flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold"
                  >
                    <PackageCheck size={15} />
                    استلام الشحنة
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const full = await getPurchaseOrderDetail(po.id);
                        openPODetail(full);
                      } catch (err: any) {
                        setSearchError(err.message || 'تعذر تحميل تفاصيل أمر الشراء');
                      }
                    }}
                    className="btn btn-sm btn-outline text-xs px-2.5"
                    title="عرض تفاصيل الطلب"
                  >
                    معاينة
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
