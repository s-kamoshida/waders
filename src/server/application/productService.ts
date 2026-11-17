/**
 * 商品の操作（登録・編集・削除・一覧・自動遷移・リストに戻す・延期の確認への回答）。
 *
 * 所属: アプリケーション層
 * 責務: 検証済みの入力から商品を作り・更新し、保存する。日時は Clock から、ID は生成関数から受け取る。
 * 利用者の操作による変更は「利用者の操作」、ステータスの自動遷移は「自動遷移」として変更履歴に記録する。
 * 自動遷移は、一覧を取得するたびと、サーバーの起動時（applyAutomaticTransitions）に行う（issue #9）。
 */
import {
  ArchivedReleaseMonthChangeError,
  DeliveryConfirmationNotPendingError,
  ProductNotArchivedError,
  ProductNotFoundError,
  RestoreReleaseMonthInPastError,
  type Product,
  type ProductChange,
  type ProductId,
} from '../domain/product.ts';
import {
  determineAutomaticTransition,
  determineStatusBeforeAutomaticTransition,
  isProductArchived,
} from '../domain/productStatusTransition.ts';
import type { ProductRepository } from '../infrastructure/sqliteProductRepository.ts';
import type { DeliveryConfirmationRequest, ProductInput } from '../../shared/productContract.ts';

/** 現在時刻を返す（テストで時刻を固定するため、直接 new Date() を呼ばない）。 */
export type Clock = { now(): Date };

/** 一覧の商品。延期の確認を待っているかを含む。 */
export type ListedProduct = Product & { readonly deliveryConfirmationPending: boolean };

/** 商品の操作。 */
export type ProductService = {
  /** ステータスの自動遷移を反映してから、すべての商品を登録順に返す。 */
  listProducts(): ListedProduct[];
  /**
   * ステータスの自動遷移だけを行う（サーバーの起動時など）。
   * @returns 自動遷移した商品の数
   */
  applyAutomaticTransitions(): number;
  /** 商品を登録し、登録した商品を返す。 */
  createProduct(input: ProductInput): Product;
  /**
   * 商品を入力の値で更新し、更新した商品を返す。ステータスを変えた場合は延期の確認待ちを外す。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   * @throws {ArchivedReleaseMonthChangeError} アーカイブされた商品の発売月を変えようとした場合
   */
  updateProduct(productId: ProductId, input: ProductInput): Product;
  /**
   * 商品を削除する。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   */
  deleteProduct(productId: ProductId): void;
  /**
   * アーカイブされた商品をリストに戻す。ステータスは自動遷移の前に戻し、発売月を新しい月にし、延期の確認待ちを外す。
   * @param releaseMonth 新しい発売月（当月以降）
   * @throws {ProductNotFoundError} 商品が存在しない場合
   * @throws {ProductNotArchivedError} 商品がアーカイブされていない場合
   * @throws {RestoreReleaseMonthInPastError} 新しい発売月が当月より前の場合
   */
  restoreProduct(productId: ProductId, releaseMonth: string): Product;
  /**
   * 延期の確認に回答し、回答を反映した商品を返す。延期の確認待ちを外す。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   * @throws {DeliveryConfirmationNotPendingError} 延期の確認を待っていない場合
   * @throws {RestoreReleaseMonthInPastError} 「延期された」の新しい発売月が当月より前の場合
   */
  answerDeliveryConfirmation(productId: ProductId, answer: DeliveryConfirmationRequest): Product;
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

  const findProductOrThrow = (productId: ProductId): Product => {
    const product = productRepository.findProductById(productId);
    if (product === undefined) throw new ProductNotFoundError(productId);
    return product;
  };

  /** 利用者の操作として商品を更新する。 */
  const updateByUser = (current: Product, changes: Partial<Product>, currentTime: Date): Product => {
    const now = currentTime.toISOString();
    const updated: Product = { ...current, ...changes, updatedAt: now };
    productRepository.updateProduct(updated, { changedAt: now, changeKind: 'user' });
    return updated;
  };

  const applyAutomaticTransitions = (): number => {
    const currentTime = clock.now();
    const change: ProductChange = { changedAt: currentTime.toISOString(), changeKind: 'automatic' };
    let transitionedCount = 0;
    for (const product of productRepository.listProducts()) {
      const transition = determineAutomaticTransition(product, currentTime);
      if (transition === null) continue;
      productRepository.runInTransaction(() => {
        productRepository.updateProduct({ ...product, status: transition.status, updatedAt: change.changedAt }, change);
        if (transition.awaitsDeliveryConfirmation) productRepository.markDeliveryConfirmationPending(product.id);
      });
      transitionedCount += 1;
    }
    return transitionedCount;
  };

  return {
    listProducts() {
      applyAutomaticTransitions();
      const pendingProductIds = new Set(productRepository.listDeliveryConfirmationPendingProductIds());
      return productRepository
        .listProducts()
        .map((product) => ({ ...product, deliveryConfirmationPending: pendingProductIds.has(product.id) }));
    },

    applyAutomaticTransitions,

    createProduct(input) {
      const now = clock.now().toISOString();
      const product: Product = { id: generateProductId(), ...input, createdAt: now, updatedAt: now };
      productRepository.insertProduct(product);
      return product;
    },

    updateProduct(productId, input) {
      const current = findProductOrThrow(productId);
      const currentTime = clock.now();
      if (isProductArchived(current, currentTime) && input.releaseMonth !== current.releaseMonth) {
        throw new ArchivedReleaseMonthChangeError(productId);
      }
      return productRepository.runInTransaction(() => {
        if (input.status !== current.status) productRepository.clearDeliveryConfirmationPending(productId);
        return updateByUser(current, input, currentTime);
      });
    },

    deleteProduct(productId) {
      if (!productRepository.deleteProduct(productId)) throw new ProductNotFoundError(productId);
    },

    restoreProduct(productId, releaseMonth) {
      const current = findProductOrThrow(productId);
      const currentTime = clock.now();
      if (!isProductArchived(current, currentTime)) throw new ProductNotArchivedError(productId);
      if (isProductArchived({ releaseMonth }, currentTime)) throw new RestoreReleaseMonthInPastError(releaseMonth);
      const status = determineStatusBeforeAutomaticTransition(productRepository.listProductHistory(productId), current.status);
      return productRepository.runInTransaction(() => {
        productRepository.clearDeliveryConfirmationPending(productId);
        return updateByUser(current, { status, releaseMonth }, currentTime);
      });
    },

    answerDeliveryConfirmation(productId, answer) {
      const current = findProductOrThrow(productId);
      if (!productRepository.listDeliveryConfirmationPendingProductIds().includes(productId)) {
        throw new DeliveryConfirmationNotPendingError(productId);
      }
      const currentTime = clock.now();
      if (answer.answer === 'postponed' && isProductArchived({ releaseMonth: answer.releaseMonth }, currentTime)) {
        throw new RestoreReleaseMonthInPastError(answer.releaseMonth);
      }
      return productRepository.runInTransaction(() => {
        productRepository.clearDeliveryConfirmationPending(productId);
        if (answer.answer === 'arrived') return current;
        if (answer.answer === 'postponed') return updateByUser(current, { status: 'reserved', releaseMonth: answer.releaseMonth }, currentTime);
        return updateByUser(current, { status: 'unpurchased' }, currentTime);
      });
    },
  };
}
