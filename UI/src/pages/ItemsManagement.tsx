/* eslint-disable */
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Home, Package } from 'lucide-react';
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
import { itemsService } from '../services/itemsService';
import { categoryService } from '../services/categoryService';
import { useUnits, useCategories } from '../hooks/useMetadata';
import { useItems } from '../hooks/useItems';
import { useCapabilities } from '../hooks/useCapabilities';
import { useAuth } from '../hooks/useAuth';
import { Breadcrumb } from '../components/Breadcrumb';
import { FilterTabs } from '../components/FilterTabs';
import { EmptyState } from '../components/EmptyState';
import { PageLayout } from '../components/PageLayout';
import {
  buildBreadcrumbs,
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
  const navigate = useNavigate();
  const { categoryId, subCategoryId } = useParams<{ categoryId?: string; subCategoryId?: string }>();
  const [searchParams] = useSearchParams();

  // Validate numeric route params
  const catIdNum = categoryId && /^\d+$/.test(categoryId) ? parseInt(categoryId, 10) : null;
  const subCatIdNum = subCategoryId && /^\d+$/.test(subCategoryId) ? parseInt(subCategoryId, 10) : null;

  useEffect(() => {
    if (categoryId && !/^\d+$/.test(categoryId)) {
      navigate('/items', { replace: true });
    } else if (subCategoryId && !/^\d+$/.test(subCategoryId)) {
      if (catIdNum) {
        navigate(`/items/category/${catIdNum}`, { replace: true });
      } else {
        navigate('/items', { replace: true });
      }
    }
  }, [categoryId, subCategoryId, catIdNum, navigate]);

  // Derive view level from URL parameters
  const viewLevel: ViewLevel = subCatIdNum ? 'items' : catIdNum ? 'subCategories' : 'mainCategories';

  const [selectedMainCategory, setSelectedMainCategory] = useState<Category | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<Category | null>(null);

  // Pagination
  const [subCategoryPage, setSubCategoryPage] = useState(1);
  const [itemPage, setItemPage] = useState(1);
  const PAGE_SIZE = 10;

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

  // Read highlight query param
  useEffect(() => {
    const highlight = searchParams.get('highlight');
    if (highlight && /^\d+$/.test(highlight)) {
      const id = parseInt(highlight, 10);
      setHighlightedItemId(id);
      const timer = setTimeout(() => setHighlightedItemId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  // Hooks
  const { data: units = [] } = useUnits();

  // 1. Main Categories
  const {
    data: mainCategoriesData,
    isLoading: loadingMain,
    error: errorMain,
  } = useCategories({ level: 'main' });

  const mainCategories = mainCategoriesData?.categories || [];

  // Sync selectedMainCategory from URL or cache
  useEffect(() => {
    if (!catIdNum) {
      setSelectedMainCategory(null);
      return;
    }
    if (selectedMainCategory && selectedMainCategory.id === catIdNum) return;

    const found = mainCategories.find((c) => c.id === catIdNum);
    if (found) {
      setSelectedMainCategory(found);
      return;
    }

    categoryService
      .getCategoryById(catIdNum)
      .then((cat) => {
        const data = (cat as any)?.data || cat;
        if (data) setSelectedMainCategory(data);
      })
      .catch((err) => {
        console.error('Failed to load main category:', err);
        navigate('/items', { replace: true });
      });
  }, [catIdNum, mainCategories, selectedMainCategory, navigate]);

  // 2. Sub Categories (Only when a main category is selected)
  const {
    data: subCategoriesData,
    isLoading: loadingSub,
    error: errorSub,
  } = useCategories(
    { parent_id: catIdNum ?? selectedMainCategory?.id },
    { enabled: Boolean(catIdNum || selectedMainCategory?.id) }
  );

  const subCategories = subCategoriesData?.categories || [];
  const totalSubCategories = subCategories.length;

  // Sync selectedSubCategory from URL or cache
  useEffect(() => {
    if (!subCatIdNum) {
      setSelectedSubCategory(null);
      return;
    }
    if (selectedSubCategory && selectedSubCategory.id === subCatIdNum) return;

    const found = subCategories.find((c) => c.id === subCatIdNum);
    if (found) {
      setSelectedSubCategory(found);
      return;
    }

    categoryService
      .getCategoryById(subCatIdNum)
      .then((cat) => {
        const data = (cat as any)?.data || cat;
        if (data) setSelectedSubCategory(data);
      })
      .catch((err) => {
        console.error('Failed to load subcategory:', err);
        if (catIdNum) {
          navigate(`/items/category/${catIdNum}`, { replace: true });
        } else {
          navigate('/items', { replace: true });
        }
      });
  }, [subCatIdNum, catIdNum, subCategories, selectedSubCategory, navigate]);

  // 3. Items (Only when a sub category is selected)
  const effectiveSubCatId = subCatIdNum ?? selectedSubCategory?.id;
  const {
    items = [],
    total: totalItems,
    isLoading: loadingItems,
    error: errorItems,
  } = useItems(
    {
      sub_category_id: effectiveSubCatId,
      page: itemPage,
      per_page: PAGE_SIZE,
      search: searchTerm,
      status: statusFilter === 'all' ? undefined : statusFilter,
    },
    {
      enabled: Boolean(effectiveSubCatId) && viewLevel === 'items',
    }
  );

  // Compute status counts for filter tabs
  const filterCounts = {
    all: totalItems,
    in_stock: items.filter((i) => (i.current_quantity ?? 0) > 5).length,
    low_stock: items.filter((i) => (i.current_quantity ?? 0) > 0 && (i.current_quantity ?? 0) <= 5).length,
    out_of_stock: items.filter((i) => (i.current_quantity ?? 0) <= 0).length,
  };

  const filteredItems = items.filter((item) => {
    if (statusFilter === 'all') return true;
    const qty = item.current_quantity ?? 0;
    if (statusFilter === 'in_stock') return qty > 5;
    if (statusFilter === 'low_stock') return qty > 0 && qty <= 5;
    if (statusFilter === 'out_of_stock') return qty <= 0;
    return true;
  });

  const loading =
    (viewLevel === 'mainCategories' && loadingMain) ||
    (viewLevel === 'subCategories' && loadingSub) ||
    (viewLevel === 'items' && loadingItems);

  const error =
    (errorMain ? 'فشل تحميل الفئات الرئيسية' : '') ||
    (errorSub ? 'فشل تحميل الفئات الفرعية' : '') ||
    (errorItems ? 'فشل تحميل الأصناف' : '');

  const handleSelectMainCategory = (category: Category) => {
    setSelectedMainCategory(category);
    setSubCategoryPage(1);
    navigate(`/items/category/${category.id}`);
  };

  const handleSelectSubCategory = (category: Category) => {
    setSelectedSubCategory(category);
    setItemPage(1);
    const parentId = catIdNum || selectedMainCategory?.id || category.parent_id;
    navigate(`/items/category/${parentId}/subcategory/${category.id}`);
  };

  const invalidateData = (keys: string[], includeStatsAndLogs: boolean = false) => {
    keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
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

  // Columns Definitions
  const columns = [
    {
      key: 'id',
      header: 'المعرف',
      render: (id: number) => <span className="font-mono font-bold text-primary-700">#{id}</span>,
    },
    {
      key: 'name',
      header: 'اسم الصنف',
      render: (name: string) => <span className="font-bold text-ink-900">{name}</span>,
    },
    {
      key: 'current_quantity',
      header: 'الكمية الحالية',
      render: (_: any, row: Item) => (
        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-ink-900 text-xs font-mono font-bold">
          {row.current_quantity} {row.unit_name}
        </span>
      ),
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
      },
    },
    ...(canMutateItems
      ? [
          {
            key: 'actions',
            header: 'إجراءات',
            render: (_: any, item: Item) => (
              <ItemActions
                item={item}
                onAdjust={() => {
                  setSelectedItem(item);
                  setIsAdjustModalOpen(true);
                }}
                onEdit={() => {
                  setSelectedItem(item);
                  setIsEditItemModalOpen(true);
                }}
                onToggleStatus={handleToggleStatus}
              />
            ),
          },
        ]
      : []),
  ];

  // Subcategory columns
  const subCategoryColumns = [
    {
      key: 'id',
      header: 'المعرف',
      render: (id: number) => <span className="font-mono font-bold text-primary-700">#{id}</span>,
    },
    {
      key: 'name',
      header: 'اسم الفئة الفرعية',
      render: (name: string) => <span className="font-bold text-ink-900">{name}</span>,
    },
    ...(canMutateCategories
      ? [
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
        ]
      : []),
  ];

  const handleNavigateToBreadcrumb = (targetLevel: ItemsViewLevel) => {
    setSearchTerm('');
    if (targetLevel === 'mainCategories') {
      navigate('/items');
    } else if (targetLevel === 'subCategories' && (catIdNum || selectedMainCategory?.id)) {
      navigate(`/items/category/${catIdNum || selectedMainCategory?.id}`);
    }
  };

  const breadcrumbState = {
    viewLevel,
    selectedMainCategory: selectedMainCategory || (catIdNum ? { id: catIdNum, name: '...' } : null),
    selectedSubCategory: selectedSubCategory || (subCatIdNum ? { id: subCatIdNum, name: '...' } : null),
  };

  const breadcrumbs = buildBreadcrumbs(breadcrumbState, role).map((crumb) => ({
    ...crumb,
    icon: crumb.level === 'mainCategories' ? <Home size={15} className="text-primary-600" /> : undefined,
    onClick: crumb.isClickable ? () => handleNavigateToBreadcrumb(crumb.level) : undefined,
  }));

  const pageTitle = role === 'office' ? 'دليل الأصناف' : 'إدارة الأصناف';
  const pageSubtitle =
    role === 'office'
      ? 'تصفح دليل الأصناف والبحث عن الأرصدة المتوفرة ومتابعة حالتها.'
      : 'إدارة وتصفح دليل الأصناف ومستويات الفئات وأرصدة المخزون.';

  // Standard action slot according to viewLevel
  const headerAction = (() => {
    if (viewLevel === 'mainCategories' && canMutateCategories) {
      return (
        <button
          onClick={() => handleOpenCategoryModal(null, null)}
          className="px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <span>إضافة فئة رئيسية</span>
        </button>
      );
    }
    if (viewLevel === 'subCategories' && canMutateCategories) {
      return (
        <button
          onClick={() => handleOpenCategoryModal(null, catIdNum ?? selectedMainCategory?.id ?? null)}
          className="px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <span>إضافة فئة فرعية</span>
        </button>
      );
    }
    if (viewLevel === 'items' && canMutateItems) {
      return (
        <button
          onClick={() => setIsAddItemModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <span>إضافة صنف جديد</span>
        </button>
      );
    }
    return null;
  })();

  return (
    <PageLayout
      title={pageTitle}
      subtitle={pageSubtitle}
      icon={<Package size={22} className="text-primary-600" />}
      breadcrumbs={<Breadcrumb items={breadcrumbs} />}
      action={headerAction}
    >
      <div className="space-y-6 max-w-[1520px] mx-auto">
        {/* Conditional Rendering based on viewLevel */}
        {loading && (
          <div className="py-20 text-center bg-white rounded-2xl border border-gray-200 shadow-xs">
            <div className="inline-block w-8 h-8 border-3 border-primary-600 border-t-transparent rounded-full animate-spin mb-3" />
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {/* Main category cards - note: Add Main Category card is hoisted to header action slot */}
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
                <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-4">
                    <SearchBar onSearch={setSearchTerm} />
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
                      },
                      totalItems: totalItems,
                      itemsPerPage: PAGE_SIZE,
                    }}
                    isLoading={loading}
                    rowClassName={(row) =>
                      row.id === highlightedItemId
                        ? 'bg-primary-50/80 font-medium border-r-4 border-r-primary-600'
                        : ''
                    }
                    emptyState={
                      <EmptyState
                        title={
                          statusFilter !== 'all'
                            ? 'لا توجد أصناف مطابقة للتصفية المحددة'
                            : 'لا توجد أصناف في هذه الفئة'
                        }
                        description={
                          statusFilter !== 'all'
                            ? 'يمكنك التبديل إلى "الكل" لعرض جميع الأصناف.'
                            : 'ابدأ بإضافة أول صنف لمتابعة كمياته وحركته.'
                        }
                        actionLabel={
                          statusFilter !== 'all'
                            ? 'عرض جميع الأصناف'
                            : canMutateItems
                            ? 'إضافة صنف جديد'
                            : undefined
                        }
                        onAction={
                          statusFilter !== 'all'
                            ? () => setStatusFilter('all')
                            : canMutateItems
                            ? () => setIsAddItemModalOpen(true)
                            : undefined
                        }
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
            subCategoryId={effectiveSubCatId}
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
    </PageLayout>
  );
};

export default ItemsManagement;
