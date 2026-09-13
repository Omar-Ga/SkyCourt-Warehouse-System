import type { Role } from '../navigation.ts';

export type ItemsViewLevel = 'mainCategories' | 'subCategories' | 'items';

export interface BreadcrumbItem {
  id: string;
  label: string;
  level: ItemsViewLevel;
  isActive: boolean;
  isClickable?: boolean;
  data?: unknown;
}

export interface BreadcrumbCategoryRef {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface BreadcrumbState {
  viewLevel: ItemsViewLevel;
  selectedMainCategory: BreadcrumbCategoryRef | null;
  selectedSubCategory: BreadcrumbCategoryRef | null;
  subCategoryPage?: number;
  itemPage?: number;
  searchTerm?: string;
}

/**
 * Creates a clean default breadcrumb navigation state.
 */
export function createInitialBreadcrumbState(): BreadcrumbState {
  return {
    viewLevel: 'mainCategories',
    selectedMainCategory: null,
    selectedSubCategory: null,
    subCategoryPage: 1,
    itemPage: 1,
    searchTerm: '',
  };
}

/**
 * State transition for selecting a main category, moving down to subCategories view.
 */
export function transitionSelectMainCategory(
  state: BreadcrumbState,
  mainCategory: BreadcrumbCategoryRef
): BreadcrumbState {
  return {
    ...state,
    viewLevel: 'subCategories',
    selectedMainCategory: mainCategory,
    selectedSubCategory: null,
    subCategoryPage: 1,
    itemPage: 1,
    searchTerm: '',
  };
}

/**
 * State transition for selecting a subcategory, moving down to items table view.
 */
export function transitionSelectSubCategory(
  state: BreadcrumbState,
  subCategory: BreadcrumbCategoryRef,
  page = 1
): BreadcrumbState {
  return {
    ...state,
    viewLevel: 'items',
    selectedSubCategory: subCategory,
    itemPage: page,
    searchTerm: '',
  };
}

/**
 * State transition for single-click jump back to any parent tier in the hierarchy.
 */
export function transitionNavigateToLevel(
  state: BreadcrumbState,
  targetLevel: ItemsViewLevel
): BreadcrumbState {
  if (targetLevel === 'mainCategories') {
    return {
      ...state,
      viewLevel: 'mainCategories',
      selectedMainCategory: null,
      selectedSubCategory: null,
      subCategoryPage: 1,
      itemPage: 1,
      searchTerm: '',
    };
  }

  if (targetLevel === 'subCategories' && state.selectedMainCategory) {
    return {
      ...state,
      viewLevel: 'subCategories',
      selectedSubCategory: null,
      itemPage: 1,
      searchTerm: '',
    };
  }

  return state;
}

/**
 * Builds the array of breadcrumbs corresponding to the current state and role.
 * Resolves role-aware root labels ('دليل الأصناف' for office, 'إدارة الأصناف' for warehouse/admin).
 */
export function buildBreadcrumbs(
  state: BreadcrumbState,
  rootTitleOrRole?: Role | string | null
): BreadcrumbItem[] {
  let rootLabel = 'إدارة الأصناف';

  if (rootTitleOrRole) {
    const trimmed = rootTitleOrRole.trim();
    if (trimmed.toLowerCase() === 'office') {
      rootLabel = 'دليل الأصناف';
    } else if (trimmed.toLowerCase() === 'warehouse' || trimmed.toLowerCase() === 'admin') {
      rootLabel = 'إدارة الأصناف';
    } else if (trimmed.length > 0) {
      rootLabel = trimmed;
    }
  }

  const crumbs: BreadcrumbItem[] = [
    {
      id: 'mainCategories',
      label: rootLabel,
      level: 'mainCategories',
      isActive: state.viewLevel === 'mainCategories',
      isClickable: state.viewLevel !== 'mainCategories',
    },
  ];

  if (state.selectedMainCategory && state.viewLevel !== 'mainCategories') {
    const isLeaf = state.viewLevel === 'subCategories';
    crumbs.push({
      id: `mainCategory-${state.selectedMainCategory.id}`,
      label: state.selectedMainCategory.name,
      level: 'subCategories',
      isActive: isLeaf,
      isClickable: !isLeaf,
      data: state.selectedMainCategory,
    });
  }

  if (state.selectedSubCategory && state.viewLevel === 'items') {
    crumbs.push({
      id: `subCategory-${state.selectedSubCategory.id}`,
      label: state.selectedSubCategory.name,
      level: 'items',
      isActive: true,
      isClickable: false,
      data: state.selectedSubCategory,
    });
  }

  return crumbs;
}
