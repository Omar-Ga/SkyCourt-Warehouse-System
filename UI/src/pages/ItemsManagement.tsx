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

type ViewLevel = 'mainCategories' | 'subCategories' | 'items';

export interface ItemsManagementProps {
  canMutateItems?: boolean;
  canMutateCategories?: boolean;
}

export const ItemsManagement = ({
  canMutateItems: propCanMutateItems,
  canMutateCategories: propCanMutateCategories,
}: ItemsManagementProps = {}) => {
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

  // Modals
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isEditItemModalOpen, setIsEditItemModalOpen] = useState(false);

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryToEdit, setCategoryToEdit] = useState<Category | null>(null);
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);

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

    if (isNewSubCategory) {
      setSelectedSubCategory(category);
      setItemPage(1);
      setViewLevel('items');
      updateSessionState({
        viewLevel: 'items',
        selectedSubCategory: category,
        itemPage: 1
      });
    } else {
      setItemPage(page);
      updateSessionState({ itemPage: page });
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

  const invalidateData = (keys: string[]) => {
    keys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
    // Invalidate dashboard stats and logs on stock/item mutations
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    queryClient.invalidateQueries({ queryKey: ['recent-logs'] });
    queryClient.invalidateQueries({ queryKey: ['movement-logs'] });
  };

  const handleItemAdded = () => {
    setIsAddItemModalOpen(false);
    invalidateData(['items']);
  };

  const handleItemUpdated = () => {
    invalidateData(['items']);
  };

  const handleCategorySaved = () => {
    // Invalidate both because it could be main or sub
    invalidateData(['categories']);
  };

  const handleOpenCategoryModal = (category: Category | null, parentId: number | null = null) => {
    if (!canMutateCategories) return;
    setCategoryToEdit(category);
    setCurrentParentId(parentId);
    setIsCategoryModalOpen(true);
  };

  const handleDeleteCategory = async (category: Category) => {
    if (!canMutateCategories) return;
    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف الفئة "${category.name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      return;
    }

    try {
      await categoryService.deleteCategory(category.id);
      invalidateData(['categories']);
    } catch (err: any) {
      console.error(err);
      // Maybe set an error state if we want to show alert, but for now log it
    }
  };

  const handleToggleStatus = async (item: Item) => {
    if (!canMutateItems) return;
    const newStatus = item.status === 'active' ? 'inactive' : 'active';

    if (newStatus === 'inactive') {
      if (!window.confirm(`هل أنت متأكد من رغبتك في تعطيل الصنف "${item.name}"؟`)) {
        return;
      }
    }

    try {
      await itemsService.updateItemStatus(item.id, newStatus, 'System');
      invalidateData(['items']);
    } catch (err: any) {
      console.error(err);
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

  const renderBreadcrumbs = () => (
    <nav className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold shadow-xs" dir="rtl" aria-label="مسار التنقل">
      <button
        onClick={() => {
          setViewLevel('mainCategories');
          setSelectedMainCategory(null);
          setSelectedSubCategory(null);
          updateSessionState({ viewLevel: 'mainCategories' });
        }}
        className="flex items-center gap-1.5 text-ink-600 hover:text-brand-violet transition-colors cursor-pointer"
      >
        <Home size={15} className="text-brand-violet" />
        <span>الأقسام الرئيسية</span>
      </button>

      {selectedMainCategory && (
        <>
          <span className="text-gray-300 font-bold">›</span>
          <button
            onClick={handleBack}
            disabled={viewLevel !== 'items'}
            className={`transition-colors ${viewLevel === 'items' ? 'text-ink-600 hover:text-brand-violet cursor-pointer' : 'text-brand-violet font-bold cursor-default'}`}
          >
            {selectedMainCategory.name}
          </button>
        </>
      )}

      {selectedSubCategory && (
        <>
          <span className="text-gray-300 font-bold">›</span>
          <span className="text-brand-violet font-bold cursor-default">
            {selectedSubCategory.name}
          </span>
        </>
      )}
    </nav>
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
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
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
                <Table
                  columns={columns}
                  data={items}
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
          onItemAdjusted={handleItemUpdated}
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
