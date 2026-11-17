import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Product, ProductId } from '../../../server/domain/product.ts';
import {
  LATEST_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  createSqliteProductRepository,
  openProductDatabase,
  type ProductRepository,
} from '../../../server/infrastructure/sqliteProductRepository.ts';

let database: DatabaseSync;
let repository: ProductRepository;

beforeEach(() => {
  database = openProductDatabase(':memory:');
  repository = createSqliteProductRepository(database);
});

afterEach(() => {
  database.close();
});

/** すべての項目を持つテスト用の商品を作る。 */
function createProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1' as ProductId,
    name: '1/7 スケールフィギュア シュガー ver.',
    releaseMonth: '2026-12',
    status: 'reserved',
    cancelable: true,
    price: 24200,
    shippingFee: 800,
    orderDeadline: '2026-11-20',
    url: 'https://shop.example.jp/item/1',
    category: 'スケールフィギュア',
    createdAt: '2026-11-17T01:00:00.000Z',
    updatedAt: '2026-11-17T01:00:00.000Z',
    ...overrides,
  };
}

/** 登録時に記録される履歴を除いた、変更の履歴を返す。 */
function listChangesAfterRegistration(productId: ProductId) {
  return repository.listProductHistory(productId).filter((entry) => entry.valueBefore !== null);
}

describe('登録と取得', () => {
  it('商品を登録した場合、ID で取得でき、すべての項目が保存されている', () => {
    const product = createProduct();

    repository.insertProduct(product);

    expect(repository.findProductById(product.id)).toEqual(product);
  });

  it('任意の項目が未入力の場合、未入力（null）のまま保存される', () => {
    const product = createProduct({
      cancelable: false,
      price: null,
      shippingFee: null,
      orderDeadline: null,
      url: null,
      category: null,
    });

    repository.insertProduct(product);

    expect(repository.findProductById(product.id)).toEqual(product);
  });

  it('存在しない ID の場合、undefined を返す', () => {
    expect(repository.findProductById('missing' as ProductId)).toBeUndefined();
  });

  it('一覧は登録順に返す', () => {
    repository.insertProduct(createProduct({ id: 'b' as ProductId, createdAt: '2026-11-17T02:00:00.000Z' }));
    repository.insertProduct(createProduct({ id: 'a' as ProductId, createdAt: '2026-11-17T03:00:00.000Z' }));
    repository.insertProduct(createProduct({ id: 'c' as ProductId, createdAt: '2026-11-17T01:00:00.000Z' }));

    expect(repository.listProducts().map((product) => product.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('更新と変更履歴', () => {
  const change = { changedAt: '2026-11-18T00:00:00.000Z', changeKind: 'user' } as const;

  it('商品を登録した場合、登録日時に、登録時のステータスと発売月を変更前なしの履歴として記録する', () => {
    const product = createProduct({ status: 'considering', releaseMonth: '2026-12' });

    repository.insertProduct(product);

    expect(repository.listProductHistory(product.id)).toEqual([
      { changedAt: product.createdAt, changeKind: 'user', field: 'status', valueBefore: null, valueAfter: 'considering' },
      { changedAt: product.createdAt, changeKind: 'user', field: 'releaseMonth', valueBefore: null, valueAfter: '2026-12' },
    ]);
  });

  it('商品を更新した場合、変更が保存され、true を返す', () => {
    const product = createProduct();
    repository.insertProduct(product);
    const updated = { ...product, name: '変更後の名前', price: 30000, updatedAt: change.changedAt };

    expect(repository.updateProduct(updated, change)).toBe(true);
    expect(repository.findProductById(product.id)).toEqual(updated);
  });

  it('存在しない商品を更新しようとした場合、false を返す', () => {
    expect(repository.updateProduct(createProduct(), change)).toBe(false);
  });

  it('ステータスを変更した場合、変更日時・変更前・変更後・変更の種類を履歴に記録する', () => {
    const product = createProduct({ status: 'reserved' });
    repository.insertProduct(product);

    repository.updateProduct(
      { ...product, status: 'purchased', updatedAt: change.changedAt },
      { changedAt: change.changedAt, changeKind: 'automatic' },
    );

    expect(listChangesAfterRegistration(product.id)).toEqual([
      { changedAt: change.changedAt, changeKind: 'automatic', field: 'status', valueBefore: 'reserved', valueAfter: 'purchased' },
    ]);
  });

  it('発売月を変更した場合、履歴に記録する', () => {
    const product = createProduct({ releaseMonth: '2026-12' });
    repository.insertProduct(product);

    repository.updateProduct({ ...product, releaseMonth: '2027-02', updatedAt: change.changedAt }, change);

    expect(listChangesAfterRegistration(product.id)).toEqual([
      { changedAt: change.changedAt, changeKind: 'user', field: 'releaseMonth', valueBefore: '2026-12', valueAfter: '2027-02' },
    ]);
  });

  it('ステータスと発売月を同時に変更した場合、両方を記録する', () => {
    const product = createProduct({ status: 'considering', releaseMonth: '2026-12' });
    repository.insertProduct(product);

    repository.updateProduct(
      { ...product, status: 'reserved', releaseMonth: '2027-01', updatedAt: change.changedAt },
      change,
    );

    expect(listChangesAfterRegistration(product.id).map((entry) => entry.field).sort()).toEqual([
      'releaseMonth',
      'status',
    ]);
  });

  it('ステータスと発売月以外だけを変更した場合、履歴を記録しない', () => {
    const product = createProduct();
    repository.insertProduct(product);

    repository.updateProduct({ ...product, name: '変更後の名前', updatedAt: change.changedAt }, change);

    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('履歴は古い順に返す', () => {
    const product = createProduct({ status: 'considering' });
    repository.insertProduct(product);
    const reserved = { ...product, status: 'reserved' as const, updatedAt: '2026-11-18T00:00:00.000Z' };
    repository.updateProduct(reserved, { changedAt: reserved.updatedAt, changeKind: 'user' });
    const purchased = { ...reserved, status: 'purchased' as const, updatedAt: '2026-12-01T00:00:00.000Z' };
    repository.updateProduct(purchased, { changedAt: purchased.updatedAt, changeKind: 'automatic' });

    expect(repository.listProductHistory(product.id).map((entry) => `${entry.field}:${entry.valueAfter}`)).toEqual([
      'status:considering',
      'releaseMonth:2026-12',
      'status:reserved',
      'status:purchased',
    ]);
  });
});

describe('削除', () => {
  it('商品を削除した場合、取得できなくなり、その商品の履歴も削除し、true を返す', () => {
    const product = createProduct({ status: 'considering' });
    repository.insertProduct(product);
    repository.updateProduct(
      { ...product, status: 'reserved', updatedAt: '2026-11-18T00:00:00.000Z' },
      { changedAt: '2026-11-18T00:00:00.000Z', changeKind: 'user' },
    );

    expect(repository.deleteProduct(product.id)).toBe(true);
    expect(repository.findProductById(product.id)).toBeUndefined();
    expect(repository.listProductHistory(product.id)).toEqual([]);
  });

  it('存在しない商品を削除しようとした場合、false を返す', () => {
    expect(repository.deleteProduct('missing' as ProductId)).toBe(false);
  });
});

describe('DB の制約（業務ルールの最後の防御）', () => {
  it.each([
    ['存在しないステータス', { status: 'cancelled' }],
    ['空の商品名', { name: '' }],
    ['年と月の形式でない発売月', { releaseMonth: '2026-13' }],
    ['負の金額', { price: -1 }],
    ['上限を超える金額', { price: 10_000_000 }],
    ['負の送料', { shippingFee: -1 }],
    ['日付の形式でない受注期限', { orderDeadline: '2026/11/20' }],
  ])('%s を保存しようとした場合、DB が拒否する', (_label, overrides) => {
    const invalidProduct = { ...createProduct(), ...overrides } as Product;

    expect(() => repository.insertProduct(invalidProduct)).toThrow();
  });
});

describe('スキーマの移行', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-database-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('新しい DB を開いた場合、最新のスキーマ版数になる', () => {
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };

    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
  });

  it('DB ファイルを作成した場合、所有者だけが読み書きできる（0600）', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');

    openProductDatabase(databaseFilePath).close();

    expect(statSync(databaseFilePath).mode & 0o777).toBe(0o600);
  });

  it('既存の DB を開き直した場合、データを保ったまま使える', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const firstDatabase = openProductDatabase(databaseFilePath);
    const product = createProduct();
    createSqliteProductRepository(firstDatabase).insertProduct(product);
    firstDatabase.close();

    const reopenedDatabase = openProductDatabase(databaseFilePath);

    expect(createSqliteProductRepository(reopenedDatabase).findProductById(product.id)).toEqual(product);
    reopenedDatabase.close();
  });
});

describe('延期の確認待ち（issue #9）', () => {
  it('確認待ちの印を付けた場合、確認待ちの一覧に含まれ、外すと含まれなくなる', () => {
    const product = createProduct();
    repository.insertProduct(product);

    repository.markDeliveryConfirmationPending(product.id);
    expect(repository.listDeliveryConfirmationPendingProductIds()).toEqual([product.id]);

    repository.clearDeliveryConfirmationPending(product.id);
    expect(repository.listDeliveryConfirmationPendingProductIds()).toEqual([]);
  });

  it('同じ商品に二度印を付けても、一覧には 1 件だけ含まれる', () => {
    const product = createProduct();
    repository.insertProduct(product);

    repository.markDeliveryConfirmationPending(product.id);
    repository.markDeliveryConfirmationPending(product.id);

    expect(repository.listDeliveryConfirmationPendingProductIds()).toEqual([product.id]);
  });

  it('商品を削除した場合、確認待ちの印も消える', () => {
    const product = createProduct();
    repository.insertProduct(product);
    repository.markDeliveryConfirmationPending(product.id);

    repository.deleteProduct(product.id);

    expect(repository.listDeliveryConfirmationPendingProductIds()).toEqual([]);
  });
});

describe('スキーマの移行（版数 1 → 2）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('最新のスキーマの版数は 2 である', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(2);
  });

  it('版数 1 の DB を開いた場合、版数 2 に移行し、既存の商品と履歴を保ち、確認待ちは空になる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const versionOneDatabase = new DatabaseSync(databaseFilePath);
    versionOneDatabase.exec(SCHEMA_MIGRATIONS[0] ?? '');
    versionOneDatabase.exec('PRAGMA user_version = 1');
    versionOneDatabase.exec('PRAGMA foreign_keys = ON');
    const product = createProduct();
    createSqliteProductRepositoryForVersionOne(versionOneDatabase, product);
    versionOneDatabase.close();

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(2);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    expect(migratedRepository.listProductHistory(product.id)).toHaveLength(2);
    expect(migratedRepository.listDeliveryConfirmationPendingProductIds()).toEqual([]);
    migratedDatabase.close();
  });
});

/** 版数 1 の DB に、版数 1 の時点の形で商品と登録時の履歴を書き込む。 */
function createSqliteProductRepositoryForVersionOne(versionOneDatabase: DatabaseSync, product: Product): void {
  versionOneDatabase
    .prepare(
      `INSERT INTO products (id, name, release_month, status, cancelable, price, shipping_fee, order_deadline, url, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      product.id,
      product.name,
      product.releaseMonth,
      product.status,
      product.cancelable ? 1 : 0,
      product.price,
      product.shippingFee,
      product.orderDeadline,
      product.url,
      product.category,
      product.createdAt,
      product.updatedAt,
    );
  const insertHistory = versionOneDatabase.prepare(
    `INSERT INTO product_history (product_id, changed_at, change_kind, field, value_before, value_after) VALUES (?, ?, 'user', ?, NULL, ?)`,
  );
  insertHistory.run(product.id, product.createdAt, 'status', product.status);
  insertHistory.run(product.id, product.createdAt, 'release_month', product.releaseMonth);
}
