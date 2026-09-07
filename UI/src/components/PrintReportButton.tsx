import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useReactToPrint } from 'react-to-print';
import { Printer } from 'lucide-react';
import { PrintableReport } from './PrintableReport';
import { MovementLogEntry } from '../types';
import { apiClient } from '../services/apiClient';

interface PrintReportButtonProps {
  filters: {
    fromDate: string;
    toDate: string;
    itemId: string;
    providerId: string;
    destinationId: string;
    actionType?: string;
  };
  disabled: boolean;
}

export const PrintReportButton: React.FC<PrintReportButtonProps> = ({ filters, disabled }) => {
  const [printableData, setPrintableData] = useState<MovementLogEntry[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const printComponentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printComponentRef,
    onAfterPrint: () => setPrintableData([]),
    ignoreGlobalStyles: true,
    pageStyle: `
      @page {
        size: A4 portrait;
        margin: 20mm;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }
    `,
  });

  const prepareAndPrint = async () => {
    setIsPreparing(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.fromDate) params.append('date_from', filters.fromDate);
    if (filters.toDate) params.append('date_to', filters.toDate);
    if (filters.itemId) params.append('item_id', filters.itemId);
    if (filters.providerId) params.append('provider_id', filters.providerId);
    if (filters.destinationId) params.append('destination_id', filters.destinationId);
    if (filters.actionType) params.append('action_type', filters.actionType);

    try {
      const allLogs = await apiClient.get<MovementLogEntry[]>(`/movement-logs/all_filtered?${params.toString()}`);

      if (allLogs && allLogs.length > 0) {
        setPrintableData(allLogs);
        // Use a timeout to allow state to update before printing
        setTimeout(() => {
          handlePrint();
        }, 50);
      } else {
        setError("لا توجد بيانات للطباعة بناءً على الفلاتر المحددة.");
      }
    } catch (err: any) {
      console.error("Error preparing for print:", err);
      setError(err.message || "فشل في تحضير البيانات للطباعة.");
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <>
      <button
        onClick={prepareAndPrint}
        className="btn btn-outline"
        disabled={disabled || isPreparing}
      >
        {isPreparing ? (
          <>
            <span className="loading loading-spinner loading-xs"></span>
            جاري التحضير...
          </>
        ) : (
          <>
            <Printer size={16} className="ml-2 rtl:mr-2 rtl:ml-0" />
            طباعة النتائج
          </>
        )}
      </button>
      
      {error && <p className="text-error-500 text-xs mt-1">{error}</p>}

      {printableData.length > 0 && createPortal(
        <div style={{ display: 'none' }}>
          <PrintableReport ref={printComponentRef} data={printableData} />
        </div>,
        document.body
      )}
    </>
  );
}; 