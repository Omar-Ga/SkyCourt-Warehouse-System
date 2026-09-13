/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { updateCategoryCacheOptimistically } from '../src/services/categoryService.ts';
import type { Category } from '../src/types.ts';

describe('Optimistic Category Cache Updates', () => {
  test('Creating main category updates main categories cache and does not pollute sub-category queries', () => {
    const mainKey = ['categories', { level: 'main' }];
    const subKey = ['categories', { parent_id: 10, page: 1, page_size: 10 }];

    const initialMainData: Category[] = [
      { id: 1, name: 'Main Category 1', parent_id: null },
      { id: 2, name: 'Main Category 2', parent_id: null },
    ];
    const initialSubData = {
      categories: [
        { id: 101, name: 'Sub Category 10-1', parent_id: 10 },
      ],
      total_count: 1,
    };

    const cache = new Map<any, any>();
    cache.set(mainKey, initialMainData);
    cache.set(subKey, initialSubData);

    const mockQueryClient = {
      getQueriesData: () => Array.from(cache.entries()),
      setQueryData: (key: any, data: any) => {
        cache.set(key, data);
      },
    };

    const optimisticItem: Category = {
      id: -999,
      name: 'New Main Category',
      parent_id: null,
    };

    updateCategoryCacheOptimistically(
      mockQueryClient as any,
      { name: 'New Main Category', parent_id: null },
      optimisticItem
    );

    // Main category query MUST have the new item
    const updatedMain = cache.get(mainKey) as Category[];
    assert.equal(updatedMain.length, 3);
    assert.equal(updatedMain[2].id, -999);
    assert.equal(updatedMain[2].name, 'New Main Category');

    // Subcategory query MUST NOT be touched
    const updatedSub = cache.get(subKey);
    assert.equal(updatedSub.categories.length, 1);
    assert.equal(updatedSub.total_count, 1);
    assert.equal(updatedSub.categories[0].id, 101);
  });

  test('Creating sub-category updates only matching parent query and does not pollute main categories or other parents', () => {
    const mainKey = ['categories', { level: 'main' }];
    const subKey1 = ['categories', { parent_id: 10, page: 1, page_size: 10 }];
    const subKey2 = ['categories', { parent_id: 20, page: 1, page_size: 10 }];

    const initialMainData: Category[] = [
      { id: 1, name: 'Main Category 1', parent_id: null },
    ];
    const initialSubData1 = {
      categories: [
        { id: 101, name: 'Sub 10-1', parent_id: 10 },
      ],
      total_count: 1,
    };
    const initialSubData2 = {
      categories: [
        { id: 201, name: 'Sub 20-1', parent_id: 20 },
      ],
      total_count: 1,
    };

    const cache = new Map<any, any>();
    cache.set(mainKey, initialMainData);
    cache.set(subKey1, initialSubData1);
    cache.set(subKey2, initialSubData2);

    const mockQueryClient = {
      getQueriesData: () => Array.from(cache.entries()),
      setQueryData: (key: any, data: any) => {
        cache.set(key, data);
      },
    };

    const optimisticSub: Category = {
      id: -888,
      name: 'New Sub for Parent 10',
      parent_id: 10,
    };

    updateCategoryCacheOptimistically(
      mockQueryClient as any,
      { name: 'New Sub for Parent 10', parent_id: 10 },
      optimisticSub
    );

    // Main category MUST NOT have the sub-category
    const updatedMain = cache.get(mainKey) as Category[];
    assert.equal(updatedMain.length, 1);
    assert.equal(updatedMain[0].id, 1);

    // Subcategory query for parent 10 MUST be updated
    const updatedSub1 = cache.get(subKey1);
    assert.equal(updatedSub1.categories.length, 2);
    assert.equal(updatedSub1.total_count, 2);
    assert.equal(updatedSub1.categories[1].id, -888);

    // Subcategory query for parent 20 MUST NOT be touched
    const updatedSub2 = cache.get(subKey2);
    assert.equal(updatedSub2.categories.length, 1);
    assert.equal(updatedSub2.total_count, 1);
    assert.equal(updatedSub2.categories[0].id, 201);
  });
});
