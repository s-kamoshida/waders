/**
 * 商品の操作（登録・編集・削除・一覧・自動遷移・リストに戻す・延期の確認への回答）。
 *
 * 所属: アプリケーション層
 * 責務: 検証済みの入力から商品を作り・更新し、保存する。日時は Clock から、ID は生成関数から受け取る。
 * 利用者の操作による変更は「利用者の操作」、ステータスの自動遷移は「自動遷移」として変更履歴に記録する。
 * 自動遷移は、一覧を取得するたびと、サーバーの起動時（applyAutomaticTransitions）に行う（issue #9）。
 * カテゴリーは ID で持ち、設定したときの名前も保存する。指定した ID は定義のファイルで確かめる（issue #10）。
 * カテゴリーの改名・削除・定義にないカテゴリーの扱い（定義に戻す・付け替える）も、商品の更新を伴うためここで行う（issue #10）。
 * 商品の更新を先に行い、定義のファイルの書き込みをトランザクションの最後に行う（書き込みに失敗したら商品の更新を取り消す）。
 */
import {
  CategoryAlreadyDefinedError,
  CategoryDefinitionError,
  CategoryDestinationNotFoundError,
  CategoryNotFoundError,
  type Category,
} from '../domain/category.ts';
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
import type { CategoryDefinition } from '../infrastructure/categoryDefinitionFile.ts';
import type { ProductRepository } from '../infrastructure/sqliteProductRepository.ts';
import type { DeliveryConfirmationRequest, ProductInput } from '../../shared/productContract.ts';

/** 現在時刻を返す（テストで時刻を固定するため、直接 new Date() を呼ばない）。 */
export type Clock = { now(): Date };

/** 一覧の商品。延期の確認を待っているかを含む。 */
export type ListedProduct = Product & { readonly deliveryConfirmationPending: boolean };

/** 商品の操作。 */
export type ProductService = {
  /**
   * ステータスの自動遷移を反映してから、すべての商品を登録順に返す。
   * カテゴリー名は、定義にあれば今の名前、定義から消えている・定義が読めない場合は最後に保存した名前にする。
   */
  listProducts(): ListedProduct[];
  /**
   * ステータスの自動遷移だけを行う（サーバーの起動時など）。
   * @returns 自動遷移した商品の数
   */
  applyAutomaticTransitions(): number;
  /**
   * 商品を登録し、登録した商品を返す。
   * @throws {CategoryNotFoundError} 指定したカテゴリーが定義にない場合
   * @throws {CategoryDefinitionError} カテゴリーを指定し、定義のファイルに誤りがある場合
   */
  createProduct(input: ProductInput): Product;
  /**
   * 商品を入力の値で更新し、更新した商品を返す。ステータスを変えた場合は延期の確認待ちを外す。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   * @throws {ArchivedReleaseMonthChangeError} アーカイブされた商品の発売月を変えようとした場合
   * @throws {CategoryNotFoundError} カテゴリーを別のものに変え、それが定義にない場合
   * @throws {CategoryDefinitionError} カテゴリーを別のものに変え、定義のファイルに誤りがある場合
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
   * 発売月だけを変える（ドラッグアンドドロップ。issue #13）。今と同じ月なら何もせずに今の商品を返す。
   * 変更は利用者の操作として変更履歴に記録する。
   * @param releaseMonth 新しい発売月（当月以降）
   * @throws {ProductNotFoundError} 商品が存在しない場合
   * @throws {ArchivedReleaseMonthChangeError} アーカイブされた商品の場合
   * @throws {RestoreReleaseMonthInPastError} 新しい発売月が当月より前の場合
   */
  moveProductToReleaseMonth(productId: ProductId, releaseMonth: string): Product;
  /**
   * 延期の確認に回答し、回答を反映した商品を返す。延期の確認待ちを外す。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   * @throws {DeliveryConfirmationNotPendingError} 延期の確認を待っていない場合
   * @throws {RestoreReleaseMonthInPastError} 「延期された」の新しい発売月が当月より前の場合
   */
  answerDeliveryConfirmation(productId: ProductId, answer: DeliveryConfirmationRequest): Product;
  /**
   * 定義のカテゴリーを改名し、そのカテゴリーの商品に保存している名前も変える（issue #10）。
   * @param name 新しい名前（検証済み）
   * @throws {CategoryNotFoundError} カテゴリーが最新の定義にない場合
   * @throws {CategoryNameDuplicateError} ほかのカテゴリーと同じ名前の場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  renameCategory(categoryId: string, name: string): Category;
  /**
   * 定義からカテゴリーを削除する。そのカテゴリーの商品（アーカイブを含む）は、移す先のカテゴリーかカテゴリー未設定にする（issue #10）。
   * @param moveToCategoryId 移す先のカテゴリーの ID。null ならカテゴリー未設定
   * @throws {CategoryNotFoundError} 削除するカテゴリーが最新の定義にない場合
   * @throws {CategoryDestinationNotFoundError} 移す先が定義にない、または削除するカテゴリー自身の場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  deleteCategory(categoryId: string, moveToCategoryId: string | null): void;
  /**
   * 定義にないカテゴリーを、同じ ID と、商品に最後に保存した名前で定義の末尾に加える（issue #10）。
   * @throws {CategoryNotFoundError} そのカテゴリーの商品がない場合
   * @throws {CategoryAlreadyDefinedError} そのカテゴリーがすでに定義にある場合
   * @throws {CategoryNameDuplicateError} 定義に同じ名前のカテゴリーがある場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  addUndefinedCategoryToDefinition(categoryId: string): Category;
  /**
   * 定義にないカテゴリーのすべての商品を、移す先のカテゴリーかカテゴリー未設定にする（issue #10）。
   * @param moveToCategoryId 移す先のカテゴリーの ID。null ならカテゴリー未設定
   * @throws {CategoryNotFoundError} そのカテゴリーの商品がない場合
   * @throws {CategoryAlreadyDefinedError} そのカテゴリーが定義にある場合（削除で移す）
   * @throws {CategoryDestinationNotFoundError} 移す先が定義にない場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  reassignUndefinedCategoryProducts(categoryId: string, moveToCategoryId: string | null): void;
};

/** createProductService の依存。 */
export type ProductServiceDependencies = {
  readonly productRepository: ProductRepository;
  readonly clock: Clock;
  readonly generateProductId: () => ProductId;
  readonly categoryDefinition: CategoryDefinition;
};

/** 商品の操作を作る。 */
export function createProductService(dependencies: ProductServiceDependencies): ProductService {
  const { productRepository, clock, generateProductId, categoryDefinition } = dependencies;

  /**
   * 入力のカテゴリーの ID から、保存するカテゴリー（ID と名前）を求める。
   * 今のカテゴリーから変えない場合は、定義を読まずに今の名前のままにする（定義から消えた・定義が読めない場合も編集できるようにするため）。
   */
  const resolveCategory = (
    categoryId: string | null,
    current?: Pick<Product, 'categoryId' | 'categoryName'>,
  ): Pick<Product, 'categoryId' | 'categoryName'> => {
    if (categoryId === null) return { categoryId: null, categoryName: null };
    if (current !== undefined && current.categoryId === categoryId) return { categoryId: current.categoryId, categoryName: current.categoryName };
    const category = categoryDefinition.readCategories().find((candidate) => candidate.id === categoryId);
    if (category === undefined) throw new CategoryNotFoundError(categoryId);
    return { categoryId: category.id, categoryName: category.name };
  };

  /** 定義の今の名前を ID ごとに返す。定義が読めない場合は空（最後に保存した名前を使う）。 */
  const readCurrentCategoryNames = (): Map<string, string> => {
    try {
      return new Map(categoryDefinition.readCategories().map((category) => [category.id, category.name]));
    } catch (error) {
      if (error instanceof CategoryDefinitionError) return new Map();
      throw error;
    }
  };

  /**
   * 商品の移す先を、定義のカテゴリーから求める。null ならカテゴリー未設定。
   * @param sourceCategoryId 移す元のカテゴリー（移す先にはできない）
   */
  const resolveMoveDestination = (
    categories: readonly Category[],
    sourceCategoryId: string,
    moveToCategoryId: string | null,
  ): { categoryId: string; categoryName: string } | null => {
    if (moveToCategoryId === null) return null;
    const destination = categories.find((category) => category.id === moveToCategoryId);
    if (destination === undefined || destination.id === sourceCategoryId) throw new CategoryDestinationNotFoundError(moveToCategoryId);
    return { categoryId: destination.id, categoryName: destination.name };
  };

  /** 定義にないカテゴリーの、商品に保存した名前を返す。商品がなければ CategoryNotFoundError。 */
  const findUndefinedCategoryNameOrThrow = (categoryId: string): string => {
    const categoryName = productRepository.findCategoryNameOfProducts(categoryId);
    if (categoryName === undefined) throw new CategoryNotFoundError(categoryId);
    return categoryName;
  };

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
      const categoryNames = readCurrentCategoryNames();
      return productRepository.listProducts().map((product) => ({
        ...product,
        categoryName: product.categoryId === null ? null : (categoryNames.get(product.categoryId) ?? product.categoryName),
        deliveryConfirmationPending: pendingProductIds.has(product.id),
      }));
    },

    applyAutomaticTransitions,

    createProduct(input) {
      const now = clock.now().toISOString();
      const product: Product = { id: generateProductId(), ...input, ...resolveCategory(input.categoryId), createdAt: now, updatedAt: now };
      productRepository.insertProduct(product);
      return product;
    },

    updateProduct(productId, input) {
      const current = findProductOrThrow(productId);
      const currentTime = clock.now();
      if (isProductArchived(current, currentTime) && input.releaseMonth !== current.releaseMonth) {
        throw new ArchivedReleaseMonthChangeError(productId);
      }
      const category = resolveCategory(input.categoryId, current);
      return productRepository.runInTransaction(() => {
        if (input.status !== current.status) productRepository.clearDeliveryConfirmationPending(productId);
        return updateByUser(current, { ...input, ...category }, currentTime);
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

    moveProductToReleaseMonth(productId, releaseMonth) {
      const current = findProductOrThrow(productId);
      const currentTime = clock.now();
      if (isProductArchived(current, currentTime)) throw new ArchivedReleaseMonthChangeError(productId);
      if (releaseMonth === current.releaseMonth) return current;
      if (isProductArchived({ releaseMonth }, currentTime)) throw new RestoreReleaseMonthInPastError(releaseMonth);
      return updateByUser(current, { releaseMonth }, currentTime);
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

    renameCategory(categoryId, name) {
      return productRepository.runInTransaction(() => {
        productRepository.renameCategoryOfProducts(categoryId, name.trim());
        return categoryDefinition.renameCategory(categoryId, name);
      });
    },

    deleteCategory(categoryId, moveToCategoryId) {
      const categories = categoryDefinition.readCategories();
      if (!categories.some((category) => category.id === categoryId)) throw new CategoryNotFoundError(categoryId);
      const destination = resolveMoveDestination(categories, categoryId, moveToCategoryId);
      const now = clock.now().toISOString();
      productRepository.runInTransaction(() => {
        productRepository.reassignCategoryOfProducts(categoryId, destination, now);
        categoryDefinition.deleteCategory(categoryId);
      });
    },

    addUndefinedCategoryToDefinition(categoryId) {
      const categoryName = findUndefinedCategoryNameOrThrow(categoryId);
      return categoryDefinition.addCategory(categoryName, categoryId);
    },

    reassignUndefinedCategoryProducts(categoryId, moveToCategoryId) {
      findUndefinedCategoryNameOrThrow(categoryId);
      const categories = categoryDefinition.readCategories();
      if (categories.some((category) => category.id === categoryId)) throw new CategoryAlreadyDefinedError(categoryId);
      const destination = resolveMoveDestination(categories, categoryId, moveToCategoryId);
      productRepository.reassignCategoryOfProducts(categoryId, destination, clock.now().toISOString());
    },
  };
}
