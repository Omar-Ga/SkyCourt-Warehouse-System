import React from 'react';
import { SoftRefreshButton } from './SoftRefreshButton';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { PageId } from '../navigation';
import {
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
  Cloud,
  CloudOff,
} from 'lucide-react';

interface PageMeta {
  title: string;
  officeTitle?: string;
  subtitle: string;
  officeSubtitle?: string;
  icon: React.ReactNode;
}

const PAGE_META: Record<PageId, PageMeta> = {
  Dashboard: {
    title: 'لوحة التحكم',
    subtitle: 'نظرة عامة على حركة المخزون والعمليات اليومية والتذاكر العاجلة.',
    icon: <LayoutDashboard size={22} className="text-brand-violet" />,
  },
  Items: {
    title: 'إدارة الأصناف',
    officeTitle: 'دليل الأصناف',
    subtitle: 'إدارة وتصفح دليل الأصناف ومستويات الفئات وأرصدة المخزون.',
    officeSubtitle: 'تصفح دليل الأصناف والبحث عن الأرصدة المتوفرة ومتابعة حالتها.',
    icon: <Package size={22} className="text-brand-violet" />,
  },
  PurchaseOrders: {
    title: 'أوامر الشراء',
    subtitle: 'إنشاء ومتابعة أوامر الشراء للموردين وتتبع فترات الصلاحية والطباعة.',
    icon: <ClipboardList size={22} className="text-brand-violet" />,
  },
  DisbursementTickets: {
    title: 'تذاكر الصرف',
    subtitle: 'أذونات الصرف المحجوزة من المكتب وبانتظار الصرف الفعلي والإغلاق.',
    icon: <Receipt size={22} className="text-brand-violet" />,
  },
  POTickets: {
    title: 'تذاكر أوامر الشراء',
    subtitle: 'أوامر الشراء المفتوحة الواردة من الموردين وبانتظار الاستلام بالمخزن.',
    icon: <PackageCheck size={22} className="text-brand-violet" />,
  },
  LeaveOrders: {
    title: 'أذونات الصرف',
    subtitle: 'إصدار ومتابعة أذونات الصرف للأقسام والجهات وتتبع المتبقي بالخارج.',
    icon: <Send size={22} className="text-brand-violet" />,
  },
  Logs: {
    title: 'سجل الحركات',
    officeTitle: 'تقارير الحركات',
    subtitle: 'سجل تدقيق شامل وغير قابل للتعديل لجميع حركات الإضافة والصرف والمرتجع.',
    officeSubtitle: 'تقارير تدقيق حركات المواد وتحليل التوريدات والمنصرفات.',
    icon: <History size={22} className="text-brand-violet" />,
  },
  Units: {
    title: 'إدارة الوحدات',
    subtitle: 'تعريف وإدارة وحدات القياس المستخدمة للأصناف في المخزن.',
    icon: <Ruler size={22} className="text-brand-violet" />,
  },
  Destinations: {
    title: 'إدارة الوجهات',
    subtitle: 'إدارة جهات الصرف والأقسام المصرح لها باستلام المواد.',
    icon: <MapPin size={22} className="text-brand-violet" />,
  },
  Providers: {
    title: 'إدارة الموردين',
    subtitle: 'إدارة بيانات الموردين المعتمدين لتوريد المواد للمستودع.',
    icon: <Truck size={22} className="text-brand-violet" />,
  },
  Settings: {
    title: 'إعدادات النظام',
    subtitle: 'معلومات الخادم، حالة قاعدة البيانات، وفحص المزامنة وإصدار التطبيق.',
    icon: <SettingsIcon size={22} className="text-brand-violet" />,
  },
};

export const TopHeader: React.FC = () => {
  const { activePage } = useAppContext();
  const { role } = useAuth();
  const { data: syncStatus = { connected: true, mode: 'cloud' } } = useSyncStatus();

  const meta = PAGE_META[activePage] || PAGE_META.Dashboard;
  const displayTitle = (role === 'office' && meta.officeTitle) ? meta.officeTitle : meta.title;
  const displaySubtitle = (role === 'office' && meta.officeSubtitle) ? meta.officeSubtitle : meta.subtitle;

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 shadow-xs">
      {/* Title and Context */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center shrink-0">
          {meta.icon}
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-950 m-0 leading-tight">
            {displayTitle}
          </h1>
          <p className="text-xs text-ink-500 m-0 mt-0.5 max-w-xl truncate">
            {displaySubtitle}
          </p>
        </div>
      </div>

      {/* Actions and Status */}
      <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
        {/* Soft Refresh Action */}
        <SoftRefreshButton label="تحديث البيانات" />

        {/* Authoritative Sync / Connectivity Pill */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold select-none transition-colors ${
            syncStatus.connected
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200 shadow-xs'
          }`}
          title={
            syncStatus.connected
              ? 'متصل بقاعدة البيانات السحابية المركزية — المعاملات آمنة ومباشرة'
              : 'غير متصل بقاعدة البيانات — عمليات تعديل المخزون متوقفة مؤقتاً'
          }
        >
          {syncStatus.connected ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs" />
              <Cloud size={14} className="text-emerald-600" />
              <span>متصل بالسحابة</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <CloudOff size={14} className="text-rose-600" />
              <span>غير متصل — العمليات متوقفة</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
