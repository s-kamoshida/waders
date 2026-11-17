/**
 * 商品の操作（登録・編集・削除・一覧）。
 *
 * 所属: アプリケーション層
 * 責務: 検証済みの入力から商品を作り・更新し、保存する。日時は Clock から、ID は生成関数から受け取る。
 * 利用者の操作による変更は、変更履歴に「利用者の操作」として記録する。
 */
import { ProductNotFoundError, type Product, type ProductId } from '../domain/product.ts';
import type { ProductRepository } from '../infrastructure/sqliteProductRepository.ts';
import type { ProductInput } from '../../shared/productContract.ts';

/** 現在時刻を返す（テストで時刻を固定するため、直接 new Date() を呼ばない）。 */
export type Clock = { now(): Date };

/** 商品の操作。 */
export type ProductService = {
  /** すべての商品を登録順に返す。 */
  listProducts(): Product[];
  /** 商品を登録し、登録した商品を返す。 */
  createProduct(input: ProductInput): Product;
  /**
   * 商品を入力の値で更新し、更新した商品を返す。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   */
  updateProduct(productId: ProductId, input: ProductInput): Product;
  /**
   * 商品を削除する。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   */
  deleteProduct(productId: ProductId): void;
};

/** createProductService の依存。 */
export type ProductServiceDependencies = {
  readonly productRepository: ProductRepository;
  readonly clock: Clock;
  readonly generateProductId: () => ProductId;
};

/** 商品の操作を作る。 */
export function createProductService(dependencies: ProductServiceDependencies): ProductService {
  const { productRepository, clock, generateProductId } = dependencies;

  return {
    listProducts() {
      return productRepository.listProducts();
    },

    createProduct(input) {
      const now = clock.now().toISOString();
      const product: Product = { id: generateProductId(), ...input, createdAt: now, updatedAt: now };
      productRepository.insertProduct(product);
      return product;
    },

    updateProduct(productId, input) {
      const current = productRepository.findProductById(productId);
      if (current === undefined) throw new ProductNotFoundError(productId);
      const now = clock.now().toISOString();
      const updated: Product = { ...current, ...input, updatedAt: now };
      productRepository.updateProduct(updated, { changedAt: now, changeKind: 'user' });
      return updated;
    },

    deleteProduct(productId) {
      if (!productRepository.deleteProduct(productId)) throw new ProductNotFoundError(productId);
    },
  };
}
