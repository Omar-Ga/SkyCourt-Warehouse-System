import { Routes, Route, Navigate } from 'react-router-dom';
import { TopNavBar } from './components/TopNavBar';
import { Dashboard } from './pages/Dashboard';
import { ItemsManagement } from './pages/ItemsManagement';
import { MovementLog } from './pages/MovementLog';
import { UnitManagement } from './pages/UnitManagement';
import { DestinationManagement } from './pages/DestinationManagement';
import { ProviderManagement } from './pages/ProviderManagement';
import { Settings } from './pages/Settings';
import { PurchaseOrders } from './pages/PurchaseOrders';
import { DisbursementTickets } from './pages/DisbursementTickets';
import { POTickets } from './pages/POTickets';
import { LeaveOrders } from './pages/LeaveOrders';
import { useAppContext } from './context/AppContext';
import { useAuth } from './context/AuthContext';
import { POReceiptModal } from './components/POReceiptModal';
import { PODetailModal } from './components/PODetailModal';
import { PageId, canAccessPage } from './navigation';
import { useCapabilities } from './hooks/useCapabilities';
import { useQueryClient } from '@tanstack/react-query';
import { usePrefetchMetadata } from './hooks/useMetadata';
import { useAdaptiveSyncHeartbeat } from './hooks/useAdaptiveSyncHeartbeat';

function ProtectedRoute({ page, element }: { page: PageId; element: React.ReactNode }) {
  const { role } = useAuth();
  if (!role || !canAccessPage(role, page)) {
    return <Navigate to="/" replace />;
  }
  return <>{element}</>;
}

export const App = () => {
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();

  // Prefetch metadata (units, categories, providers, destinations) on app mount
  usePrefetchMetadata();

  // Coordinated adaptive sync heartbeat replacing individual pollers
  useAdaptiveSyncHeartbeat();

  const {
    selectedPO,
    isPOReceiptModalOpen,
    closePOReceiptModal,
    isPODetailModalOpen,
    closePODetailModal,
    setLastReceipt,
  } = useAppContext();

  return (
    <div className="flex flex-col h-screen w-full bg-surface-canvas font-sans overflow-hidden" dir="rtl">
      <TopNavBar />
      <main className="flex-1 w-full overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/items"
            element={<ProtectedRoute page="Items" element={<ItemsManagement />} />}
          />
          <Route
            path="/items/category/:categoryId"
            element={<ProtectedRoute page="Items" element={<ItemsManagement />} />}
          />
          <Route
            path="/items/category/:categoryId/subcategory/:subCategoryId"
            element={<ProtectedRoute page="Items" element={<ItemsManagement />} />}
          />
          <Route
            path="/purchase-orders"
            element={<ProtectedRoute page="PurchaseOrders" element={<PurchaseOrders />} />}
          />
          <Route
            path="/disbursement-tickets"
            element={<ProtectedRoute page="DisbursementTickets" element={<DisbursementTickets />} />}
          />
          <Route
            path="/po-tickets"
            element={<ProtectedRoute page="POTickets" element={<POTickets />} />}
          />
          <Route
            path="/leave-orders"
            element={<ProtectedRoute page="LeaveOrders" element={<LeaveOrders />} />}
          />
          <Route
            path="/logs"
            element={<ProtectedRoute page="Logs" element={<MovementLog />} />}
          />
          <Route
            path="/units"
            element={<ProtectedRoute page="Units" element={<UnitManagement />} />}
          />
          <Route
            path="/destinations"
            element={<ProtectedRoute page="Destinations" element={<DestinationManagement />} />}
          />
          <Route
            path="/providers"
            element={<ProtectedRoute page="Providers" element={<ProviderManagement />} />}
          />
          <Route
            path="/settings"
            element={<ProtectedRoute page="Settings" element={<Settings />} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

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
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            closePODetailModal();
          }}
          canVoid={capabilities.canManagePOs}
        />
      )}
    </div>
  );
};

export default App;
