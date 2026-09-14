import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  Cloud,
  CloudOff,
  LogOut,
  User as UserIcon,
  LayoutDashboard,
  Package,
  ClipboardList,
  Receipt,
  PackageCheck,
  Send,
  History,
  Ruler,
  MapPin,
  Truck,
  Settings as SettingsIcon,
  Boxes,
  Database,
  Sliders,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useTicketsCount } from '../hooks/useLeaveOrders';
import { SoftRefreshButton } from './SoftRefreshButton';
import {
  Role,
  CANONICAL_PAGE_ROUTES,
  resolveTopNavGroupsForRole,
  canAccessPage,
} from '../navigation';

const ITEM_ICONS: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard size={18} />,
  Items: <Package size={18} />,
  PurchaseOrders: <ClipboardList size={18} />,
  DisbursementTickets: <Receipt size={18} />,
  POTickets: <PackageCheck size={18} />,
  LeaveOrders: <Send size={18} />,
  Logs: <History size={18} />,
  Units: <Ruler size={18} />,
  Destinations: <MapPin size={18} />,
  Providers: <Truck size={18} />,
  Settings: <SettingsIcon size={18} />,
};

const GROUP_ICONS: Record<string, React.ReactNode> = {
  stockOperations: <Boxes size={16} />,
  ordersDocuments: <ClipboardList size={16} />,
  masterData: <Database size={16} />,
  systemReports: <Sliders size={16} />,
};

const ROLE_BADGES: Record<string, string> = {
  office: 'المكتب',
  warehouse: 'المخزن',
  admin: 'المدير',
};

export interface TopNavBarProps {
  currentPath?: string;
  activeRole?: Role;
  isOnline?: boolean;
  onNavigate?: (path: string) => void;
  onLogout?: () => void;
}

export const TopNavBar: React.FC<TopNavBarProps> = ({
  currentPath: propCurrentPath,
  activeRole: propActiveRole,
  isOnline: propIsOnline,
  onNavigate: propOnNavigate,
  onLogout: propOnLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role: authRole, logout } = useAuth();
  const { data: syncStatus = { connected: true, mode: 'cloud' } } = useSyncStatus();

  const role = propActiveRole || (authRole as Role) || 'warehouse';
  const currentPath = propCurrentPath || location.pathname;
  const isOnline = propIsOnline !== undefined ? propIsOnline : syncStatus.connected;

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const canSeeTickets = canAccessPage(role, 'DisbursementTickets');
  const { data: ticketsCountData, isError: isCountError } = useTicketsCount({ enabled: canSeeTickets });
  const ticketsCount = isCountError ? '!' : (ticketsCountData?.count || 0);

  // In-app back button visibility: checks whether history index is > 0
  const [canGoBack, setCanGoBack] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.history?.state?.idx !== undefined) {
      return window.history.state.idx > 0;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.history?.state?.idx !== undefined) {
      setCanGoBack(window.history.state.idx > 0);
    }
  }, [location]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleNavigate = (path: string) => {
    setOpenDropdown(null);
    if (propOnNavigate) {
      propOnNavigate(path);
    } else {
      navigate(path);
    }
  };

  const handleBack = () => {
    if (propOnNavigate) {
      // In prop mode, fallback or let consumer handle
      window.history.back();
    } else {
      navigate(-1);
    }
  };

  const handleLogout = () => {
    if (propOnLogout) {
      propOnLogout();
    } else {
      logout();
    }
  };

  const navGroups = resolveTopNavGroupsForRole(role);

  return (
    <header
      className="bg-white border-b border-gray-200 px-4 lg:px-6 h-16 flex items-center justify-between gap-4 select-none shrink-0 shadow-xs z-30 relative font-sans"
      dir="rtl"
    >
      {/* Right Side: In-App Back Button + Logo */}
      <div className="flex items-center gap-3 shrink-0">
        {canGoBack && (
          <button
            type="button"
            onClick={handleBack}
            title="رجوع"
            aria-label="رجوع"
            className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
          >
            <ArrowLeft size={18} className="rotate-180 rtl:rotate-0 transition-transform" />
          </button>
        )}

        <button
          type="button"
          onClick={() => handleNavigate(CANONICAL_PAGE_ROUTES.Dashboard)}
          className="flex items-center gap-2.5 cursor-pointer focus:outline-hidden"
          title="الرئيسية"
        >
          <img
            src="/assets/skycourt_logo_transparent.png"
            alt="SkyCourt Mall"
            className="h-9 w-auto object-contain"
          />
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-sm font-black text-[#1e1b4b] leading-tight">سكاي كورت</span>
            <span className="text-[10px] text-primary-600 font-bold leading-tight">
              {ROLE_BADGES[role] || 'المستودع'}
            </span>
          </div>
        </button>
      </div>

      {/* Center: Role-Filtered Navigation Menus */}
      <nav ref={dropdownRef} className="flex items-center gap-1.5 overflow-visible">
        {navGroups.map((group) => {
          const isGroupActive = group.items.some((item) => {
            if (item.path === '/') return currentPath === '/';
            return currentPath.startsWith(item.path);
          });
          const isOpen = openDropdown === group.id;

          return (
            <div key={group.id} className="relative">
              <button
                type="button"
                onClick={() => setOpenDropdown(isOpen ? null : group.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  isGroupActive
                    ? 'bg-primary-50 text-primary-700 border border-primary-200 shadow-2xs'
                    : 'text-ink-700 hover:bg-slate-100 hover:text-ink-950'
                }`}
              >
                <span className={isGroupActive ? 'text-primary-600' : 'text-slate-500'}>
                  {GROUP_ICONS[group.id]}
                </span>
                <span>{group.title}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 text-slate-400 ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isOpen && (
                <div className="absolute top-full mt-1.5 right-0 min-w-[200px] bg-white border border-gray-200 rounded-2xl shadow-lg py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 border-b border-gray-100 mb-1">
                    {group.title}
                  </div>
                  {group.items.map((item) => {
                    const isItemActive =
                      item.path === '/'
                        ? currentPath === '/'
                        : currentPath.startsWith(item.path);

                    const showBadge =
                      item.pageId === 'DisbursementTickets' &&
                      typeof ticketsCount === 'number' &&
                      ticketsCount > 0;

                    return (
                      <button
                        key={item.pageId}
                        type="button"
                        onClick={() => handleNavigate(item.path)}
                        className={`flex items-center justify-between w-full px-3.5 py-2 text-xs sm:text-sm text-right font-medium transition-colors cursor-pointer ${
                          isItemActive
                            ? 'bg-primary-50 text-primary-700 font-bold'
                            : 'text-ink-700 hover:bg-slate-50 hover:text-ink-950'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={isItemActive ? 'text-primary-600' : 'text-slate-400'}>
                            {ITEM_ICONS[item.pageId]}
                          </span>
                          <span className="truncate">{item.title}</span>
                        </div>
                        {showBadge && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full font-bold bg-amber-500 text-white shrink-0">
                            {ticketsCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Left Side: Refresh, Sync Indicator, User & Logout */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Soft Refresh */}
        <SoftRefreshButton label="" className="!p-2 !h-9 !w-9 !min-w-[36px] flex items-center justify-center" />

        {/* Compact Cloud Sync Status Icon with Hover Tooltip */}
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            isOnline
              ? 'bg-emerald-50 border-emerald-200 text-status-success hover:bg-emerald-100'
              : 'bg-rose-50 border-rose-200 text-status-danger hover:bg-rose-100'
          }`}
          title={isOnline ? 'متصل بالسحابة' : 'غير متصل'}
          aria-label={isOnline ? 'متصل بالسحابة' : 'غير متصل'}
        >
          {isOnline ? (
            <Cloud size={18} className="text-status-success" />
          ) : (
            <CloudOff size={18} className="text-status-danger animate-pulse" />
          )}
        </div>

        {/* User Badge */}
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-ink-800">
          <UserIcon size={15} className="text-slate-500" />
          <span className="max-w-[100px] truncate">{user?.username || 'المستخدم'}</span>
        </div>

        {/* Logout Button */}
        <button
          type="button"
          onClick={handleLogout}
          title="تسجيل الخروج"
          aria-label="تسجيل الخروج"
          className="w-9 h-9 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
};

export default TopNavBar;
