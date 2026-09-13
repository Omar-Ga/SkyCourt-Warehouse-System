/* eslint-disable */
import { useState, useEffect } from 'react';
import { Plus, Home } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { SearchBar } from '../components/SearchBar';
import { Table } from '../components/Table';
import { AddItemModal } from '../components/AddItemModal';
import { AdjustQuantityModal } from '../components/AdjustQuantityModal';
import { EditItemModal } from '../components/EditItemModal';
import { CategoryModal } from '../components/CategoryModal';
import { Item, Category } from '../types';
import { ItemActions } from '../components/ItemActions';
import { CategoryActions } from '../components/CategoryActions';
import { MainCategoryCard } from '../components/MainCategoryCard';
import { itemsService, ItemsResponse } from '../services/itemsService';
import { categoryService, CategoriesResponse } from '../services/categoryService';
import { useUnits, useCategories } from '../hooks/useMetadata';
import { useItems } from '../hooks/useItems';
import { useCapabilities } from '../hooks/useCapabilities';
import { useAuth } from '../hooks/useAuth';
import { Breadcrumb } from '../components/Breadcrumb';
import { FilterTabs } from '../components/FilterTabs';
import { EmptyState } from '../components/EmptyState';
import {
  buildBreadcrumbs,
  transitionNavigateToLevel,
  ItemsViewLevel,
} from '../utils/breadcrumbNavigation';
import toast from 'react-hot-toast';

type ViewLevel = ItemsViewLevel;

export interface ItemsManagementProps {
  canMutateItems?: boolean;
  canMutateCategories?: boolean;
}

export const ItemsManagement = ({
  canMutateItems: propCanMutateItems,
  canMutateCategories: propCanMutateCategories,
}: ItemsManagementProps = {}) => {
  const { role } = useAuth();
  const capabilities = useCapabilities();
  const canMutateItems = propCanMutateItems ?? capabilities.canMutateItems;
  const canMutateCategories = propCanMutateCategories ?? capabilities.canMutateCategories;
  const queryClient = useQueryClient();

  // Helper to get initial state from sessionStorage
  const getInitialState = () => {
    const saved = sessionStorage.getItem('itemsManagementState');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved state", e);
      }
    }
    return null;
  };

  const initialState = getInitialState();

  // Navigation state
  const [viewLevel, setViewLevel] = useState<ViewLevel>(initialState?.viewLevel || 'mainCategories');
  const [selectedMainCategory, setSelectedMainCategory] = useState<Category | null>(initialState?.selectedMainCategory || null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<Category | null>(initialState?.selectedSubCategory || null);

  // Pagination
  const [subCategoryPage, setSubCategoryPage] = useState(initialState?.subCategoryPage || 1);
  const [itemPage, setItemPage] = useState(initialState?.itemPage || 1);
  const PAGE_SIZE = 10;

  // Helper to update session storage
  const updateSessionState = (updates: any) => {
    const currentState = {
      viewLevel,
      selectedMainCategory,
      selectedSubCategory,
      itemPage,
      subCategoryPage,
      ...updates
    };

    if (currentState.viewLevel === 'mainCategories') {
      sessionStorage.removeItem('itemsManagementState');
    } else {
      sessionStorage.setItem('itemsManagementState', JSON.stringify(currentState));
    }
  };

  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');

  // Modals
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isEditItemModalOpen, setIsEditItemModalOpen] = useState(false);

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryToEdit, setCategoryToEdit] = useState<Category | null>(null);
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);

  // Auto-Navigation Logic
  useEffect(() => {
    const checkNavigation = async () => {
      const stored = sessionStorage.getItem('dashboardSearchNavigation');
      if (!stored) return;

      try {
        const navData = JSON.parse(stored);
        // 5 seconds expiry
        if (Date.now() - navData.timestamp > 5000) {
          sessionStorage.removeItem('dashboardSearchNavigation');
          return;
        }

        // Fetch categories needed for the view
        // We fetch them freshly to ensure we have valid objects
        const [mainCat, subCat] = await Promise.all([
          categoryService.getCategoryById(navData.mainCategoryId),
          categoryService.getCategoryById(navData.subCategoryId)
        ]);

        if (mainCat && subCat) {
          // Map response data if wrapped
          const mainCatData = (mainCat as any).data || mainCat;
          const subCatData = (subCat as any).data || subCat;

          // Calculate Page Number
          let targetPage = 1;
          try {
            const locationData = await itemsService.getItemLocation(navData.itemId, navData.subCategoryId, PAGE_SIZE);
            targetPage = locationData.page;
          } catch (err) {
            console.error("Failed to calculate item page:", err);
          }

          // Update Session State
          updateSessionState({
            viewLevel: 'items',
            selectedMainCategory: mainCatData,
            selectedSubCategory: subCatData,
            itemPage: targetPage
          });

          // Update Local State
          setViewLevel('items');
          setSelectedMainCategory(mainCatData);
          setSelectedSubCategory(subCatData);
          setItemPage(targetPage);
          setHighlightedItemId(navData.itemId);
          setSearchTerm(''); // Clear search to show context

          // Clear highlight after 3 seconds
          setTimeout(() => setHighlightedItemId(null), 3000);
        }

        sessionStorage.removeItem('dashboardSearchNavigation');
      } catch (e) {
        console.error("Navigation error:", e);
      }
    };

    checkNavigation();
  }, []);

  // Hooks
  const { data: units = [] } = useUnits();

  // 1. Main Categories
  const {
    data: mainCategoriesData,
    isLoading: loadingMain,
    error: errorMain
  } = useCategories(
    { level: 'main' },
    { enabled: viewLevel === 'mainCategories' }
  );
  // Type assertion or safe access
  const mainCategories = Array.isArray(mainCategoriesData) ? mainCategoriesData : (mainCategoriesData as any)?.categories || [];

  // 2. Sub Categories
  const {
    data: subCategoriesData,
    isLoading: loadingSub,
    error: errorSub
  } = useCategories(
    { parent_id: selectedMainCategory?.id, page: subCategoryPage, page_size: PAGE_SIZE },
    { enabled: !!selectedMainCategory && viewLevel === 'subCategories' }
  );

  const subCategories = (subCategoriesData as CategoriesResponse)?.categories || [];
  const totalSubCategories = (subCategoriesData as CategoriesResponse)?.total_count || 0;

  // 3. Items
  const {
    data: itemsData,
    isLoading: loadingItems,
    error: errorItems
  } = useItems(
    {
      sub_category_id: selectedSubCategory?.id,
      page: itemPage,
      page_size: PAGE_SIZE,
      search: searchTerm
    },
    { enabled: !!selectedSubCategory && viewLevel === 'items' }
  );

  const items = (itemsData as ItemsResponse)?.items || [];
  const totalItems = (itemsData as ItemsResponse)?.total_count || 0;

  const filteredItems = items.filter((item: Item) => {
    if (statusFilter === 'in_stock') return (item.current_quantity ?? 0) > 5;
    if (statusFilter === 'low_stock') return (item.current_quantity ?? 0) > 0 && (item.current_quantity ?? 0) <= 5;
    if (statusFilter === 'out_of_stock') return (item.current_quantity ?? 0) <= 0;
    return true;
  });

  const filterCounts = {
    all: items.length,
    in_stock: items.filter((i: Item) => (i.current_quantity ?? 0) > 5).length,
    low_stock: items.filter((i: Item) => (i.current_quantity ?? 0) > 0 && (i.current_quantity ?? 0) <= 5).length,
    out_of_stock: items.filter((i: Item) => (i.current_quantity ?? 0) <= 0).length,
  };

  // Combined Loading/Error
  const loading = loadingMain || loadingSub || loadingItems;
  const errorObj = errorMain || errorSub || errorItems;
  const error = errorObj ? (errorObj as Error).message : null;

  // Handlers
  const handleSelectMainCategory = (category: Category) => {
    setSelectedMainCategory(category);
    setSubCategoryPage(1);
    setViewLevel('subCategories');
    updateSessionState({
      viewLevel: 'subCategories',
      selectedMainCategory: category,
      subCategoryPage: 1
    });
  };

  const handleSelectSubCategory = (category: Category | null, page = 1) => {
    if (!category) return;

    const isNewSubCategory = selectedSubCategory?.id !== category.id;

    setSelectedSubCategory(category);
    setViewLevel('items');
    if (isNewSubCategory) {
      setItemPage(1);
      updateSessionState({
        viewLevel: 'items',
        selectedSubCategory: category,
        itemPage: 1
      });
    } else {
      setItemPage(page);
      updateSessionState({
        viewLevel: 'items',
        selectedSubCategory: category,
        itemPage: page
      });
    }
  };

  const handleBack = () => {
    setSearchTerm('');
    if (viewLevel === 'items') {
      setSelectedSubCategory(null);
      setItemPage(1);
      setViewLevel('subCategories');
      updateSessionState({
        viewLevel: 'subCategories',
        selectedSubCategory: null,
        itemPage: 1
      });
    } else if (viewLevel === 'subCategories') {
      setSelectedMainCategory(null);
      setViewLevel('mainCategories');
      updateSessionState({
        viewLevel: 'mainCategories',
        selectedMainCategory: null
      });
    }
  };

  const invalidateData = (keys: string[], includeStatsAndLogs: boolean = false) => {
    keys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
    if (includeStatsAndLogs) {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
      queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
    }
  };

  const handleItemAdded = () => {
    setIsAddItemModalOpen(false);
    invalidateData(['items'], true);
  };

  const handleItemAdjusted = () => {
    invalidateData(['items'], true);
  };

  const handleItemUpdated = () => {
    invalidateData(['items'], false);
  };

  const handleCategorySaved = () => {
    // Invalidate categories only - stats and logs are not affected by category edits
    invalidateData(['categories'], false);
  };

  const handleOpenCategoryModal = (category: Category | null, parentId: number | null = null) => {
    if (!canMutateCategories) return;
    setCategoryToEdit(category);
    setCurrentParentId(parentId);
    setIsCategoryModalOpen(true);
  };

  const handleDeleteCategory = async (category: Category) => {
    if (!canMutateCategories || isActionPending) return;
    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف الفئة "${category.name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      return;
    }

    setIsActionPending(true);
    try {
      await categoryService.deleteCategory(category.id);
      invalidateData(['categories']);
      toast.success('تم حذف الفئة بنجاح.');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'فشل حذف الفئة. قد تكون مرتبطة بأصناف أو أقسام فرعية.');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleToggleStatus = async (item: Item) => {
    if (!canMutateItems || isActionPending) return;
    const newStatus = item.status === 'active' ? 'inactive' : 'active';

    if (newStatus === 'inactive') {
      if (!window.confirm(`هل أنت متأكد من رغبتك في تعطيل الصنف "${item.name}"؟`)) {
        return;
      }
    }

    setIsActionPending(true);
    try {
      await itemsService.updateItemStatus(item.id, newStatus, 'System');
      invalidateData(['items']);
      toast.success(newStatus === 'active' ? 'تم تنشيط الصنف بنجاح.' : 'تم تعطيل الصنف بنجاح.');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'فشل تحديث حالة الصنف.');
    } finally {
      setIsActionPending(false);
    }
  };

  // Columns Definitions - omit actions column entirely when in read-only mode
  const columns = [
    {
      key: 'id',
      header: 'المعرف',
      render: (id: number) => <span className="font-mono font-bold text-brand-violet">#{id}</span>
    },
    {
      key: 'name',
      header: 'اسم الصنف',
      render: (name: string) => <span className="font-bold text-ink-900">{name}</span>
    },
    {
      key: 'current_quantity',
      header: 'الكمية الحالية',
      render: (_: any, row: Item) => (
        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-ink-900 text-xs font-mono font-bold">
          {row.current_quantity} {row.unit_name}
        </span>
      )
    },
    {
      key: 'status',
      header: 'حالة التوفر',
      render: (status: Item['status'], row: Item) => {
        if (status !== 'active') {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
              غير نشط
            </span>
          );
        }
        const qty = row.current_quantity ?? 0;
        if (qty <= 0) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
              نافد
            </span>
          );
        }
        if (qty <= 5) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
              منخفض
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            متوفر
          </span>
        );
      }
    },
    ...(canMutateItems ? [{
      key: 'actions',
      header: 'إجراءات',
      render: (_: any, item: Item) => (
        <ItemActions
          item={item}
          onAdjust={() => { setSelectedItem(item); setIsAdjustModalOpen(true); }}
          onEdit={() => { setSelectedItem(item); setIsEditItemModalOpen(true); }}
          onToggleStatus={handleToggleStatus}
        />
      )
    }] : []),
  ];

  // Subcategory columns - omit actions column entirely when in read-only mode
  const subCategoryColumns = [
    {
      key: 'id',
      header: 'المعرف',
      render: (id: number) => <span className="font-mono font-bold text-brand-violet">#{id}</span>
    },
    {
      key: 'name',
      header: 'اسم الفئة الفرعية',
      render: (name: string) => <span className="font-bold text-ink-900">{name}</span>
    },
    ...(canMutateCategories ? [{
      key: 'actions',
      header: 'الإجراءات',
      render: (_: any, row: Category) => (
        <CategoryActions
          category={row}
          onEdit={(cat) => handleOpenCategoryModal(cat, cat.parent_id)}
          onDelete={handleDeleteCategory}
        />
      ),
    }] : []),
  ];

  const handleNavigateToBreadcrumb = (targetLevel: ItemsViewLevel) => {
    setSearchTerm('');
    const newState = transitionNavigateToLevel(
      {
        viewLevel,
        selectedMainCategory,
        selectedSubCategory,
      },
      targetLevel
    );

    setViewLevel(newState.viewLevel);
    setSelectedMainCategory(newState.selectedMainCategory as Category | null);
    setSelectedSubCategory(newState.selectedSubCategory as Category | null);

    if (targetLevel === 'mainCategories') {
      setSubCategoryPage(1);
      setItemPage(1);
      updateSessionState({
        viewLevel: 'mainCategories',
        selectedMainCategory: null,
        selectedSubCategory: null,
        subCategoryPage: 1,
        itemPage: 1,
      });
    } else if (targetLevel === 'subCategories') {
      setItemPage(1);
      updateSessionState({
        viewLevel: 'subCategories',
        selectedSubCategory: null,
        itemPage: 1,
      });
    }
  };

  const breadcrumbs = buildBreadcrumbs(
    {
      viewLevel,
      selectedMainCategory,
      selectedSubCategory,
    },
    role
  ).map((crumb) => ({
    ...crumb,
    icon: crumb.level === 'mainCategories' ? <Home size={15} className="text-brand-violet" /> : undefined,
    onClick: crumb.isClickable ? () => handleNavigateToBreadcrumb(crumb.level) : undefined,
  }));

  const renderBreadcrumbs = () => (
    <Breadcrumb items={breadcrumbs} />
  );

  return (
    <div className="space-y-6 max-w-[1520px] mx-auto">
      {/* Conditional Rendering based on viewLevel */}
      {loading && (
        <div className="py-20 text-center bg-white rounded-2xl border border-gray-200 shadow-xs">
          <div className="inline-block w-8 h-8 border-3 border-brand-violet border-t-transparent rounded-full animate-spin mb-3" />
          <p className="font-semibold text-sm text-ink-500">جاري تحميل الأصناف والفئات...</p>
        </div>
      )}

      {error && (
        <div className="p-5 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm font-bold flex items-center justify-between shadow-xs">
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {viewLevel === 'mainCategories' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                {renderBreadcrumbs()}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {/* Add new main category card */}
                {canMutateCategories && mainCategories.length < 25 && (
                  <MainCategoryCard
                    onClick={() => handleOpenCategoryModal(null, null)}
                    className="h-32"
                  />
                )}
                {/* Main category cards */}
                {mainCategories.map((cat: Category) => (
                  <MainCategoryCard
                    key={cat.id}
                    category={cat}
                    onSelect={handleSelectMainCategory}
                    onEdit={canMutateCategories ? (c) => handleOpenCategoryModal(c, null) : undefined}
                    onDelete={canMutateCategories ? handleDeleteCategory : undefined}
                    className="h-32"
                  />
                ))}
              </div>
            </div>
          )}

          {viewLevel === 'subCategories' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                {renderBreadcrumbs()}
                {canMutateCategories && (
                  <button
                    className="px-4 py-2.5 rounded-xl bg-brand-violet hover:bg-brand-violet-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    onClick={() => handleOpenCategoryModal(null, selectedMainCategory?.id ?? null)}
                  >
                    <Plus size={16} />
                    <span>إضافة فئة فرعية</span>
                  </button>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden p-4 sm:p-6">
                <Table
                  columns={subCategoryColumns}
                  data={subCategories}
                  keyField="id"
                  onRowClick={(row) => handleSelectSubCategory(row)}
                  pagination={{
                    currentPage: subCategoryPage,
                    totalPages: Math.ceil(totalSubCategories / PAGE_SIZE),
                    onPageChange: (page) => {
                      setSubCategoryPage(page);
                      updateSessionState({ subCategoryPage: page });
                    },
                    totalItems: totalSubCategories,
                    itemsPerPage: PAGE_SIZE,
                  }}
                  isLoading={loading}
                />
              </div>
            </div>
          )}

          {viewLevel === 'items' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                {renderBreadcrumbs()}
              </div>

              <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-4">
                  <SearchBar onSearch={setSearchTerm} />
                  {canMutateItems && (
                    <button
                      onClick={() => setIsAddItemModalOpen(true)}
                      className="px-4 py-2.5 rounded-xl bg-brand-violet hover:bg-brand-violet-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors shrink-0 cursor-pointer"
                    >
                      <Plus size={16} />
                      <span>إضافة صنف جديد</span>
                    </button>
                  )}
                </div>

                <div className="mb-4">
                  <FilterTabs
                    tabs={[
                      { id: 'all', label: 'الكل', count: filterCounts.all },
                      { id: 'in_stock', label: 'متوفر', count: filterCounts.in_stock },
                      { id: 'low_stock', label: 'منخفض', count: filterCounts.low_stock },
                      { id: 'out_of_stock', label: 'نفد من المخزن', count: filterCounts.out_of_stock },
                    ]}
                    activeTab={statusFilter}
                    onTabChange={setStatusFilter}
                  />
                </div>

                <Table
                  columns={columns}
                  data={filteredItems}
                  keyField="id"
                  pagination={{
                    currentPage: itemPage,
                    totalPages: Math.ceil(totalItems / PAGE_SIZE),
                    onPageChange: (page) => {
                      setItemPage(page);
                      updateSessionState({ itemPage: page });
                    },
                    totalItems: totalItems,
                    itemsPerPage: PAGE_SIZE,
                  }}
                  isLoading={loading}
                  rowClassName={(row) => row.id === highlightedItemId ? 'bg-purple-50/80 font-medium border-r-4 border-r-brand-violet' : ''}
                  emptyState={
                    <EmptyState
                      title={statusFilter !== 'all' ? 'لا توجد أصناف مطابقة للتصفية المحددة' : 'لا توجد أصناف في هذه الفئة'}
                      description={statusFilter !== 'all' ? 'يمكنك التبديل إلى "الكل" لعرض جميع الأصناف.' : 'ابدأ بإضافة أول صنف لمتابعة كمياته وحركته.'}
                      actionLabel={statusFilter !== 'all' ? 'عرض جميع الأصناف' : (canMutateItems ? 'إضافة صنف جديد' : undefined)}
                      onAction={statusFilter !== 'all' ? () => setStatusFilter('all') : (canMutateItems ? () => setIsAddItemModalOpen(true) : undefined)}
                    />
                  }
                />
              </div>
            </div>
          )}
        </>
      )}

      {canMutateItems && isAddItemModalOpen && (
        <AddItemModal
          isOpen={isAddItemModalOpen}
          onClose={() => setIsAddItemModalOpen(false)}
          onItemAdded={handleItemAdded}
          units={units}
          subCategoryId={selectedSubCategory?.id}
        />
      )}

      {canMutateItems && isEditItemModalOpen && selectedItem && (
        <EditItemModal
          isOpen={isEditItemModalOpen}
          onClose={() => setIsEditItemModalOpen(false)}
          onItemUpdated={handleItemUpdated}
          item={selectedItem}
          units={units}
        />
      )}

      {canMutateItems && isAdjustModalOpen && selectedItem && (
        <AdjustQuantityModal
          isOpen={isAdjustModalOpen}
          onClose={() => setIsAdjustModalOpen(false)}
          onItemAdjusted={handleItemAdjusted}
          item={selectedItem}
        />
      )}

      {canMutateCategories && isCategoryModalOpen && (
        <CategoryModal
          isOpen={isCategoryModalOpen}
          onClose={() => setIsCategoryModalOpen(false)}
          onSave={handleCategorySaved}
          categoryToEdit={categoryToEdit}
          parentId={currentParentId}
        />
      )}
    </div>
  );
};
