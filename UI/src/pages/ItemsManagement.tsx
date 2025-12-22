import { useState, useEffect } from 'react';
import { Plus, Home } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { SearchBar } from '../components/SearchBar';
import { Table } from '../components/Table';
import { AddItemModal } from '../components/AddItemModal';
import { AdjustQuantityModal } from '../components/AdjustQuantityModal';
import { EditItemModal } from '../components/EditItemModal';
import { CategoryModal } from '../components/CategoryModal';
import { Item, Unit, Category } from '../types';
import { ItemActions } from '../components/ItemActions';
import { CategoryActions } from '../components/CategoryActions';
import { MainCategoryCard } from '../components/MainCategoryCard';
import { itemsService, ItemsResponse } from '../services/itemsService';
import { categoryService, CategoriesResponse } from '../services/categoryService';
import { useUnits, useCategories } from '../hooks/useMetadata';
import { useItems } from '../hooks/useItems';

type ViewLevel = 'mainCategories' | 'subCategories' | 'items';

export const ItemsManagement = () => {
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
    // Always invalidate dashboard stats when something changes
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
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
    setCategoryToEdit(category);
    setCurrentParentId(parentId);
    setIsCategoryModalOpen(true);
  };

  const handleDeleteCategory = async (category: Category) => {
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

  // Columns Definitions
  const columns = [
    { key: 'id', header: 'المعرف' },
    { key: 'name', header: 'اسم الصنف' },
    {
      key: 'current_quantity',
      header: 'الكمية الحالية',
      render: (_: any, row: Item) => `${row.current_quantity} ${row.unit_name}`
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (status: Item['status']) => <span className={`badge ${status === 'active' ? 'badge-success' : 'badge-error'}`}>{status}</span>
    },
    {
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
    },
  ];

  const subCategoryColumns = [
    { key: 'id', header: 'المعرف' },
    { key: 'name', header: 'اسم الفئة الفرعية' },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (_: any, row: Category) => (
        <CategoryActions
          category={row}
          onEdit={(cat) => handleOpenCategoryModal(cat, cat.parent_id)}
          onDelete={handleDeleteCategory}
        />
      ),
    },
  ];

  const renderBreadcrumbs = () => (
    <div className="flex items-center gap-2 text-lg" dir="rtl">
      <button
        onClick={() => {
          setViewLevel('mainCategories');
          setSelectedMainCategory(null);
          setSelectedSubCategory(null);
          updateSessionState({ viewLevel: 'mainCategories' });
        }}
        className="flex items-center gap-2"
      >
        <span>الأقسام الرئيسية</span>
        <Home size={16} />
      </button>

      {selectedMainCategory && (
        <>
          <span className="mx-1 text-gray-400">/</span>
          <button
            onClick={handleBack}
            disabled={viewLevel !== 'items'}
            className="disabled:font-bold disabled:text-primary disabled:cursor-text"
          >
            {selectedMainCategory.name}
          </button>
        </>
      )}

      {selectedSubCategory && (
        <>
          <span className="mx-1 text-gray-400">/</span>
          <span className="font-bold text-primary">
            {selectedSubCategory.name}
          </span>
        </>
      )}
    </div>
  );

  return (
    <div className="p-6 bg-base-200 min-h-full">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-base-content">إدارة الأصناف</h1>
        <p className="text-base-content/70">تصفح الأقسام والأصناف، وقم بإدارتها.</p>
      </header>

      {/* Conditional Rendering based on viewLevel */}
      {loading && <div className="flex justify-center items-center h-64"><span className="loading loading-spinner loading-lg"></span></div>}
      {error && <div className="alert alert-error"><span>{error}</span></div>}

      {!loading && !error && (
        <>
          {viewLevel === 'mainCategories' && (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {/* Add new main category card */}
              {mainCategories.length < 8 && (
                <MainCategoryCard
                  onClick={() => handleOpenCategoryModal(null, null)}
                  className="border-2 border-primary-500 h-28"
                />
              )}
              {/* Main category cards */}
              {mainCategories.map((cat: Category) => (
                <MainCategoryCard
                  key={cat.id}
                  category={cat}
                  onSelect={handleSelectMainCategory}
                  onEdit={(c) => handleOpenCategoryModal(c, null)}
                  onDelete={handleDeleteCategory}
                  className="border-2 border-primary-500 h-28"
                />
              ))}
            </div>
          )}

          {viewLevel === 'subCategories' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                {renderBreadcrumbs()}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleOpenCategoryModal(null, selectedMainCategory?.id ?? null)}
                >
                  <Plus size={20} /> إضافة فئة فرعية
                </button>
              </div>

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
          )}

          {viewLevel === 'items' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                {renderBreadcrumbs()}
              </div>

              <div className="bg-base-100 p-4 rounded-box shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <SearchBar onSearch={setSearchTerm} />
                  <button onClick={() => setIsAddItemModalOpen(true)} className="btn btn-primary"><Plus size={18} /> إضافة صنف جديد</button>
                </div>
                <Table
                  columns={columns}
                  data={items} // filteredItems is just items now
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
                />
              </div>
            </div>
          )}
        </>
      )}

      {isAddItemModalOpen && (
        <AddItemModal
          isOpen={isAddItemModalOpen}
          onClose={() => setIsAddItemModalOpen(false)}
          onItemAdded={handleItemAdded}
          units={units}
          subCategoryId={selectedSubCategory?.id}
        />
      )}

      {isEditItemModalOpen && selectedItem && (
        <EditItemModal
          isOpen={isEditItemModalOpen}
          onClose={() => setIsEditItemModalOpen(false)}
          onItemUpdated={handleItemUpdated}
          item={selectedItem}
          units={units}
        />
      )}

      {isAdjustModalOpen && selectedItem && (
        <AdjustQuantityModal
          isOpen={isAdjustModalOpen}
          onClose={() => setIsAdjustModalOpen(false)}
          onItemAdjusted={handleItemUpdated}
          item={selectedItem}
        />
      )}

      <CategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        onSave={handleCategorySaved}
        categoryToEdit={categoryToEdit}
        parentId={currentParentId}
      />
    </div>
  );
};