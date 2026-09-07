import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { ItemsManagement } from './pages/ItemsManagement';
import { MovementLog } from './pages/MovementLog';
import { UnitManagement } from './pages/UnitManagement';
import { DestinationManagement } from './pages/DestinationManagement';
import { ProviderManagement } from './pages/ProviderManagement';
import { Settings } from './pages/Settings';
import { PurchaseOrders } from './pages/PurchaseOrders';
import { Tickets } from './pages/Tickets';
import { LeaveOrders } from './pages/LeaveOrders';
import { POScan } from './pages/POScan';
import { useAppContext } from './context/AppContext';
import { useAuth } from './context/AuthContext';
import { BarcodeScannerOverlay } from './components/BarcodeScannerOverlay';
import { AdjustQuantityModal } from './components/AdjustQuantityModal';
import { POReceiptModal } from './components/POReceiptModal';
import { PODetailModal } from './components/PODetailModal';
import { PageId, canAccessPage, normalizePageId } from './navigation';
import { useCapabilities } from './hooks/useCapabilities';
import { useQueryClient } from '@tanstack/react-query';


const PAGE_COMPONENTS: Record<PageId, React.ComponentType> = {
  Dashboard,
  Items: ItemsManagement,
  PurchaseOrders,
  Tickets,
  LeaveOrders,
  POScan,
  Logs: MovementLog,
  Units: UnitManagement,
  Destinations: DestinationManagement,
  Providers: ProviderManagement,
  Settings,
};

function PageComponent({ page, role }: { page: PageId; role: string | null }) {
  // Defense-in-depth: disallow rendering unauthorized pages directly
  if (!role || !canAccessPage(role, page)) {
    return <Dashboard />;
  }

  const canonical = normalizePageId(page) || 'Dashboard';
  const Component = PAGE_COMPONENTS[canonical] || Dashboard;
  return <Component />;
}

export const App = () => {
  const { role } = useAuth();
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const { 
    activePage,
    isScannerOpen, 
    closeScanner, 
    scannerMessage, 
    isScannerError,
    isScanProcessing,
    handleBarcodeScan,
    scannedItem,
    isAdjustModalOpen,
    closeAdjustModal,
    selectedPO,
    isPOReceiptModalOpen,
    closePOReceiptModal,
    isPODetailModalOpen,
    closePODetailModal,
    setLastReceipt
  } = useAppContext();

  return (
    <div className="flex h-screen bg-gray-100 font-sans" dir="rtl">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-x-hidden overflow-y-auto p-6">
          <PageComponent page={activePage} role={role} />
        </div>
      </main>

      {/* Barcode scanner overlay with in-flight Enter protection */}
      <BarcodeScannerOverlay
        isOpen={isScannerOpen}
        onClose={closeScanner}
        onScan={handleBarcodeScan}
        message={scannerMessage}
        isError={isScannerError}
        isProcessing={isScanProcessing}
      />

      {/* Office cannot render or invoke global scanned-item adjustment controls */}
      {capabilities.canAdjustQuantity && scannedItem && (
        <AdjustQuantityModal
          isOpen={isAdjustModalOpen}
          onClose={() => closeAdjustModal(true)}
          item={scannedItem}
          onItemAdjusted={() => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
            queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
            closeAdjustModal(true); // Reopen scanner on success
          }}
        />
      )}

      {/* Purchase Order Receipt Confirmation Modal (Warehouse / Admin) */}
      {isPOReceiptModalOpen && selectedPO && (
        <POReceiptModal
          isOpen={isPOReceiptModalOpen}
          order={selectedPO}
          onClose={closePOReceiptModal}
          onSuccess={(response) => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-order'] });
            queryClient.invalidateQueries({ queryKey: ['items'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
            queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
            closePOReceiptModal();
            setLastReceipt(response);
          }}
        />
      )}

      {/* Purchase Order Detail / Committed Receipt Review Modal */}
      {isPODetailModalOpen && selectedPO && (
        <PODetailModal
          isOpen={isPODetailModalOpen}
          order={selectedPO}
          onClose={closePODetailModal}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-order'] });
            queryClient.invalidateQueries({ queryKey: ['items'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
            closePODetailModal();
          }}
          canVoid={capabilities.canManagePOs}
        />
      )}
    </div>
  );
};