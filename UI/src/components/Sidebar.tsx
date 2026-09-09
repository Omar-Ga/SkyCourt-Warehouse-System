import React from 'react';
import {
  LayoutDashboard, Package, History, Ruler, MapPin, Truck, Settings as SettingsIcon,
  LogOut, User as UserIcon, ClipboardList, Receipt, Send, PackageCheck, Building2
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
  <li className="mb-1.5">
    <button
      onClick={onClick}
      className={`flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer ${
        isActive
          ? 'bg-brand-violet text-white font-bold shadow-xs'
          : 'text-ink-700 hover:bg-surface-elevated hover:text-ink-950'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`${isActive ? 'text-white' : 'text-slate-500'}`}>{icon}</span>
        <span className="leading-snug">{title}</span>
      </div>
      {typeof badge === 'number' && badge > 0 && (
        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
          isActive ? 'bg-amber-400 text-slate-900' : 'bg-amber-500 text-white'
        }`}>
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
  { id: 'DisbursementTickets', title: 'تذاكر الصرف', icon: <Receipt size={20} /> },
  { id: 'POTickets', title: 'تذاكر أوامر الشراء', icon: <PackageCheck size={20} /> },
  { id: 'LeaveOrders', title: 'أذونات الصرف', officeTitle: 'أذونات الصرف', icon: <Send size={20} /> },
  { id: 'Logs', title: 'سجل الحركات', officeTitle: 'تقارير الحركات', icon: <History size={20} /> },
  { id: 'Units', title: 'إدارة الوحدات', icon: <Ruler size={20} /> },
  { id: 'Destinations', title: 'إدارة الوجهات', icon: <MapPin size={20} /> },
  { id: 'Providers', title: 'إدارة الموردين', icon: <Truck size={20} /> },
];

const ROLE_TITLES: Record<string, string> = {
  office: 'نظام المكتب — سكاي كورت',
  warehouse: 'نظام المخزن — سكاي كورت',
  admin: 'إدارة النظام — سكاي كورت',
};

const ROLE_BADGES: Record<string, string> = {
  office: 'المكتب',
  warehouse: 'المخزن',
  admin: 'المدير',
};

export const Sidebar = () => {
  const { user, role, logout } = useAuth();
  const { activePage, setActivePage } = useAppContext();
  const canSeeTickets = canAccessPage(role, 'DisbursementTickets');
  const { data: ticketsCountData, isError: isCountError } = useTicketsCount({ enabled: canSeeTickets });
  const ticketsCount = isCountError ? '!' : (ticketsCountData?.count || 0);

  // Filter items permitted for the current user role
  const visibleItems = NAVIGATION_ITEMS.filter((item) => canAccessPage(role, item.id));

  return (
    <aside className="w-68 min-w-[270px] bg-[#f8f9fc] border-l border-gray-200 flex flex-col h-screen select-none font-sans">
      {/* Brand Header */}
      <div className="pt-6 pb-4 px-4 text-center border-b border-gray-200">
        <img
          src="/assets/skycourt_logo_transparent.png"
          alt="SkyCourt Mall"
          className="h-14 w-auto object-contain mx-auto"
        />
        <h2 className="text-base font-black text-[#1e1b4b] tracking-tight mt-3 mb-1.5">
          {ROLE_TITLES[role || ''] || 'نظام مكتب سكاي كورت'}
        </h2>
        <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#ede9fe] text-[#6d28d9] text-xs font-bold">
          <Building2 size={13} className="shrink-0" />
          <span>{ROLE_BADGES[role || ''] || 'المكتب'}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 flex flex-col overflow-y-auto">
        <ul className="space-y-1">
          {visibleItems.map((item) => {
            const displayTitle = (role === 'office' && item.officeTitle) ? item.officeTitle : item.title;
            const isActive = activePage.toLowerCase() === item.id.toLowerCase();
            const badge = item.id === 'DisbursementTickets' ? ticketsCount : undefined;
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

        <div className="mt-auto pt-3 border-t border-slate-200/60 space-y-3">
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

          {/* User Profile Card and Logout */}
          {user && (
            <div className="pt-1">
              <div className="px-2 py-2 flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                  <UserIcon size={20} />
                </div>
                <div className="overflow-hidden flex-1 text-right">
                  <p className="text-sm font-bold text-slate-800 truncate m-0">
                    {user.display_name || user.username}
                  </p>
                  <p className="text-xs font-semibold text-slate-400 m-0 mt-0.5">
                    {role === 'office' ? 'موظف مكتب' : role === 'warehouse' ? 'عامل مخزن' : 'مدير النظام'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => logout()}
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
                className="w-full py-2.5 px-4 rounded-xl border border-purple-200 bg-white hover:bg-purple-50 text-[#5e2b8c] font-bold text-sm flex items-center justify-center gap-2 shadow-xs hover:shadow-sm transition-all cursor-pointer"
              >
                <LogOut size={16} className="rotate-180" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
};
