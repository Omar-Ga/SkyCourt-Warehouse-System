import { useState, useEffect } from 'react';
import { Plus, Home } from 'lucide-react';
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
import { itemsService } from '../services/itemsService';
import { categoryService } from '../services/categoryService';
import { apiClient } from '../services/apiClient';

type ViewLevel = 'mainCategories' | 'subCategories' | 'items';

export const ItemsManagement = () => {
  // Navigation and data state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('mainCategories');
  const [mainCategories, setMainCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedMainCategory, setSelectedMainCategory] = useState<Category | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<Category | null>(null);

  // Pagination State for Sub-categories
  const [subCategoryPage, setSubCategoryPage] = useState(1);
  const [totalSubCategories, setTotalSubCategories] = useState(0);

  // Pagination State for Items
  const [itemPage, setItemPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const PAGE_SIZE = 10;

  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Modal State
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isEditItemModalOpen, setIsEditItemModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  // Category Modals State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryToEdit, setCategoryToEdit] = useState<Category | null>(null);
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(item.id).includes(searchTerm)
  );

  // Effect to restore state from sessionStorage on initial mount
  useEffect(() => {
    const savedStateJSON = sessionStorage.getItem('itemsManagementState');
    if (savedStateJSON) {
      try {
        const savedState = JSON.parse(savedStateJSON);
        // Set state without triggering fetches yet
        setViewLevel(savedState.viewLevel || 'mainCategories');
        setSelectedMainCategory(savedState.selectedMainCategory || null);
        setSelectedSubCategory(savedState.selectedSubCategory || null);
        // Always restore to page 1 to avoid empty screen issues
        // The actual page will be validated when data is fetched
        setItemPage(1);
        setSubCategoryPage(1);
      } catch (e) {
        console.error("Failed to parse saved state, starting fresh.", e);
        sessionStorage.removeItem('itemsManagementState');
      }
    }
  }, []); // <-- Runs only once on mount

  // Effect to fetch data when view level or selections change
  useEffect(() => {
    const fetchUnitsAndData = async () => {
      setLoading(true);
      setError(null);

      // Fetch units once if they are not already loaded
      if (units.length === 0) {
        try {
          const unitsData = await apiClient.get<Unit[]>('/units');
          setUnits(unitsData);
        } catch (err: any) {
          setError(err.message);
          setLoading(false);
          return;
        }
      }

      // Fetch data based on the current view level
      try {
        if (viewLevel === 'items' && selectedSubCategory) {
          // No need to fetch sub-categories, just the items for the current view.
          await handleSelectSubCategory(selectedSubCategory, itemPage);
        } else if (viewLevel === 'subCategories' && selectedMainCategory) {
          await fetchSubCategories(selectedMainCategory, subCategoryPage);
        } else if (viewLevel === 'mainCategories') {
          const data = await categoryService.fetchCategories({ level: 'main' });
          setMainCategories(data as Category[]);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUnitsAndData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLevel, selectedMainCategory, selectedSubCategory]);


  const fetchSubCategories = async (mainCategory: Category, page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data = await categoryService.fetchCategories({ parent_id: mainCategory.id, page, page_size: PAGE_SIZE }) as any;
      setSubCategories(data.categories);
      setTotalSubCategories(data.total_count);
      setSubCategoryPage(page);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMainCategory = (category: Category) => {
    setSelectedMainCategory(category);
    setSubCategoryPage(1); // Reset subcategory page when switching main categories
    setViewLevel('subCategories');
    fetchSubCategories(category, 1);
  };

  const handleSelectSubCategory = async (category: Category | null, page = 1) => {
    if (!category) return; // Do nothing if a row click somehow provides a null category
    
    // Reset to page 1 when switching to a different subcategory
    const isNewSubCategory = selectedSubCategory?.id !== category.id;
    const targetPage = isNewSubCategory ? 1 : page;
    
    setSelectedSubCategory(category);
    setViewLevel('items');
    setLoading(true);
    setError(null);
    try {
      const data = await itemsService.fetchItems({ sub_category_id: category.id, page: targetPage, page_size: PAGE_SIZE }) as any;
      setItems(data.items);
      setTotalItems(data.total_items);
      setItemPage(targetPage);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handles navigation back to the previous view level (items -> subCategories, subCategories -> mainCategories)
  const handleBack = () => {
    setError(null);
    setSearchTerm('');
    if (viewLevel === 'items') {
      setItems([]);
      setSelectedSubCategory(null);
      setItemPage(1); // Reset to the first page when returning to the sub-category list
      setViewLevel('subCategories');
      // If we are going back to sub-cat view, re-fetch the list for that level
      if (selectedMainCategory) {
        fetchSubCategories(selectedMainCategory, subCategoryPage);
      }
    } else if (viewLevel === 'subCategories') {
      setSubCategories([]);
      setSelectedMainCategory(null);

      setViewLevel('mainCategories');
    }
  };

  const refreshItems = async () => {
    if (!selectedSubCategory) return;
    handleSelectSubCategory(selectedSubCategory, itemPage);
  };

  const refreshSubCategories = () => {
    if (selectedMainCategory) {
      fetchSubCategories(selectedMainCategory, subCategoryPage);
    }
  }

  const refreshCategories = async () => {
    // This function will now specifically re-fetch what's needed for the current view.
    setLoading(true);
    setError(null);
    try {
      if (viewLevel === 'mainCategories') {
        const data = await categoryService.fetchCategories({ level: 'main' });
        setMainCategories(data as Category[]);
      } else if (viewLevel === 'subCategories' && selectedMainCategory) {
        // Use the centralized function to refresh sub-categories
        fetchSubCategories(selectedMainCategory, subCategoryPage);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Save navigation state to session storage
  useEffect(() => {
    if (viewLevel === 'mainCategories') {
      sessionStorage.removeItem('itemsManagementState');
    } else {
      const stateToSave = {
        viewLevel,
        selectedMainCategory,
        selectedSubCategory,
        itemPage,
        subCategoryPage,
      };
      sessionStorage.setItem('itemsManagementState', JSON.stringify(stateToSave));
    }
  }, [viewLevel, selectedMainCategory, selectedSubCategory, itemPage, subCategoryPage]);

  const handleOpenCategoryModal = (category: Category | null, parentId: number | null = null) => {
    setCategoryToEdit(category);
    setCurrentParentId(parentId);
    setIsCategoryModalOpen(true);
  };

  const handleDeleteCategory = async (category: Category) => {
    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف الفئة "${category.name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      return;
    }

    setError(null);
    try {
      await categoryService.deleteCategory(category.id);
      // Refresh the list after successful deletion
      if (viewLevel === 'subCategories') {
        refreshSubCategories();
      } else {
        refreshCategories(); // For main categories
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleStatus = async (item: Item) => {
    const newStatus = item.status === 'active' ? 'inactive' : 'active';

    if (newStatus === 'inactive') {
      if (!window.confirm(`هل أنت متأكد من رغبتك في تعطيل الصنف "${item.name}"؟`)) {
        return; // User clicked 'Cancel'
      }
    }

    try {
      await itemsService.updateItemStatus(item.id, newStatus, 'System');
      refreshItems();
    } catch (err: any) {
      setError(err.message);
    }
  };

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
          // Also clear the session storage on manual home navigation
          sessionStorage.removeItem('itemsManagementState');
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
              {mainCategories.map(cat => (
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
                onRowClick={handleSelectSubCategory}
                pagination={{
                  currentPage: subCategoryPage,
                  totalPages: Math.ceil(totalSubCategories / PAGE_SIZE),
                  onPageChange: (page) => {
                    if (selectedMainCategory) fetchSubCategories(selectedMainCategory, page);
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
                  data={filteredItems}
                  keyField="id"
                  pagination={{
                    currentPage: itemPage,
                    totalPages: Math.ceil(totalItems / PAGE_SIZE),
                    onPageChange: (page) => {
                      handleSelectSubCategory(selectedSubCategory, page);
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
          onItemAdded={refreshItems}
          units={units}
          subCategoryId={selectedSubCategory?.id} // Pass sub-category ID
        />
      )}

      {isEditItemModalOpen && selectedItem && (
        <EditItemModal
          isOpen={isEditItemModalOpen}
          onClose={() => setIsEditItemModalOpen(false)}
          onItemUpdated={refreshItems}
          item={selectedItem}
          units={units}
        />
      )}

      {isAdjustModalOpen && selectedItem && (
        <AdjustQuantityModal
          isOpen={isAdjustModalOpen}
          onClose={() => setIsAdjustModalOpen(false)}
          onItemAdjusted={refreshItems}
          item={selectedItem}
        />
      )}

      <CategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        onSave={refreshCategories}
        categoryToEdit={categoryToEdit}
        parentId={currentParentId}
      />
    </div>
  );
};