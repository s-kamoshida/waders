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
    categoryId: 'scale',
    categoryName: 'スケールフィギュア',
    maker: 'メーカーA',
    note: '初回特典付き\n分割で届く',
    location: '東京ドーム',
    handlingFee: 330,
    travelExpense: 2000,
    otherExpense: 600,
    eventStartsAt: '2026-12-20T09:00:00.000Z',
    eventEndsAt: '2026-12-20T12:00:00.000Z',
    createdAt: '2026-11-17T01:00:00.000Z',
    updatedAt: '2026-11-17T01:00:00.000Z',
    ...overrides,
  };
}

/** 版数 6 より前の DB にはない項目（場所・費用・開催日時と終了日時。issue #26）を未入力にしたもの。移行のテストで使う。 */
const FIELDS_ADDED_IN_VERSION_SIX = {
  location: null,
  handlingFee: null,
  travelExpense: null,
  otherExpense: null,
  eventStartsAt: null,
  eventEndsAt: null,
} as const;

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
      categoryId: null,
      categoryName: null,
      maker: null,
      note: null,
      ...FIELDS_ADDED_IN_VERSION_SIX,
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

  it('メーカーと備考を変更した場合、変更が保存され、履歴は記録しない（issue #18）', () => {
    const product = createProduct();
    repository.insertProduct(product);
    const updated: Product = { ...product, maker: 'メーカーB', note: null, updatedAt: change.changedAt };

    repository.updateProduct(updated, change);

    expect(repository.findProductById(product.id)).toEqual(updated);
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('場所と費用を変更した場合、変更が保存され、履歴は記録しない（issue #26）', () => {
    const product = createProduct();
    repository.insertProduct(product);
    const updated: Product = { ...product, location: '日本武道館', handlingFee: null, travelExpense: 0, otherExpense: 1200, updatedAt: change.changedAt };

    repository.updateProduct(updated, change);

    expect(repository.findProductById(product.id)).toEqual(updated);
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('開催日時と終了日時を変更した場合、変更が保存され、片方だけでも保存できる（PR #30 のレビュー）', () => {
    const product = createProduct();
    repository.insertProduct(product);
    const updated: Product = { ...product, eventStartsAt: '2027-01-10T01:30:00.000Z', eventEndsAt: null, updatedAt: change.changedAt };

    repository.updateProduct(updated, change);

    expect(repository.findProductById(product.id)).toEqual(updated);
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
    ['空のメーカー（issue #18）', { maker: '' }],
    ['上限の文字数を超えるメーカー（issue #18）', { maker: 'あ'.repeat(101) }],
    ['上限の文字数を超える備考（issue #18）', { note: 'あ'.repeat(1001) }],
    ['名前のないカテゴリーの ID（issue #10）', { categoryId: 'scale', categoryName: null }],
    ['ID のないカテゴリー名（issue #10）', { categoryId: null, categoryName: 'スケールフィギュア' }],
    ['空のカテゴリーの ID（issue #10）', { categoryId: '' }],
    ['空の場所（issue #26）', { location: '' }],
    ['上限の文字数を超える場所（issue #26）', { location: 'あ'.repeat(101) }],
    ['負の手数料（issue #26）', { handlingFee: -1 }],
    ['上限を超える手数料（issue #26）', { handlingFee: 10_000_000 }],
    ['負の交通費（issue #26）', { travelExpense: -1 }],
    ['上限を超える交通費（issue #26）', { travelExpense: 10_000_000 }],
    ['負のその他費用（issue #26）', { otherExpense: -1 }],
    ['上限を超えるその他費用（issue #26）', { otherExpense: 10_000_000 }],
    ['日時の形式でない開催日時（PR #30 のレビュー）', { eventStartsAt: '2026-12-20 18:00' }],
    ['日時の形式でない終了日時（PR #30 のレビュー）', { eventEndsAt: '2026-12-20' }],
    ['開催日時より前の終了日時（PR #30 のレビュー）', { eventStartsAt: '2026-12-20T09:00:00.000Z', eventEndsAt: '2026-12-20T08:00:00.000Z' }],
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

describe('スキーマの移行（版数 1 から）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('最新のスキーマの版数は 8 である（issue #42）', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(8);
  });

  it('版数 1 の DB を開いた場合、最新の版数に移行し、既存の商品と履歴を保ち、確認待ちは空、メーカーと備考は未入力になる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const versionOneDatabase = new DatabaseSync(databaseFilePath);
    versionOneDatabase.exec(SCHEMA_MIGRATIONS[0] ?? '');
    versionOneDatabase.exec('PRAGMA user_version = 1');
    versionOneDatabase.exec('PRAGMA foreign_keys = ON');
    const product = createProduct({ maker: null, note: null, categoryId: null, categoryName: null, ...FIELDS_ADDED_IN_VERSION_SIX });
    createSqliteProductRepositoryForVersionOne(versionOneDatabase, product);
    versionOneDatabase.close();

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    expect(migratedRepository.listProductHistory(product.id)).toHaveLength(2);
    expect(migratedRepository.listDeliveryConfirmationPendingProductIds()).toEqual([]);
    migratedDatabase.close();
  });
});

describe('スキーマの移行（版数 2 から。issue #18）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('版数 2 の DB を開いた場合、最新の版数に移行し、既存の商品・履歴・確認待ちを保ち、メーカーと備考は未入力になる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const versionTwoDatabase = new DatabaseSync(databaseFilePath);
    versionTwoDatabase.exec('PRAGMA foreign_keys = ON');
    versionTwoDatabase.exec(SCHEMA_MIGRATIONS[0] ?? '');
    versionTwoDatabase.exec(SCHEMA_MIGRATIONS[1] ?? '');
    versionTwoDatabase.exec('PRAGMA user_version = 2');
    const product = createProduct({ maker: null, note: null, categoryId: null, categoryName: null, ...FIELDS_ADDED_IN_VERSION_SIX });
    createSqliteProductRepositoryForVersionOne(versionTwoDatabase, product);
    versionTwoDatabase.prepare('INSERT INTO delivery_confirmations (product_id) VALUES (?)').run(product.id);
    versionTwoDatabase.close();

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    expect(migratedRepository.listProductHistory(product.id)).toHaveLength(2);
    expect(migratedRepository.listDeliveryConfirmationPendingProductIds()).toEqual([product.id]);
    migratedDatabase.close();
  });
});

describe('スキーマの移行（版数 3 → 4。issue #10）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  /** 版数 3 の DB を作り、カテゴリー名だけを持つ商品を書き込む。 */
  function createVersionThreeDatabase(databaseFilePath: string, products: readonly Product[]): void {
    const versionThreeDatabase = new DatabaseSync(databaseFilePath);
    versionThreeDatabase.exec('PRAGMA foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS.slice(0, 3)) versionThreeDatabase.exec(migration);
    versionThreeDatabase.exec('PRAGMA user_version = 3');
    for (const product of products) createSqliteProductRepositoryForVersionOne(versionThreeDatabase, product);
    versionThreeDatabase.close();
  }

  it('版数 3 の DB を開いた場合、最新の版数に移行し、カテゴリーのない商品はカテゴリー未設定のまま', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const product = createProduct({ maker: null, note: null, categoryId: null, categoryName: null, ...FIELDS_ADDED_IN_VERSION_SIX });
    createVersionThreeDatabase(databaseFilePath, [product]);

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    migratedDatabase.close();
  });

  it('版数 3 でカテゴリー名だけを持つ商品は、名前を残し、ID を「legacy:名前」にする（定義にないカテゴリーとして確認できるようにする）', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const product = createProduct({ maker: null, note: null, categoryId: null, categoryName: '可動フィギュア', ...FIELDS_ADDED_IN_VERSION_SIX });
    createVersionThreeDatabase(databaseFilePath, [product]);

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    expect(migratedRepository.findProductById(product.id)).toEqual({ ...product, categoryId: 'legacy:可動フィギュア' });
    migratedDatabase.close();
  });
});

describe('スキーマの移行（版数 4 → 5。issue #11）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('版数 4 の DB を開いた場合、最新の版数に移行し、既存の商品を保つ', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const versionFourDatabase = new DatabaseSync(databaseFilePath);
    versionFourDatabase.exec('PRAGMA foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS.slice(0, 4)) versionFourDatabase.exec(migration);
    versionFourDatabase.exec('PRAGMA user_version = 4');
    const product = createProduct(FIELDS_ADDED_IN_VERSION_SIX);
    insertProductForVersionFour(versionFourDatabase, product);
    versionFourDatabase.close();

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    migratedDatabase.close();
  });
});

describe('スキーマの移行（版数 5 → 6。issue #26）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  /** 版数 5 の DB を作り、商品と、認証のアカウントを書き込む。 */
  function createVersionFiveDatabase(databaseFilePath: string, product: Product): void {
    const versionFiveDatabase = new DatabaseSync(databaseFilePath);
    versionFiveDatabase.exec('PRAGMA foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS.slice(0, 5)) versionFiveDatabase.exec(migration);
    versionFiveDatabase.exec('PRAGMA user_version = 5');
    insertProductForVersionFour(versionFiveDatabase, product);
    versionFiveDatabase
      .prepare(`INSERT INTO account (id, login_id, password_hash, created_at) VALUES (1, 'owner', 'scrypt$hash', '2026-11-01T00:00:00.000Z')`)
      .run();
    versionFiveDatabase.close();
  }

  it('版数 5 の DB を開いた場合、版数 6 に移行し、既存の商品のすべての項目を保ち、場所・費用・開催日時と終了日時は未入力になる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const product = createProduct(FIELDS_ADDED_IN_VERSION_SIX);
    createVersionFiveDatabase(databaseFilePath, product);

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    expect(migratedRepository.listProductHistory(product.id)).toHaveLength(2);
    expect(migratedDatabase.prepare('SELECT login_id FROM account').get()).toEqual({ login_id: 'owner' });
    migratedDatabase.close();
  });

  it('版数 6 に移行した後は、既存の商品に場所・費用・開催日時と終了日時を保存できる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const product = createProduct(FIELDS_ADDED_IN_VERSION_SIX);
    createVersionFiveDatabase(databaseFilePath, product);
    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const updated: Product = {
      ...product,
      location: '日本武道館',
      handlingFee: 440,
      travelExpense: 3000,
      otherExpense: 0,
      eventStartsAt: '2026-12-20T09:00:00.000Z',
      eventEndsAt: '2026-12-21T09:00:00.000Z',
    };
    migratedRepository.updateProduct(updated, { changedAt: '2026-11-18T00:00:00.000Z', changeKind: 'user' });

    expect(migratedRepository.findProductById(product.id)).toEqual(updated);
    migratedDatabase.close();
  });

  it('版数 6 に移行した後も、場所・費用・開催日時と終了日時の範囲は DB が確かめる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const product = createProduct(FIELDS_ADDED_IN_VERSION_SIX);
    createVersionFiveDatabase(databaseFilePath, product);
    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const change = { changedAt: '2026-11-18T00:00:00.000Z', changeKind: 'user' } as const;
    expect(() => migratedRepository.updateProduct({ ...product, handlingFee: -1 }, change)).toThrow();
    expect(() => migratedRepository.updateProduct({ ...product, location: '' }, change)).toThrow();
    expect(() =>
      migratedRepository.updateProduct({ ...product, eventStartsAt: '2026-12-20T09:00:00.000Z', eventEndsAt: '2026-12-20T08:00:00.000Z' }, change),
    ).toThrow();
    migratedDatabase.close();
  });
});

/** 版数 4・5 の DB に、その時点の形（場所と費用の列がない）で商品と登録時の履歴を書き込む。 */
function insertProductForVersionFour(olderDatabase: DatabaseSync, product: Product): void {
  olderDatabase
    .prepare(
      `INSERT INTO products (id, name, release_month, status, cancelable, price, shipping_fee, order_deadline, url, category_id, category, maker, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      product.categoryId,
      product.categoryName,
      product.maker,
      product.note,
      product.createdAt,
      product.updatedAt,
    );
  const insertHistory = olderDatabase.prepare(
    `INSERT INTO product_history (product_id, changed_at, change_kind, field, value_before, value_after) VALUES (?, ?, 'user', ?, NULL, ?)`,
  );
  insertHistory.run(product.id, product.createdAt, 'status', product.status);
  insertHistory.run(product.id, product.createdAt, 'release_month', product.releaseMonth);
}

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
      product.categoryName,
      product.createdAt,
      product.updatedAt,
    );
  const insertHistory = versionOneDatabase.prepare(
    `INSERT INTO product_history (product_id, changed_at, change_kind, field, value_before, value_after) VALUES (?, ?, 'user', ?, NULL, ?)`,
  );
  insertHistory.run(product.id, product.createdAt, 'status', product.status);
  insertHistory.run(product.id, product.createdAt, 'release_month', product.releaseMonth);
}

describe('商品の画像のファイルの名前（issue #41）', () => {
  const imageFileName = '0b6c2d0e-3f0a-4c55-9a8e-2f1d6c7b8a90.jpg';

  it('画像を付けていない商品の場合、画像のファイルの名前は null', () => {
    const product = createProduct();
    repository.insertProduct(product);

    expect(repository.findUploadedImageFileName(product.id)).toBeNull();
    expect(repository.listUploadedImageFileNames().size).toBe(0);
  });

  it('画像のファイルの名前を記録した場合、取得でき、一覧にも含まれる', () => {
    const product = createProduct();
    repository.insertProduct(product);

    expect(repository.setUploadedImageFileName(product.id, imageFileName)).toBe(true);

    expect(repository.findUploadedImageFileName(product.id)).toBe(imageFileName);
    expect(repository.listUploadedImageFileNames()).toEqual(new Map([[product.id, imageFileName]]));
  });

  it('null を記録した場合、画像のファイルの名前を消す', () => {
    const product = createProduct();
    repository.insertProduct(product);
    repository.setUploadedImageFileName(product.id, imageFileName);

    repository.setUploadedImageFileName(product.id, null);

    expect(repository.findUploadedImageFileName(product.id)).toBeNull();
  });

  it('画像のファイルの名前を記録しても、商品のほかの項目・更新日時・変更履歴は変えない', () => {
    const product = createProduct();
    repository.insertProduct(product);

    repository.setUploadedImageFileName(product.id, imageFileName);

    expect(repository.findProductById(product.id)).toEqual(product);
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('商品を更新しても、画像のファイルの名前は残る', () => {
    const product = createProduct();
    repository.insertProduct(product);
    repository.setUploadedImageFileName(product.id, imageFileName);

    repository.updateProduct({ ...product, name: '名前を直した' }, { changedAt: '2026-11-18T00:00:00.000Z', changeKind: 'user' });

    expect(repository.findUploadedImageFileName(product.id)).toBe(imageFileName);
  });

  it('商品が存在しない場合、記録せずに false を返し、取得は undefined を返す', () => {
    expect(repository.setUploadedImageFileName('missing' as ProductId, imageFileName)).toBe(false);
    expect(repository.findUploadedImageFileName('missing' as ProductId)).toBeUndefined();
  });

  it.each(['../settings.json', 'images/a.jpg', '', 'a'.repeat(101)])(
    '保存した形でない名前（"%s"）は、DB の制約で拒否する',
    (fileName) => {
      const product = createProduct();
      repository.insertProduct(product);

      expect(() => repository.setUploadedImageFileName(product.id, fileName)).toThrow(/CHECK constraint failed/);
    },
  );
});

describe('スキーマの移行（版数 6 → 7。issue #41）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('版数 6 の DB を開いた場合、最新の版数に移行し、既存の商品のすべての項目を保ち、画像のファイルの名前は null になる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const product = createProduct(FIELDS_ADDED_IN_VERSION_SIX);
    const versionSixDatabase = new DatabaseSync(databaseFilePath);
    versionSixDatabase.exec('PRAGMA foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS.slice(0, 6)) versionSixDatabase.exec(migration);
    versionSixDatabase.exec('PRAGMA user_version = 6');
    insertProductForVersionFour(versionSixDatabase, product);
    versionSixDatabase.close();

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    expect(migratedRepository.findUploadedImageFileName(product.id)).toBeNull();
    migratedDatabase.close();
  });
});

describe('カード画像のファイルの名前（issue #42）', () => {
  const cardImageFileName = '5d1e7a2c-8b3f-4e6a-9c0d-1f2e3a4b5c6d.png';
  const uploadedImageFileName = '0b6c2d0e-3f0a-4c55-9a8e-2f1d6c7b8a90.jpg';

  it('カード画像を取っていない商品の場合、カード画像のファイルの名前は null', () => {
    const product = createProduct();
    repository.insertProduct(product);

    expect(repository.findCardImageFileName(product.id)).toBeNull();
    expect(repository.listCardImageFileNames().size).toBe(0);
  });

  it('カード画像のファイルの名前を記録した場合、取得でき、一覧にも含まれる', () => {
    const product = createProduct();
    repository.insertProduct(product);

    expect(repository.setCardImageFileName(product.id, cardImageFileName)).toBe(true);

    expect(repository.findCardImageFileName(product.id)).toBe(cardImageFileName);
    expect(repository.listCardImageFileNames()).toEqual(new Map([[product.id, cardImageFileName]]));
  });

  it('null を記録した場合、カード画像のファイルの名前を消す', () => {
    const product = createProduct();
    repository.insertProduct(product);
    repository.setCardImageFileName(product.id, cardImageFileName);

    repository.setCardImageFileName(product.id, null);

    expect(repository.findCardImageFileName(product.id)).toBeNull();
  });

  it('アップロードした画像のファイルの名前とは別に記録する（片方を変えても、もう片方は残る）', () => {
    const product = createProduct();
    repository.insertProduct(product);
    repository.setUploadedImageFileName(product.id, uploadedImageFileName);

    repository.setCardImageFileName(product.id, cardImageFileName);
    repository.setUploadedImageFileName(product.id, null);

    expect(repository.findCardImageFileName(product.id)).toBe(cardImageFileName);
    expect(repository.listUploadedImageFileNames().size).toBe(0);
  });

  it('カード画像のファイルの名前を記録しても、商品のほかの項目・更新日時・変更履歴は変えない', () => {
    const product = createProduct();
    repository.insertProduct(product);

    repository.setCardImageFileName(product.id, cardImageFileName);

    expect(repository.findProductById(product.id)).toEqual(product);
    expect(listChangesAfterRegistration(product.id)).toEqual([]);
  });

  it('商品を更新しても、カード画像のファイルの名前は残る', () => {
    const product = createProduct();
    repository.insertProduct(product);
    repository.setCardImageFileName(product.id, cardImageFileName);

    repository.updateProduct({ ...product, name: '名前を直した' }, { changedAt: '2026-11-18T00:00:00.000Z', changeKind: 'user' });

    expect(repository.findCardImageFileName(product.id)).toBe(cardImageFileName);
  });

  it('商品が存在しない場合、記録せずに false を返し、取得は undefined を返す', () => {
    expect(repository.setCardImageFileName('missing' as ProductId, cardImageFileName)).toBe(false);
    expect(repository.findCardImageFileName('missing' as ProductId)).toBeUndefined();
  });

  it.each(['../settings.json', 'images/a.jpg', '', 'a'.repeat(101)])(
    '保存した形でない名前（"%s"）は、DB の制約で拒否する',
    (fileName) => {
      const product = createProduct();
      repository.insertProduct(product);

      expect(() => repository.setCardImageFileName(product.id, fileName)).toThrow(/CHECK constraint failed/);
    },
  );
});

describe('スキーマの移行（版数 7 → 8。issue #42）', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'waders-migration-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('版数 7 の DB を開いた場合、版数 8 に移行し、既存の商品と画像のファイルの名前を保ち、カード画像のファイルの名前は null になる', () => {
    const databaseFilePath = join(temporaryDirectory, 'waders.sqlite');
    const product = createProduct(FIELDS_ADDED_IN_VERSION_SIX);
    const uploadedImageFileName = '0b6c2d0e-3f0a-4c55-9a8e-2f1d6c7b8a90.jpg';
    const versionSevenDatabase = new DatabaseSync(databaseFilePath);
    versionSevenDatabase.exec('PRAGMA foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS.slice(0, 7)) versionSevenDatabase.exec(migration);
    versionSevenDatabase.exec('PRAGMA user_version = 7');
    insertProductForVersionFour(versionSevenDatabase, product);
    versionSevenDatabase.prepare('UPDATE products SET uploaded_image_file_name = ? WHERE id = ?').run(uploadedImageFileName, product.id);
    versionSevenDatabase.close();

    const migratedDatabase = openProductDatabase(databaseFilePath);
    const migratedRepository = createSqliteProductRepository(migratedDatabase);

    const version = migratedDatabase.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(8);
    expect(migratedRepository.findProductById(product.id)).toEqual(product);
    expect(migratedRepository.findUploadedImageFileName(product.id)).toBe(uploadedImageFileName);
    expect(migratedRepository.findCardImageFileName(product.id)).toBeNull();
    migratedDatabase.close();
  });
});
