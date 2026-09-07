import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Item } from '../types'; // Import the main Item type
import { apiClient, ApiError } from '../services/apiClient';
import { useAuth } from './AuthContext';
import { PageId, canAccessPage, getCapabilitiesForRole, normalizePageId } from '../navigation';
import { PurchaseOrderDetail, ReceivePOResponse, getPurchaseOrderByBarcode } from '../services/poService';

type AppContextType = {
  activePage: PageId;
  setActivePage: (page: string) => void;
  // Barcode scanner state and actions
  isScannerOpen: boolean;
  openScanner: () => void;
  closeScanner: () => void;
  scannerMessage: string;
  isScannerError: boolean;
  isScanProcessing: boolean;
  handleBarcodeScan: (barcode: string) => void;
  
  // Modal state for adjusting quantity after scan
  scannedItem: Item | null;
  isAdjustModalOpen: boolean;
  closeAdjustModal: (andReopenScanner?: boolean) => void;

  // Modal state for PO review / receipt after scan
  selectedPO: PurchaseOrderDetail | null;
  setSelectedPO: (po: PurchaseOrderDetail | null) => void;
  isPOReceiptModalOpen: boolean;
  openPOReceipt: (po: PurchaseOrderDetail) => void;
  closePOReceiptModal: () => void;
  isPODetailModalOpen: boolean;
  openPODetail: (po: PurchaseOrderDetail) => void;
  closePODetailModal: () => void;

  // Last completed PO receipt response for success notification banner
  lastReceipt: ReceivePOResponse | null;
  setLastReceipt: (receipt: ReceivePOResponse | null) => void;
};


export const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppContext = () => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};

type AppProviderProps = {
    children: ReactNode;
};

export const AppProvider = ({ children }: AppProviderProps) => {
    const { role } = useAuth();
    const [activePage, setActivePageState] = useState<PageId>('Dashboard');

    // State for barcode scanner
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannerMessage, setScannerMessage] = useState('جاري قراءة الباركود...');
    const [isScannerError, setIsScannerError] = useState(false);
    const [isScanProcessing, setIsScanProcessing] = useState(false);
    
    // State for adjust quantity modal
    const [scannedItem, setScannedItem] = useState<Item | null>(null);
    const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);

    // State for purchase order receipt / review modals
    const [selectedPO, setSelectedPO] = useState<PurchaseOrderDetail | null>(null);
    const [isPOReceiptModalOpen, setIsPOReceiptModalOpen] = useState(false);
    const [isPODetailModalOpen, setIsPODetailModalOpen] = useState(false);
    const [lastReceipt, setLastReceipt] = useState<ReceivePOResponse | null>(null);

    // Capabilities for current role
    const capabilities = getCapabilitiesForRole(role);

    // Reset active page to Dashboard if current page is disallowed on role change
    useEffect(() => {
        if (role && !canAccessPage(role, activePage)) {
            setActivePageState('Dashboard');
        }
    }, [role, activePage]);

    // Close any open adjustment modal or scanner if user role loses adjustment capability
    useEffect(() => {
        if (!capabilities.canAdjustQuantity) {
            setIsAdjustModalOpen(false);
            setScannedItem(null);
        }
    }, [capabilities.canAdjustQuantity]);

    const setActivePage = useCallback((page: string) => {
        const canonical = normalizePageId(page);
        // Enforce role-based access control on direct navigation
        if (!canonical || (role && !canAccessPage(role, canonical))) {
            console.warn(`Role '${role}' is not permitted to access page '${page}'. Navigating to Dashboard.`);
            setActivePageState('Dashboard');
            return;
        }
        setActivePageState(canonical);
    }, [role]);

    const openScanner = () => {
        setScannerMessage('جاري قراءة الباركود...');
        setIsScannerError(false);
        setIsScannerOpen(true);
    };
    
    const closeScanner = () => setIsScannerOpen(false);

    const openPOReceipt = (po: PurchaseOrderDetail) => {
        setSelectedPO(po);
        setIsPOReceiptModalOpen(true);
    };

    const closePOReceiptModal = () => {
        setIsPOReceiptModalOpen(false);
        setSelectedPO(null);
    };

    const openPODetail = (po: PurchaseOrderDetail) => {
        setSelectedPO(po);
        setIsPODetailModalOpen(true);
    };

    const closePODetailModal = () => {
        setIsPODetailModalOpen(false);
        setSelectedPO(null);
    };

    const handleBarcodeScan = async (barcode: string) => {
        if (isScanProcessing) return;
        const trimmed = barcode.trim();
        if (!trimmed) return;

        setIsScanProcessing(true);
        const isPO = trimmed.toUpperCase().startsWith('PO-');

        if (isPO) {
            try {
                const po = await getPurchaseOrderByBarcode(trimmed);
                closeScanner();
                setSelectedPO(po);

                if (role === 'office') {
                    // Office scans open read-only review
                    setIsPODetailModalOpen(true);
                } else {
                    // Warehouse or admin
                    if (po.status === 'closed' || po.status === 'void' || po.status === 'expired') {
                        // Duplicate scan or terminal PO shows committed receipt details instead of confirmation
                        setIsPODetailModalOpen(true);
                    } else {
                        // Open PO opens confirmation modal for warehouse
                        setIsPOReceiptModalOpen(true);
                    }
                }
            } catch (error: any) {
                let msg = error.message || 'خطأ غير متوقع';
                if (error instanceof ApiError && error.status === 404) {
                    msg = 'لم يتم العثور على أمر شراء مطابق للباركود';
                }
                setScannerMessage(msg);
                setIsScannerError(true);
                setTimeout(() => {
                    setScannerMessage('جاري قراءة الباركود...');
                    setIsScannerError(false);
                }, 3000);
            } finally {
                setIsScanProcessing(false);
            }
            return;
        }

        // Ordinary item scan
        if (!capabilities.canAdjustQuantity) {
            setScannerMessage('غير مصرح لك بتعديل الكميات');
            setIsScannerError(true);
            setTimeout(() => {
                setScannerMessage('جاري قراءة الباركود...');
                setIsScannerError(false);
            }, 3000);
            setIsScanProcessing(false);
            return;
        }

        try {
            const item = await apiClient.get<Item>(`/items/by-barcode/${encodeURIComponent(trimmed)}`);
            setScannedItem(item);
            setIsAdjustModalOpen(true); // Open adjust modal with the item
            closeScanner(); // Close the scanner overlay
        } catch (error: any) {
            let msg = error.message || 'خطأ غير متوقع';
            if (error instanceof ApiError && error.status === 404) {
                msg = 'لم يتم العثور على صنف مطابق';
            }
            setScannerMessage(msg);
            setIsScannerError(true);
            // Reset after a delay
            setTimeout(() => {
                setScannerMessage('جاري قراءة الباركود...');
                setIsScannerError(false);
            }, 3000);
        } finally {
            setIsScanProcessing(false);
        }
    };

    const closeAdjustModal = (andReopenScanner = false) => {
        setIsAdjustModalOpen(false);
        setScannedItem(null);
        if (andReopenScanner && capabilities.canAdjustQuantity) {
            openScanner(); // Re-open scanner for continuous workflow
        }
    };

    const value = {
        activePage,
        setActivePage,
        isScannerOpen,
        openScanner,
        closeScanner,
        scannerMessage,
        isScannerError,
        isScanProcessing,
        handleBarcodeScan,
        scannedItem,
        isAdjustModalOpen,
        closeAdjustModal,
        selectedPO,
        setSelectedPO,
        isPOReceiptModalOpen,
        openPOReceipt,
        closePOReceiptModal,
        isPODetailModalOpen,
        openPODetail,
        closePODetailModal,
        lastReceipt,
        setLastReceipt
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};