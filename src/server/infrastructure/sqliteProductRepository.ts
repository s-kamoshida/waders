/**
 * 商品の保存（SQLite）。
 *
 * 所属: インフラストラクチャ層
 * 責務:
 *  - DB ファイルを開き（所有者のみ読み書き可）、スキーマを最新の版数に移行する
 *  - 商品の登録・取得・一覧・更新・削除と、ステータス・発売月の変更履歴の記録
 *  - 延期の確認を待っている商品の記録（issue #9）
 *  - カテゴリーの改名・削除に伴う、商品のカテゴリーの一括の変更（issue #10）
 * 業務ルールに対応する CHECK 制約を DB にも付け、検証をすり抜けた不正な値を最後に拒否する。
 * SQLite は Node.js 標準の node:sqlite を使う（CLAUDE.md「技術スタック」）。
 */
import { existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MAXIMUM_CATEGORY_ID_LENGTH } from '../../shared/categoryContract.ts';
import {
  MAXIMUM_CATEGORY_NAME_LENGTH,
  MAXIMUM_MAKER_LENGTH,
  MAXIMUM_NOTE_LENGTH,
  MAXIMUM_PRICE_YEN,
  MAXIMUM_PRODUCT_NAME_LENGTH,
  PRODUCT_STATUSES,
  productStatusSchema,
} from '../../shared/productContract.ts';
import type {
  Product,
  ProductChange,
  ProductHistoryEntry,
  ProductHistoryField,
  ProductId,
} from '../domain/product.ts';

const statusList = PRODUCT_STATUSES.map((status) => `'${status}'`).join(', ');

/**
 * スキーマの移行。**既存の要素は絶対に書き換えず、変更は末尾に要素を追加する**（利用者の既存の DB が壊れるため）。
 * 要素の番号 + 1 がスキーマの版数（PRAGMA user_version）になる。
 */
export const SCHEMA_MIGRATIONS: readonly string[] = [
  // 版数 1: 商品と変更履歴（issue #7）
  `
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND ${MAXIMUM_PRODUCT_NAME_LENGTH}),
    release_month TEXT NOT NULL CHECK (
      release_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
      AND CAST(substr(release_month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    ),
    status TEXT NOT NULL CHECK (status IN (${statusList})),
    cancelable INTEGER NOT NULL CHECK (cancelable IN (0, 1)),
    price INTEGER CHECK (price IS NULL OR price BETWEEN 0 AND ${MAXIMUM_PRICE_YEN}),
    shipping_fee INTEGER CHECK (shipping_fee IS NULL OR shipping_fee BETWEEN 0 AND ${MAXIMUM_PRICE_YEN}),
    order_deadline TEXT CHECK (
      order_deadline IS NULL
      OR (order_deadline GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND date(order_deadline) = order_deadline)
    ),
    url TEXT CHECK (url IS NULL OR url GLOB 'http://*' OR url GLOB 'https://*'),
    category TEXT CHECK (category IS NULL OR length(category) BETWEEN 1 AND ${MAXIMUM_CATEGORY_NAME_LENGTH}),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE product_history (
    id INTEGER PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    changed_at TEXT NOT NULL,
    change_kind TEXT NOT NULL CHECK (change_kind IN ('user', 'automatic')),
    field TEXT NOT NULL CHECK (field IN ('status', 'release_month')),
    value_before TEXT,
    value_after TEXT NOT NULL
  ) STRICT;

  CREATE INDEX product_history_by_product ON product_history (product_id, id);
  `,
  // 版数 2: 延期の確認を待っている商品（issue #9）。商品を削除したら一緒に消す
  `
  CREATE TABLE delivery_confirmations (
    product_id TEXT PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE
  ) STRICT;
  `,
  // 版数 3: 商品のメーカーと備考（issue #18）。既存の商品は未入力（NULL）になる
  `
  ALTER TABLE products ADD COLUMN maker TEXT CHECK (maker IS NULL OR length(maker) BETWEEN 1 AND ${MAXIMUM_MAKER_LENGTH});
  ALTER TABLE products ADD COLUMN note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND ${MAXIMUM_NOTE_LENGTH});
  `,
  // 版数 4: カテゴリーの ID（issue #10）。category は「設定したときのカテゴリー名」として使い続ける。
  // 版数 3 までに名前だけを持つ商品は、ID を「legacy:名前」にする（定義にないカテゴリーとして確認できるようにするため）。
  // ID と名前は両方あるか両方ないかのどちらか。ADD COLUMN の CHECK は既存の行にも適用されるため、
  // 既存の行を整えた後に、この決まりをトリガーで付ける
  `
  ALTER TABLE products ADD COLUMN category_id TEXT CHECK (
    category_id IS NULL OR length(category_id) BETWEEN 1 AND ${MAXIMUM_CATEGORY_ID_LENGTH}
  );
  UPDATE products SET category_id = 'legacy:' || category WHERE category IS NOT NULL;
  CREATE TRIGGER products_category_pair_on_insert BEFORE INSERT ON products
    WHEN (NEW.category_id IS NULL) <> (NEW.category IS NULL)
    BEGIN SELECT RAISE(ABORT, 'category_id と category は両方あるか両方ないかのどちらかにする'); END;
  CREATE TRIGGER products_category_pair_on_update BEFORE UPDATE ON products
    WHEN (NEW.category_id IS NULL) <> (NEW.category IS NULL)
    BEGIN SELECT RAISE(ABORT, 'category_id と category は両方あるか両方ないかのどちらかにする'); END;
  `,
];

/** 最新のスキーマの版数。 */
export const LATEST_SCHEMA_VERSION = SCHEMA_MIGRATIONS.length;

/** 変更履歴の項目名（ドメイン ↔ DB の列名）。 */
const HISTORY_FIELD_COLUMN: Readonly<Record<ProductHistoryField, string>> = {
  status: 'status',
  releaseMonth: 'release_month',
};

/** 商品の保存の操作。 */
export type ProductRepository = {
  /** 商品を登録し、登録時のステータスと発売月を最初の変更履歴として記録する。 */
  insertProduct(product: Product): void;
  /** ID で商品を取得する。存在しなければ undefined。 */
  findProductById(productId: ProductId): Product | undefined;
  /** すべての商品を登録順に返す。 */
  listProducts(): Product[];
  /**
   * 商品を更新する。ステータス・発売月が変わった場合は変更履歴に記録する（ステータス → 発売月の順）。
   * @returns 更新した場合は true、商品が存在しない場合は false
   */
  updateProduct(product: Product, change: ProductChange): boolean;
  /**
   * 商品とその変更履歴を削除する。
   * @returns 削除した場合は true、商品が存在しない場合は false
   */
  deleteProduct(productId: ProductId): boolean;
  /** 商品の変更履歴を古い順に返す。 */
  listProductHistory(productId: ProductId): ProductHistoryEntry[];
  /** 商品に延期の確認待ちの印を付ける。付いていれば何もしない。 */
  markDeliveryConfirmationPending(productId: ProductId): void;
  /** 商品の延期の確認待ちの印を外す。付いていなければ何もしない。 */
  clearDeliveryConfirmationPending(productId: ProductId): void;
  /** 延期の確認待ちの商品の ID を返す。 */
  listDeliveryConfirmationPendingProductIds(): ProductId[];
  /**
   * 複数の操作を 1 つのトランザクションで行う。例外が起きたらすべて元に戻す。
   * 中で呼んだ操作が自分のトランザクションを始めることはない（入れ子にしない）。
   */
  runInTransaction<Result>(operation: () => Result): Result;
  /**
   * そのカテゴリーの商品に保存しているカテゴリー名を変える（改名に追従する。issue #10）。更新日時は変えない。
   * @returns 変えた商品の数
   */
  renameCategoryOfProducts(categoryId: string, categoryName: string): number;
  /**
   * そのカテゴリーのすべての商品を、移す先のカテゴリー（null ならカテゴリー未設定）にする（issue #10）。
   * 変更履歴（ステータス・発売月）には記録しない。
   * @param destination 移す先の ID と名前。null ならカテゴリー未設定
   * @param updatedAt 移した商品の更新日時
   * @returns 移した商品の数
   */
  reassignCategoryOfProducts(
    categoryId: string,
    destination: { readonly categoryId: string; readonly categoryName: string } | null,
    updatedAt: string,
  ): number;
  /** そのカテゴリーの商品に保存しているカテゴリー名（最後に更新した商品のもの）。商品がなければ undefined（issue #10）。 */
  findCategoryNameOfProducts(categoryId: string): string | undefined;
};

const productRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  release_month: z.string(),
  status: productStatusSchema,
  cancelable: z.union([z.literal(0), z.literal(1)]),
  price: z.number().int().nullable(),
  shipping_fee: z.number().int().nullable(),
  order_deadline: z.string().nullable(),
  url: z.string().nullable(),
  category: z.string().nullable(),
  category_id: z.string().nullable(),
  maker: z.string().nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const historyRowSchema = z.object({
  changed_at: z.string(),
  change_kind: z.enum(['user', 'automatic']),
  field: z.enum(['status', 'release_month']),
  value_before: z.string().nullable(),
  value_after: z.string(),
});

/** DB の行を検証して商品に変換する。 */
function convertRowToProduct(row: unknown): Product {
  const parsedRow = productRowSchema.parse(row);
  return {
    id: parsedRow.id as ProductId,
    name: parsedRow.name,
    releaseMonth: parsedRow.release_month,
    status: parsedRow.status,
    cancelable: parsedRow.cancelable === 1,
    price: parsedRow.price,
    shippingFee: parsedRow.shipping_fee,
    orderDeadline: parsedRow.order_deadline,
    url: parsedRow.url,
    categoryId: parsedRow.category_id,
    categoryName: parsedRow.category,
    maker: parsedRow.maker,
    note: parsedRow.note,
    createdAt: parsedRow.created_at,
    updatedAt: parsedRow.updated_at,
  };
}

/** DB の行を検証して変更履歴に変換する。 */
function convertRowToHistoryEntry(row: unknown): ProductHistoryEntry {
  const parsedRow = historyRowSchema.parse(row);
  return {
    changedAt: parsedRow.changed_at,
    changeKind: parsedRow.change_kind,
    field: parsedRow.field === 'release_month' ? 'releaseMonth' : 'status',
    valueBefore: parsedRow.value_before,
    valueAfter: parsedRow.value_after,
  };
}

/** 処理をトランザクションの中で行い、例外が起きたら元に戻す。すでにトランザクションの中なら、そのまま行う。 */
function runInTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
  if (database.isTransaction) return operation();
  database.exec('BEGIN');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** スキーマを最新の版数に移行する。 */
function migrateSchema(database: DatabaseSync): void {
  const versionRow = z.object({ user_version: z.number().int() }).parse(database.prepare('PRAGMA user_version').get());
  const currentVersion = versionRow.user_version;
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `DB のスキーマの版数（${currentVersion}）が、このアプリの版数（${LATEST_SCHEMA_VERSION}）より新しいため開けません。アプリを更新してください。`,
    );
  }
  for (let version = currentVersion; version < LATEST_SCHEMA_VERSION; version += 1) {
    const migration = SCHEMA_MIGRATIONS[version] ?? '';
    runInTransaction(database, () => {
      database.exec(migration);
      database.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/**
 * 商品の DB を開き、スキーマを最新の版数に移行する。
 * DB ファイルがなければ、所有者だけが読み書きできる（0600）ファイルとして作成する。
 * @param databaseFilePath DB ファイルの場所。テストでは ':memory:' を指定できる
 * @throws {Error} DB のスキーマの版数がアプリより新しい場合
 */
export function openProductDatabase(databaseFilePath: string): DatabaseSync {
  if (databaseFilePath !== ':memory:' && !existsSync(databaseFilePath)) {
    writeFileSync(databaseFilePath, '', { mode: 0o600, flag: 'wx' });
  }
  const database = new DatabaseSync(databaseFilePath);
  // 商品を削除したときに変更履歴も削除する（ON DELETE CASCADE）ため、外部キーを有効にする
  database.exec('PRAGMA foreign_keys = ON');
  migrateSchema(database);
  return database;
}

/**
 * SQLite を使う商品の保存の操作を作る。
 * @param database openProductDatabase で開いた DB
 */
export function createSqliteProductRepository(database: DatabaseSync): ProductRepository {
  const insertHistoryStatement = database.prepare(
    `INSERT INTO product_history (product_id, changed_at, change_kind, field, value_before, value_after)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const recordHistory = (
    productId: ProductId,
    change: ProductChange,
    field: ProductHistoryField,
    valueBefore: string | null,
    valueAfter: string,
  ): void => {
    insertHistoryStatement.run(productId, change.changedAt, change.changeKind, HISTORY_FIELD_COLUMN[field], valueBefore, valueAfter);
  };

  const findProductById = (productId: ProductId): Product | undefined => {
    const row = database.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    return row === undefined ? undefined : convertRowToProduct(row);
  };

  return {
    insertProduct(product) {
      runInTransaction(database, () => {
        database
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
        const registration: ProductChange = { changedAt: product.createdAt, changeKind: 'user' };
        recordHistory(product.id, registration, 'status', null, product.status);
        recordHistory(product.id, registration, 'releaseMonth', null, product.releaseMonth);
      });
    },

    findProductById,

    listProducts() {
      return database.prepare('SELECT * FROM products ORDER BY created_at, rowid').all().map(convertRowToProduct);
    },

    updateProduct(product, change) {
      return runInTransaction(database, () => {
        const current = findProductById(product.id);
        if (current === undefined) return false;
        database
          .prepare(
            `UPDATE products
             SET name = ?, release_month = ?, status = ?, cancelable = ?, price = ?, shipping_fee = ?,
                 order_deadline = ?, url = ?, category_id = ?, category = ?, maker = ?, note = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
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
            product.updatedAt,
            product.id,
          );
        if (current.status !== product.status) recordHistory(product.id, change, 'status', current.status, product.status);
        if (current.releaseMonth !== product.releaseMonth) {
          recordHistory(product.id, change, 'releaseMonth', current.releaseMonth, product.releaseMonth);
        }
        return true;
      });
    },

    deleteProduct(productId) {
      const result = database.prepare('DELETE FROM products WHERE id = ?').run(productId);
      return Number(result.changes) > 0;
    },

    listProductHistory(productId) {
      return database
        .prepare(
          `SELECT changed_at, change_kind, field, value_before, value_after
           FROM product_history WHERE product_id = ? ORDER BY id`,
        )
        .all(productId)
        .map(convertRowToHistoryEntry);
    },

    markDeliveryConfirmationPending(productId) {
      database.prepare('INSERT OR IGNORE INTO delivery_confirmations (product_id) VALUES (?)').run(productId);
    },

    clearDeliveryConfirmationPending(productId) {
      database.prepare('DELETE FROM delivery_confirmations WHERE product_id = ?').run(productId);
    },

    listDeliveryConfirmationPendingProductIds() {
      return database
        .prepare('SELECT product_id FROM delivery_confirmations ORDER BY rowid')
        .all()
        .map((row) => z.object({ product_id: z.string() }).parse(row).product_id as ProductId);
    },

    runInTransaction(operation) {
      return runInTransaction(database, operation);
    },

    renameCategoryOfProducts(categoryId, categoryName) {
      const result = database.prepare('UPDATE products SET category = ? WHERE category_id = ?').run(categoryName, categoryId);
      return Number(result.changes);
    },

    reassignCategoryOfProducts(categoryId, destination, updatedAt) {
      const result = database
        .prepare('UPDATE products SET category_id = ?, category = ?, updated_at = ? WHERE category_id = ?')
        .run(destination?.categoryId ?? null, destination?.categoryName ?? null, updatedAt, categoryId);
      return Number(result.changes);
    },

    findCategoryNameOfProducts(categoryId) {
      const row = database
        .prepare('SELECT category FROM products WHERE category_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1')
        .get(categoryId);
      return row === undefined ? undefined : z.object({ category: z.string() }).parse(row).category;
    },
  };
}
