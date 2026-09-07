import React from 'react';
import {
  LayoutDashboard, Package, History, Ruler, MapPin, Truck, Settings as SettingsIcon,
  LogOut, User as UserIcon, ClipboardList, Receipt, Send, PackageCheck
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';
import { useTicketsCount } from '../hooks/useLeaveOrders';
import { PageId, canAccessPage } from '../navigation';

type SidebarItemProps = {
  icon: React.ReactNode;
  title: string;
  badge?: number | string;
  isActive: boolean;
  onClick: () => void;
};

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, title, badge, isActive, onClick }) => (
  <li className="mb-1">
    <button
      onClick={onClick}
      className={`flex items-center justify-between w-full px-6 py-3 text-sm transition-colors duration-200 ${
        isActive
          ? 'bg-primary-500 text-white font-medium'
          : 'text-white hover:bg-primary-600 hover:text-white'
      }`}
    >
      <div className="flex items-center">
        <span className="mr-4">{icon}</span>
        <span>{title}</span>
      </div>
      {typeof badge === 'number' && badge > 0 && (
        <span className="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
          {badge}
        </span>
      )}
      {typeof badge === 'string' && (
        <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold" title="تعذر تحديث العداد">
          {badge}
        </span>
      )}
    </button>
  </li>
);

interface NavEntry {
  id: PageId;
  title: string;
  officeTitle?: string;
  icon: React.ReactNode;
}

const NAVIGATION_ITEMS: NavEntry[] = [
  { id: 'Dashboard', title: 'الرئيسية', icon: <LayoutDashboard size={20} /> },
  { id: 'Items', title: 'إدارة الأصناف', officeTitle: 'دليل الأصناف', icon: <Package size={20} /> },
  { id: 'PurchaseOrders', title: 'أوامر الشراء', icon: <ClipboardList size={20} /> },
  { id: 'Tickets', title: 'تذاكر الصرف', icon: <Receipt size={20} /> },
  { id: 'LeaveOrders', title: 'أذونات الصرف', icon: <Send size={20} /> },
  { id: 'POScan', title: 'استلام أوامر الشراء', icon: <PackageCheck size={20} /> },
  { id: 'Logs', title: 'سجل الحركات', officeTitle: 'تقارير الحركات', icon: <History size={20} /> },
  { id: 'Units', title: 'إدارة الوحدات', icon: <Ruler size={20} /> },
  { id: 'Destinations', title: 'إدارة الوجهات', icon: <MapPin size={20} /> },
  { id: 'Providers', title: 'إدارة الموردين', icon: <Truck size={20} /> },
];

const ROLE_LABELS: Record<string, string> = {
  office: 'المكتب',
  warehouse: 'المخزن',
  admin: 'المدير',
};

const HEADER_TITLES: Record<string, string> = {
  office: 'نظام المكتب',
  warehouse: 'نظام المخزن',
  admin: 'إدارة النظام',
};

export const Sidebar = () => {
  const { user, role, logout } = useAuth();
  const { activePage, setActivePage } = useAppContext();
  const canSeeTickets = canAccessPage(role, 'Tickets');
  const { data: ticketsCountData, isError: isCountError } = useTicketsCount({ enabled: canSeeTickets });
  const ticketsCount = isCountError ? '!' : (ticketsCountData?.count || 0);

  // Filter items permitted for the current user role
  const visibleItems = NAVIGATION_ITEMS.filter((item) => canAccessPage(role, item.id));

  return (
    <aside className="w-64 bg-primary-800 text-white flex flex-col">
      <div className="h-20 flex items-center justify-center border-b border-primary-700">
        <h1 className="text-2xl font-bold">{HEADER_TITLES[role || ''] || 'المخزن'}</h1>
      </div>
      <nav className="flex-1 px-2 py-4 flex flex-col">
        <ul className="space-y-2">
          {visibleItems.map((item) => {
            const displayTitle = (role === 'office' && item.officeTitle) ? item.officeTitle : item.title;
            const isActive = activePage.toLowerCase() === item.id.toLowerCase();
            const badge = item.id === 'Tickets' ? ticketsCount : undefined;
            return (
              <SidebarItem
                key={item.id}
                title={displayTitle}
                icon={item.icon}
                badge={badge}
                isActive={isActive}
                onClick={() => setActivePage(item.id)}
              />
            );
          })}
        </ul>

        <div className="mt-auto pt-4 border-t border-primary-700 space-y-2">
          {canAccessPage(role, 'Settings') && (
            <ul className="space-y-1">
              <SidebarItem
                title="الإعدادات"
                icon={<SettingsIcon size={20} />}
                isActive={activePage.toLowerCase() === 'settings'}
                onClick={() => setActivePage('Settings')}
              />
            </ul>
          )}

          {/* User Profile and Logout */}
          {user && (
            <div className="px-4 py-3 mt-2 bg-primary-900/60 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-primary-700 flex items-center justify-center text-white shrink-0">
                  <UserIcon size={16} />
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-semibold truncate text-white">{user.display_name || user.username}</p>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary-700/80 text-primary-200">
                    {ROLE_LABELS[user.role] || user.role || ''}
                  </span>
                </div>
              </div>

              <button
                onClick={() => logout()}
                title="تسجيل الخروج"
                className="p-1.5 rounded text-primary-300 hover:text-white hover:bg-primary-700 transition-colors"
              >
                <LogOut size={18} />
              </button>
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
};