import { useState, useEffect, useCallback } from 'react';
import { XCircle, ScanLine } from 'lucide-react';

type BarcodeScannerOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  message?: string;
  isError?: boolean;
  isProcessing?: boolean;
};

export const BarcodeScannerOverlay = ({
  isOpen,
  onClose,
  onScan,
  message = 'جاري قراءة الباركود...',
  isError = false,
  isProcessing = false,
}: BarcodeScannerOverlayProps) => {
  const [barcode, setBarcode] = useState('');

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        if (isProcessing) {
          event.preventDefault();
          return;
        }
        if (barcode.trim()) {
          onScan(barcode.trim());
          setBarcode('');
        }
        event.preventDefault();
      } else if (event.key === 'Escape') {
        onClose();
        event.preventDefault();
      } else if (event.key === 'Backspace') {
        setBarcode((prev) => prev.slice(0, -1));
        event.preventDefault();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        setBarcode((prev) => prev + event.key);
      }
    },
    [barcode, onScan, onClose, isProcessing]
  );


  useEffect(() => {
    // This effect handles resetting the state when the modal opens.
    if (isOpen) {
      setBarcode('');
    }
  }, [isOpen]); // It should only run when the `isOpen` status changes.

  useEffect(() => {
    // This effect handles adding and removing the global event listener.
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    } else {
      window.removeEventListener('keydown', handleKeyDown);
    }

    // Cleanup function to remove event listener
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]); // It needs to re-bind if the handler changes.

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col justify-center items-center z-50 animate-fade-in">
      <div className="absolute top-5 right-5">
        <button
          onClick={onClose}
          className="text-white hover:text-gray-300 transition-colors"
          aria-label="Close scanner"
        >
          <XCircle size={40} />
        </button>
      </div>
      <div className="text-center text-white">
        <ScanLine
          size={100}
          className={`mb-6 ${isError ? 'text-red-500' : 'text-cyan-400'}`}
          style={{ animation: 'scan-animation 2s infinite ease-in-out' }}
        />
        <h2 className={`text-3xl font-bold ${isError ? 'text-red-500' : 'text-white'}`}>
          {message}
        </h2>
        <p className="mt-4 text-lg text-gray-300">
          استخدم قارئ الباركود أو أدخل الرمز يدويًا ثم اضغط على Enter
        </p>
        <p className="mt-2 text-sm text-gray-400">(اضغط على Esc للإلغاء)</p>
        <div className="mt-4 h-10 text-2xl font-mono tracking-widest bg-gray-800 p-2 rounded-md min-w-[250px] flex justify-center items-center">
            {barcode || <span className="text-gray-500">...</span>}
        </div>
      </div>
      <style>
        {`
          @keyframes scan-animation {
            0% { transform: translateY(-15px); opacity: 0.7; }
            50% { transform: translateY(15px); opacity: 1; }
            100% { transform: translateY(-15px); opacity: 0.7; }
          }
          .animate-fade-in {
            animation: fadeIn 0.3s ease-out;
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}
      </style>
    </div>
  );
}; 