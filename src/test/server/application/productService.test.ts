import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProductNotFoundError, type ProductId } from '../../../server/domain/product.ts';
import { productInputSchema } from '../../../shared/productContract.ts';
import {
  TEST_CURRENT_TIME,
  createWebApplicationTestHarness,
  type WebApplicationTestHarness,
} from '../presentation/webApplicationTestHarness.ts';

let harness: WebApplicationTestHarness;
let database: DatabaseSync;

beforeEach(() => {
  harness = createWebApplicationTestHarness('/nonexistent-client-build');
  database = harness.database;
});

afterEach(() => {
  database.close();
});

/** 入力を検証済みの形にする。 */
function createInput(overrides: Record<string, unknown> = {}) {
  return productInputSchema.parse({ name: 'アクションフィギュア セカンド・フォーム', releaseMonth: '2026-12', ...overrides });
}

describe('商品の登録', () => {
  it('登録した場合、ID と登録日時・更新日時（現在時刻）を付けて保存し、保存した商品を返す', () => {
    const product = harness.productService.createProduct(createInput({ price: 13200 }));

    expect(product).toEqual({
      id: 'product-1',
      name: 'アクションフィギュア セカンド・フォーム',
      releaseMonth: '2026-12',
      status: 'considering',
      cancelable: false,
      price: 13200,
      shippingFee: null,
      orderDeadline: null,
      url: null,
      category: null,
      maker: null,
      note: null,
      createdAt: TEST_CURRENT_TIME.toISOString(),
      updatedAt: TEST_CURRENT_TIME.toISOString(),
    });
    expect(harness.productRepository.findProductById(product.id)).toEqual(product);
  });

  it('一覧は登録順に返す', () => {
    harness.productService.createProduct(createInput({ name: '1件目' }));
    harness.setCurrentTime(new Date('2026-11-17T04:00:00.000Z'));
    harness.productService.createProduct(createInput({ name: '2件目' }));

    expect(harness.productService.listProducts().map((product) => product.name)).toEqual(['1件目', '2件目']);
  });
});

describe('商品の編集', () => {
  it('編集した場合、入力の値で更新し、更新日時を現在時刻にし、登録日時は変えない', () => {
    const created = harness.productService.createProduct(createInput());
    const editedAt = new Date('2026-11-18T00:00:00.000Z');
    harness.setCurrentTime(editedAt);

    const updated = harness.productService.updateProduct(
      created.id,
      createInput({ name: '変更後の名前', status: 'reserved', cancelable: true }),
    );

    expect(updated).toEqual({
      ...created,
      name: '変更後の名前',
      status: 'reserved',
      cancelable: true,
      updatedAt: editedAt.toISOString(),
    });
    expect(harness.productRepository.findProductById(created.id)).toEqual(updated);
  });

  it('ステータスを変えた場合、変更の種類を「利用者の操作」として履歴に記録する', () => {
    const created = harness.productService.createProduct(createInput({ status: 'considering' }));

    harness.productService.updateProduct(created.id, createInput({ status: 'reserved' }));

    const lastEntry = harness.productRepository.listProductHistory(created.id).at(-1);
    expect(lastEntry).toMatchObject({ changeKind: 'user', field: 'status', valueBefore: 'considering', valueAfter: 'reserved' });
  });

  it('購入済・未購入も手で設定できる', () => {
    const created = harness.productService.createProduct(createInput());

    expect(harness.productService.updateProduct(created.id, createInput({ status: 'purchased' })).status).toBe('purchased');
    expect(harness.productService.updateProduct(created.id, createInput({ status: 'unpurchased' })).status).toBe('unpurchased');
  });

  it('存在しない商品を編集しようとした場合、ProductNotFoundError にする', () => {
    expect(() => harness.productService.updateProduct('missing' as ProductId, createInput())).toThrow(ProductNotFoundError);
  });
});

describe('商品の削除', () => {
  it('削除した場合、一覧から消える', () => {
    const created = harness.productService.createProduct(createInput());

    harness.productService.deleteProduct(created.id);

    expect(harness.productService.listProducts()).toEqual([]);
  });

  it('存在しない商品を削除しようとした場合、ProductNotFoundError にする', () => {
    expect(() => harness.productService.deleteProduct('missing' as ProductId)).toThrow(ProductNotFoundError);
  });
});
