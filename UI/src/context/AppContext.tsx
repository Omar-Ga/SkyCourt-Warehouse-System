/* eslint-disable */
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { PageId, canAccessPage, normalizePageId } from '../navigation';
import { PurchaseOrderDetail, ReceivePOResponse } from '../services/poService';

type AppContextType = {
  activePage: PageId;
  setActivePage: (page: string) => void;
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

    // State for purchase order receipt / review modals
    const [selectedPO, setSelectedPO] = useState<PurchaseOrderDetail | null>(null);
    const [isPOReceiptModalOpen, setIsPOReceiptModalOpen] = useState(false);
    const [isPODetailModalOpen, setIsPODetailModalOpen] = useState(false);
    const [lastReceipt, setLastReceipt] = useState<ReceivePOResponse | null>(null);

    // Reset active page to Dashboard if current page is disallowed on role change
    useEffect(() => {
        if (role && !canAccessPage(role, activePage)) {
            setActivePageState('Dashboard');
        }
    }, [role, activePage]);

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

    const value = {
        activePage,
        setActivePage,
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
