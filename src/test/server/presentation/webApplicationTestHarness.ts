/**
 * サーバーのテスト用の準備（テスト専用）。
 * メモリ上の DB と、時刻・ID を固定した商品の操作で Web アプリケーションを組み立てる。
 */
import type { DatabaseSync } from 'node:sqlite';
import type express from 'express';
import { createProductService, type ProductService } from '../../../server/application/productService.ts';
import type { ProductId } from '../../../server/domain/product.ts';
import { createSqliteProductRepository, openProductDatabase, type ProductRepository } from '../../../server/infrastructure/sqliteProductRepository.ts';
import { createWebApplication } from '../../../server/presentation/webApplication.ts';

/** テストで使う現在時刻（日本時間 2026-11-17 12:00）。 */
export const TEST_CURRENT_TIME = new Date('2026-11-17T03:00:00.000Z');

/** テスト用に組み立てたもの。 */
export type WebApplicationTestHarness = {
  readonly application: express.Express;
  readonly database: DatabaseSync;
  readonly productRepository: ProductRepository;
  readonly productService: ProductService;
  /** 現在時刻を進める。 */
  setCurrentTime(currentTime: Date): void;
};

/**
 * テスト用の Web アプリケーションを組み立てる。商品の ID は product-1, product-2, … の順に振る。
 * @param clientBuildDirectory ビルド済みの画面のフォルダ（存在しなくてもよい）
 */
export function createWebApplicationTestHarness(clientBuildDirectory: string): WebApplicationTestHarness {
  const database = openProductDatabase(':memory:');
  const productRepository = createSqliteProductRepository(database);
  let currentTime = TEST_CURRENT_TIME;
  let issuedIdCount = 0;
  const productService = createProductService({
    productRepository,
    clock: { now: () => currentTime },
    generateProductId: () => {
      issuedIdCount += 1;
      return `product-${issuedIdCount}` as ProductId;
    },
  });
  return {
    application: createWebApplication({ clientBuildDirectory, productService }),
    database,
    productRepository,
    productService,
    setCurrentTime(nextTime) {
      currentTime = nextTime;
    },
  };
}
