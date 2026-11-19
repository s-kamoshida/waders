/**
 * サーバーのテスト用の準備（テスト専用）。
 * メモリ上の DB、一時フォルダのカテゴリーの定義のファイル、時刻・ID を固定した商品の操作で Web アプリケーションを組み立てる。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type express from 'express';
import { createCategoryService } from '../../../server/application/categoryService.ts';
import { createProductService, type ProductService } from '../../../server/application/productService.ts';
import type { CategoryId } from '../../../server/domain/category.ts';
import type { ProductId } from '../../../server/domain/product.ts';
import { CATEGORY_TEMPLATE_FILE_PATH, createCategoryDefinitionFile } from '../../../server/infrastructure/categoryDefinitionFile.ts';
import { createSqliteProductRepository, openProductDatabase, type ProductRepository } from '../../../server/infrastructure/sqliteProductRepository.ts';
import { createWebApplication } from '../../../server/presentation/webApplication.ts';

/** テストで使う現在時刻（日本時間 2026-11-17 12:00）。 */
export const TEST_CURRENT_TIME = new Date('2026-11-17T03:00:00.000Z');

/** テストで使うカテゴリーの定義（定義のファイルの並び順）。 */
export const TEST_CATEGORIES = [
  { id: 'scale', name: 'スケールフィギュア' },
  { id: 'action', name: '可動フィギュア' },
] as const;

/** テスト用に組み立てたもの。 */
export type WebApplicationTestHarness = {
  readonly application: express.Express;
  readonly database: DatabaseSync;
  readonly productRepository: ProductRepository;
  readonly productService: ProductService;
  /** カテゴリーの定義のファイルの場所（一時フォルダ）。 */
  readonly categoryDefinitionFilePath: string;
  /** カテゴリーの定義のファイルを書き換える（手で編集した場合を再現する）。文字列はそのまま書く。 */
  writeCategoryDefinition(content: unknown): void;
  /** 現在時刻を進める。 */
  setCurrentTime(currentTime: Date): void;
};

/**
 * テスト用の Web アプリケーションを組み立てる。商品の ID は product-1, product-2, … の順に振る。
 * @param clientBuildDirectory ビルド済みの画面のフォルダ（存在しなくてもよい）
 */
export function createWebApplicationTestHarness(clientBuildDirectory: string): WebApplicationTestHarness {
  const database = openProductDatabase(':memory:');
  const categoryDefinitionFilePath = join(mkdtempSync(join(tmpdir(), 'waders-test-categories-')), 'categories.json');
  const writeCategoryDefinition = (content: unknown): void => {
    writeFileSync(categoryDefinitionFilePath, typeof content === 'string' ? content : JSON.stringify(content), { mode: 0o600 });
  };
  writeCategoryDefinition({ version: 1, categories: TEST_CATEGORIES });
  let issuedCategoryIdCount = 0;
  const categoryDefinition = createCategoryDefinitionFile({
    filePath: categoryDefinitionFilePath,
    templateFilePath: CATEGORY_TEMPLATE_FILE_PATH,
    generateCategoryId: () => {
      issuedCategoryIdCount += 1;
      return `category-${issuedCategoryIdCount}` as CategoryId;
    },
  });
  const productRepository = createSqliteProductRepository(database);
  let currentTime = TEST_CURRENT_TIME;
  let issuedIdCount = 0;
  const productService = createProductService({
    productRepository,
    clock: { now: () => currentTime },
    categoryDefinition,
    generateProductId: () => {
      issuedIdCount += 1;
      return `product-${issuedIdCount}` as ProductId;
    },
  });
  return {
    application: createWebApplication({
      clientBuildDirectory,
      productService,
      categoryService: createCategoryService({ categoryDefinition }),
    }),
    database,
    productRepository,
    productService,
    categoryDefinitionFilePath,
    writeCategoryDefinition,
    setCurrentTime(nextTime) {
      currentTime = nextTime;
    },
  };
}
