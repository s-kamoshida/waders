/**
 * サーバーのテスト用の準備（テスト専用）。
 * メモリ上の DB、一時フォルダのカテゴリーの定義のファイル、時刻・ID を固定した商品の操作で Web アプリケーションを組み立てる。
 * 認証は既定で無効（認証のテストでは有効にする。issue #11）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type express from 'express';
import { createAuthenticationService, type AuthenticationService } from '../../../server/application/authenticationService.ts';
import { createCategoryService } from '../../../server/application/categoryService.ts';
import { createProductService, type ProductService } from '../../../server/application/productService.ts';
import type { CategoryId } from '../../../server/domain/category.ts';
import type { ProductId } from '../../../server/domain/product.ts';
import { CATEGORY_TEMPLATE_FILE_PATH, createCategoryDefinitionFile } from '../../../server/infrastructure/categoryDefinitionFile.ts';
import { createSqliteAccountRepository } from '../../../server/infrastructure/sqliteAccountRepository.ts';
import { createSqliteProductRepository, openProductDatabase, type ProductRepository } from '../../../server/infrastructure/sqliteProductRepository.ts';
import { createWebApplication } from '../../../server/presentation/webApplication.ts';

/** テストで使う現在時刻（日本時間 2026-11-17 12:00）。 */
export const TEST_CURRENT_TIME = new Date('2026-11-17T03:00:00.000Z');

/** テストで使うカテゴリーの定義（定義のファイルの並び順）。 */
export const TEST_CATEGORIES = [
  { id: 'scale', name: 'スケールフィギュア' },
  { id: 'action', name: '可動フィギュア' },
] as const;

/**
 * 項目の指定がないカテゴリーで有効な、選べる項目（既定。issue #27）。
 * 送料・メーカー・受注期限・キャンセル可否を有効、場所・手数料・交通費（見込）・その他費用を無効とする。
 */
export const DEFAULT_ENABLED_FIELDS = ['shippingFee', 'maker', 'orderDeadline', 'cancelable'] as const;

/** カテゴリーの ID と名前に、既定の項目の設定（既定の項目と、「その他費用」の名前）を付ける（API の応答の期待値。issue #27）。 */
export function withDefaultFieldSettings(category: { readonly id: string; readonly name: string }) {
  return { ...category, fields: [...DEFAULT_ENABLED_FIELDS], otherExpenseLabel: 'その他費用' };
}

/** テスト用に組み立てたもの。 */
export type WebApplicationTestHarness = {
  readonly application: express.Express;
  readonly database: DatabaseSync;
  readonly productRepository: ProductRepository;
  readonly productService: ProductService;
  /** 認証の操作（issue #11）。 */
  readonly authenticationService: AuthenticationService;
  /** カテゴリーの定義のファイルの場所（一時フォルダ）。 */
  readonly categoryDefinitionFilePath: string;
  /** カテゴリーの定義のファイルを書き換える（手で編集した場合を再現する）。文字列はそのまま書く。 */
  writeCategoryDefinition(content: unknown): void;
  /** 現在時刻を進める。 */
  setCurrentTime(currentTime: Date): void;
};

/** createWebApplicationTestHarness の追加の引数。 */
export type WebApplicationTestHarnessOptions = {
  /** 認証を有効にするか。省略すると無効（issue #11）。 */
  readonly authenticationEnabled?: boolean;
};

/**
 * テスト用の Web アプリケーションを組み立てる。商品の ID は product-1, product-2, … の順に振る。
 * @param clientBuildDirectory ビルド済みの画面のフォルダ（存在しなくてもよい）
 * @param options 認証を有効にするかなど
 */
export function createWebApplicationTestHarness(
  clientBuildDirectory: string,
  options: WebApplicationTestHarnessOptions = {},
): WebApplicationTestHarness {
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
  const authenticationService = createAuthenticationService({
    accountRepository: createSqliteAccountRepository(database),
    clock: { now: () => currentTime },
    authenticationEnabled: options.authenticationEnabled ?? false,
  });
  return {
    application: createWebApplication({
      clientBuildDirectory,
      productService,
      categoryService: createCategoryService({ categoryDefinition }),
      authenticationService,
    }),
    database,
    productRepository,
    productService,
    authenticationService,
    categoryDefinitionFilePath,
    writeCategoryDefinition,
    setCurrentTime(nextTime) {
      currentTime = nextTime;
    },
  };
}
