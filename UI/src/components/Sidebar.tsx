import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Package,
  History,
  Ruler,
  MapPin,
  Truck,
  Settings as SettingsIcon,
  LogOut,
  User as UserIcon,
  ClipboardList,
  Receipt,
  Send,
  PackageCheck,
  Building2,
  Boxes,
  Database,
  Sliders,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';
import { useTicketsCount } from '../hooks/useLeaveOrders';
import { canAccessPage, getNavigationGroupsForRole, Role } from '../navigation';

type SidebarItemProps = {
  icon: React.ReactNode;
  title: string;
  badge?: number | string;
  isActive: boolean;
  isCollapsed: boolean;
  onClick: () => void;
};

const SidebarItem: React.FC<SidebarItemProps> = ({
  icon,
  title,
  badge,
  isActive,
  isCollapsed,
  onClick,
}) => {
  if (isCollapsed) {
    return (
      <li className="mb-1 flex justify-center">
        <button
          type="button"
          onClick={onClick}
          title={title}
          aria-label={title}
          className={`relative flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200 cursor-pointer ${
            isActive
              ? 'bg-brand-violet text-white font-bold shadow-xs'
              : 'text-ink-700 hover:bg-surface-elevated hover:text-ink-950'
          }`}
        >
          <span className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>
            {icon}
          </span>
          {typeof badge === 'number' && badge > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-xs"
              title={`${badge} معلق`}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
          {typeof badge === 'string' && (
            <span
              className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white"
              title="تنبيه العداد"
            />
          )}
        </button>
      </li>
    );
  }

  return (
    <li className="mb-1">
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer ${
          isActive
            ? 'bg-brand-violet text-white font-bold shadow-xs'
            : 'text-ink-700 hover:bg-surface-elevated hover:text-ink-950'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>
            {icon}
          </span>
          <span className="leading-snug truncate text-right">{title}</span>
        </div>
        {typeof badge === 'number' && badge > 0 && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-bold shrink-0 ${
              isActive ? 'bg-amber-400 text-slate-900' : 'bg-amber-500 text-white'
            }`}
          >
            {badge}
          </span>
        )}
        {typeof badge === 'string' && (
          <span
            className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold shrink-0"
            title="تعذر تحديث العداد"
          >
            {badge}
          </span>
        )}
      </button>
    </li>
  );
};

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

const GROUP_ICONS: Record<string, React.ReactNode> = {
  stockOperations: <Boxes size={14} />,
  ordersDocuments: <ClipboardList size={14} />,
  masterData: <Database size={14} />,
  systemReports: <Sliders size={14} />,
};

const ITEM_ICONS: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard size={20} />,
  Package: <Package size={20} />,
  ClipboardList: <ClipboardList size={20} />,
  Receipt: <Receipt size={20} />,
  PackageCheck: <PackageCheck size={20} />,
  Send: <Send size={20} />,
  History: <History size={20} />,
  Ruler: <Ruler size={20} />,
  MapPin: <MapPin size={20} />,
  Truck: <Truck size={20} />,
  Settings: <SettingsIcon size={20} />,
};

export const Sidebar: React.FC = () => {
  const { user, role, logout } = useAuth();
  const { activePage, setActivePage } = useAppContext();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('skycourt_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('skycourt_sidebar_collapsed', String(next));
      } catch {
        // ignore
      }
      window.dispatchEvent(
        new CustomEvent('skycourt_sidebar_collapse', { detail: { isCollapsed: next } })
      );
      return next;
    });
  }, []);

  useEffect(() => {
    const handleCustomToggle = (e: Event) => {
      const custom = e as CustomEvent<{ isCollapsed?: boolean }>;
      if (typeof custom.detail?.isCollapsed === 'boolean') {
        setIsCollapsed(custom.detail.isCollapsed);
      } else {
        setIsCollapsed((prev) => !prev);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'skycourt_sidebar_collapsed') {
        setIsCollapsed(e.newValue === 'true');
      }
    };

    window.addEventListener('skycourt_sidebar_collapse', handleCustomToggle);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('skycourt_sidebar_collapse', handleCustomToggle);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const canSeeTickets = canAccessPage(role, 'DisbursementTickets');
  const { data: ticketsCountData, isError: isCountError } = useTicketsCount({ enabled: canSeeTickets });
  const ticketsCount = isCountError ? '!' : (ticketsCountData?.count || 0);

  const resolvedGroups = getNavigationGroupsForRole(role as Role);

  return (
    <aside
      className={`bg-[#f8f9fc] border-l border-gray-200 flex flex-col h-screen select-none font-sans transition-all duration-300 relative shrink-0 ${
        isCollapsed ? 'w-20 min-w-[80px]' : 'w-68 min-w-[270px]'
      }`}
    >
      {/* Brand Header */}
      {isCollapsed ? (
        <div className="pt-4 pb-3 px-2 flex flex-col items-center border-b border-gray-200 gap-2">
          <button
            type="button"
            onClick={toggleCollapse}
            title="توسيع القائمة الجانبية"
            aria-label="توسيع القائمة الجانبية"
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-ink-950 transition-colors cursor-pointer shadow-2xs"
          >
            <ChevronLeft size={18} />
          </button>
          <img
            src="/assets/skycourt_logo_transparent.png"
            alt="SkyCourt Mall"
            className="h-8 w-auto object-contain"
            title={ROLE_TITLES[role || ''] || 'سكاي كورت'}
          />
          <div
            className="w-2 h-2 rounded-full bg-brand-violet"
            title={ROLE_BADGES[role || ''] || 'المكتب'}
          />
        </div>
      ) : (
        <div className="pt-5 pb-4 px-4 text-center border-b border-gray-200 relative">
          <button
            type="button"
            onClick={toggleCollapse}
            title="طي القائمة الجانبية"
            aria-label="طي القائمة الجانبية"
            className="absolute top-4 left-3 p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-ink-950 transition-colors cursor-pointer shadow-2xs"
          >
            <ChevronRight size={18} />
          </button>
          <img
            src="/assets/skycourt_logo_transparent.png"
            alt="SkyCourt Mall"
            className="h-12 w-auto object-contain mx-auto"
          />
          <h2 className="text-sm font-black text-[#1e1b4b] tracking-tight mt-2 mb-1">
            {ROLE_TITLES[role || ''] || 'نظام مكتب سكاي كورت'}
          </h2>
          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#ede9fe] text-[#6d28d9] text-[11px] font-bold">
            <Building2 size={12} className="shrink-0" />
            <span>{ROLE_BADGES[role || ''] || 'المكتب'}</span>
          </div>
        </div>
      )}

      {/* Navigation Groups */}
      <nav className={`flex-1 flex flex-col overflow-y-auto py-3 ${isCollapsed ? 'px-2' : 'px-3'}`}>
        {/* Top-Level Dashboard Link */}
        <ul className="space-y-1 mb-2">
          <SidebarItem
            title="الرئيسية"
            icon={<LayoutDashboard size={20} />}
            isActive={activePage.toLowerCase() === 'dashboard'}
            isCollapsed={isCollapsed}
            onClick={() => setActivePage('Dashboard')}
          />
        </ul>

        {/* Grouped Navigation Sections */}
        {resolvedGroups.map((group, groupIndex) => {
          const groupIcon = GROUP_ICONS[group.id] || <Boxes size={14} />;

          return (
            <div key={group.id} className="mb-2">
              {isCollapsed ? (
                groupIndex > 0 && <div className="my-2 border-t border-slate-200/60 mx-1" />
              ) : (
                <div className="mt-3 mb-1.5 px-3 flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider select-none">
                  <span className="text-slate-400 shrink-0">{groupIcon}</span>
                  <span>{group.title}</span>
                </div>
              )}

              <ul className="space-y-1">
                {group.items.map((item) => {
                  const isActive = activePage.toLowerCase() === item.id.toLowerCase();
                  const badge = item.id === 'DisbursementTickets' ? ticketsCount : undefined;
                  const itemIcon = ITEM_ICONS[item.icon] || <Package size={20} />;

                  return (
                    <SidebarItem
                      key={item.id}
                      title={item.title}
                      icon={itemIcon}
                      badge={badge}
                      isActive={isActive}
                      isCollapsed={isCollapsed}
                      onClick={() => setActivePage(item.id)}
                    />
                  );
                })}
              </ul>
            </div>
          );
        })}

        {/* User Profile Card & Logout */}
        <div className={`mt-auto pt-3 border-t border-slate-200/60 ${isCollapsed ? 'px-1' : 'space-y-3'}`}>
          {user && (
            isCollapsed ? (
              <div className="flex flex-col items-center gap-2 py-1">
                <div
                  className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 cursor-default"
                  title={`${user.display_name || user.username} (${role === 'office' ? 'مكتب' : role === 'warehouse' ? 'مخزن' : 'مدير'})`}
                >
                  <UserIcon size={18} />
                </div>
                <button
                  type="button"
                  onClick={() => logout()}
                  title="تسجيل الخروج"
                  aria-label="تسجيل الخروج"
                  className="w-10 h-10 rounded-xl border border-purple-200 bg-white hover:bg-purple-50 text-[#5e2b8c] flex items-center justify-center shadow-2xs transition-all cursor-pointer"
                >
                  <LogOut size={16} className="rotate-180" />
                </button>
              </div>
            ) : (
              <div className="pt-1">
                <div className="px-2 py-2 flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                    <UserIcon size={20} />
                  </div>
                  <div className="overflow-hidden flex-1 text-right">
                    <p className="text-sm font-bold text-slate-800 truncate m-0">
                      {user.display_name || user.username}
                    </p>
                    <p className="text-xs font-semibold text-slate-400 m-0 mt-0.5">
                      {role === 'office'
                        ? 'موظف مكتب'
                        : role === 'warehouse'
                        ? 'عامل مخزن'
                        : 'مدير النظام'}
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
            )
          )}
        </div>
      </nav>
    </aside>
  );
};
