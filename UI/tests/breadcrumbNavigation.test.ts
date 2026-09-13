import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialBreadcrumbState,
  transitionSelectMainCategory,
  transitionSelectSubCategory,
  transitionNavigateToLevel,
  buildBreadcrumbs,
} from '../src/utils/breadcrumbNavigation.ts';
import type { BreadcrumbCategoryRef } from '../src/utils/breadcrumbNavigation.ts';

const mockMainCat: BreadcrumbCategoryRef = { id: 1, name: 'أجهزة مكتبية' };
const mockSubCat: BreadcrumbCategoryRef = { id: 101, name: 'طابعات ليزر', parent_id: 1 };

describe('Breadcrumb State Transitions & Drill-Down', () => {
  test('initial state produces root breadcrumb only (not clickable)', () => {
    const state = createInitialBreadcrumbState();
    assert.equal(state.viewLevel, 'mainCategories');
    assert.equal(state.selectedMainCategory, null);
    assert.equal(state.selectedSubCategory, null);

    const crumbs = buildBreadcrumbs(state, 'warehouse');
    assert.equal(crumbs.length, 1);
    assert.equal(crumbs[0].level, 'mainCategories');
    assert.equal(crumbs[0].label, 'إدارة الأصناف');
    assert.equal(crumbs[0].isActive, true);
    assert.equal(crumbs[0].isClickable, false);
  });

  test('office role displays "دليل الأصناف" as root breadcrumb label', () => {
    const state = createInitialBreadcrumbState();
    const crumbs = buildBreadcrumbs(state, 'office');
    assert.equal(crumbs.length, 1);
    assert.equal(crumbs[0].label, 'دليل الأصناف');
  });

  test('custom root label can be passed to buildBreadcrumbs', () => {
    const state = createInitialBreadcrumbState();
    const crumbs = buildBreadcrumbs(state, 'الأقسام الرئيسية');
    assert.equal(crumbs[0].label, 'الأقسام الرئيسية');
  });

  test('selecting main category transitions view to subCategories and activates root breadcrumb clickability', () => {
    let state = createInitialBreadcrumbState();
    state = transitionSelectMainCategory(state, mockMainCat);

    assert.equal(state.viewLevel, 'subCategories');
    assert.equal(state.selectedMainCategory?.name, 'أجهزة مكتبية');
    assert.equal(state.selectedSubCategory, null);

    const crumbs = buildBreadcrumbs(state, 'warehouse');
    assert.equal(crumbs.length, 2);
    assert.equal(crumbs[0].isClickable, true);
    assert.equal(crumbs[0].isActive, false);

    assert.equal(crumbs[1].level, 'subCategories');
    assert.equal(crumbs[1].label, 'أجهزة مكتبية');
    assert.equal(crumbs[1].isActive, true);
    assert.equal(crumbs[1].isClickable, false);
  });

  test('selecting subcategory transitions view to items with full three-level breadcrumb trail', () => {
    let state = createInitialBreadcrumbState();
    state = transitionSelectMainCategory(state, mockMainCat);
    state = transitionSelectSubCategory(state, mockSubCat, 2);

    assert.equal(state.viewLevel, 'items');
    assert.equal(state.selectedSubCategory?.name, 'طابعات ليزر');
    assert.equal(state.itemPage, 2);

    const crumbs = buildBreadcrumbs(state, 'warehouse');
    assert.equal(crumbs.length, 3);
    assert.equal(crumbs[0].isClickable, true);
    assert.equal(crumbs[0].isActive, false);

    assert.equal(crumbs[1].level, 'subCategories');
    assert.equal(crumbs[1].label, 'أجهزة مكتبية');
    assert.equal(crumbs[1].isClickable, true);
    assert.equal(crumbs[1].isActive, false);

    assert.equal(crumbs[2].level, 'items');
    assert.equal(crumbs[2].label, 'طابعات ليزر');
    assert.equal(crumbs[2].isClickable, false);
    assert.equal(crumbs[2].isActive, true);
  });

  test('single-click on main category breadcrumb jumps back from items to subCategories', () => {
    let state = createInitialBreadcrumbState();
    state = transitionSelectMainCategory(state, mockMainCat);
    state = transitionSelectSubCategory(state, mockSubCat);

    // User clicks main category breadcrumb
    state = transitionNavigateToLevel(state, 'subCategories');

    assert.equal(state.viewLevel, 'subCategories');
    assert.equal(state.selectedMainCategory?.id, 1);
    assert.equal(state.selectedSubCategory, null);
    assert.equal(state.itemPage, 1);

    const crumbs = buildBreadcrumbs(state, 'warehouse');
    assert.equal(crumbs.length, 2);
    assert.equal(crumbs[0].isClickable, true);
    assert.equal(crumbs[1].isActive, true);
    assert.equal(crumbs[1].isClickable, false);
  });

  test('single-click on root breadcrumb resets navigation back to mainCategories', () => {
    let state = createInitialBreadcrumbState();
    state = transitionSelectMainCategory(state, mockMainCat);
    state = transitionSelectSubCategory(state, mockSubCat);

    // User clicks root breadcrumb
    state = transitionNavigateToLevel(state, 'mainCategories');

    assert.equal(state.viewLevel, 'mainCategories');
    assert.equal(state.selectedMainCategory, null);
    assert.equal(state.selectedSubCategory, null);

    const crumbs = buildBreadcrumbs(state, 'office');
    assert.equal(crumbs.length, 1);
    assert.equal(crumbs[0].label, 'دليل الأصناف');
    assert.equal(crumbs[0].isClickable, false);
    assert.equal(crumbs[0].isActive, true);
  });

  test('navigating to subCategories without a selected main category is safely ignored', () => {
    const initialState = createInitialBreadcrumbState();
    const result = transitionNavigateToLevel(initialState, 'subCategories');
    assert.deepEqual(result, initialState);
  });
});
