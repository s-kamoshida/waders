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
 * 商品の画像（issue #41）は、大きさと中身の形式を確かめてからファイルに保存し、ファイルの名前を DB に記録する。
 * 画像を付ける・消すことは商品の更新ではないため、更新日時と変更履歴は変えない。差し替え・削除・商品の削除では前のファイルを消す。
 * カード画像（issue #42）は、購入先の URL がある商品を保存したときに裏で取りに行き（保存の応答は待たせない）、
 * アップロードした画像とは別に保存する。表示する画像は、アップロードした画像があればそれ、なければカード画像。
 * 取りに行くのは URL を入れた・変えたときと、まだカード画像がないとき。URL を消した・変えたときは前のカード画像を消す。
 * 取りに行っている間に URL が変わった・商品が消えた・新しく取りに行った場合は、前の結果を使わない。
 * 保存の前のプレビュー（issue #51）では、同じ取得の処理でカード画像を取り、大きさと中身の形式を確かめて返す（保存はしない）。
 * 表示する画像の種類（アップロードした画像かカード画像か）も返す（issue #51）。
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
import {
  MAXIMUM_PRODUCT_IMAGE_BYTES,
  ProductImageTooLargeError,
  UnsupportedProductImageError,
  detectProductImageFormat,
  type ProductImageFormat,
} from '../domain/productImage.ts';
import type { CategoryDefinition } from '../infrastructure/categoryDefinitionFile.ts';
import { createProductImageStorage } from '../infrastructure/productImageStorage.ts';
import type { ProductRepository } from '../infrastructure/sqliteProductRepository.ts';
import type { DeliveryConfirmationRequest, ProductImageKind, ProductInput, StatusChangeRequest } from '../../shared/productContract.ts';

/** 現在時刻を返す（テストで時刻を固定するため、直接 new Date() を呼ばない）。 */
export type Clock = { now(): Date };

/** 一覧の商品。延期の確認を待っているか、カード画像を取りに行っているか（issue #42）を含む。 */
export type ListedProduct = Product & { readonly deliveryConfirmationPending: boolean; readonly cardImagePending: boolean };

/** 商品の画像の中身と形式（issue #41）。 */
export type ProductImage = { readonly bytes: Uint8Array; readonly format: ProductImageFormat };

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
   * 商品を削除する。画像を付けていれば、そのファイルも消す。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   */
  deleteProduct(productId: ProductId): void;
  /**
   * 商品に画像を付ける（差し替える）。前の画像のファイルは消す。更新日時と変更履歴は変えない（issue #41）。
   * @param bytes 画像の中身（形式は中身で判定する）
   * @returns 画像を付けた商品
   * @throws {ProductImageTooLargeError} 画像が大きさの上限を超えている場合
   * @throws {UnsupportedProductImageError} 中身が受け付ける形式（JPEG・PNG・WebP）でない場合
   * @throws {ProductNotFoundError} 商品が存在しない場合
   */
  saveProductImage(productId: ProductId, bytes: Uint8Array): Product;
  /**
   * 商品の画像を消す。画像がなければ何もしない（issue #41）。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   */
  deleteProductImage(productId: ProductId): void;
  /** 表示する画像（アップロードした画像、なければカード画像）を読む。商品か画像がなければ undefined（issue #41・#42）。 */
  readProductImage(productId: ProductId): ProductImage | undefined;
  /** 表示する画像の版（画像が変わるたびに変わる値）。画像がなければ null（issue #41・#42）。 */
  findProductImageVersion(productId: ProductId): string | null;
  /** 表示する画像のある商品の ID と、その画像の版（issue #41・#42）。 */
  listProductImageVersions(): Map<ProductId, string>;
  /** 表示する画像の種類（アップロードした画像があれば uploaded、なければカード画像の card）。画像がなければ null（issue #51）。 */
  findProductImageKind(productId: ProductId): ProductImageKind | null;
  /** 表示する画像のある商品の ID と、その画像の種類（issue #51）。 */
  listProductImageKinds(): Map<ProductId, ProductImageKind>;
  /**
   * 保存の前のプレビューのために、購入先のページのカード画像を取る。保存はしない（issue #51）。
   * 取得先の検証は、保存の後の取得と同じ処理（fetchCardImage）が行う。
   * @param pageUrl 検証済みの購入先の URL
   * @returns 取った画像（形式は中身で判定）。取れない・失敗した・大きさの上限を超えた・受け付けない形式の場合は null
   */
  previewCardImage(pageUrl: string): Promise<ProductImage | null>;
  /** 裏で取りに行っているカード画像の取得が、すべて終わるのを待つ（テスト・終了の前に使う。issue #42）。 */
  waitForPendingCardImageFetches(): Promise<void>;
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
   * ステータスだけを変える（詳細画面のプルダウン。issue #52、BR-37）。アーカイブされた商品も変えられる。
   * キャンセル可否は指定したときだけ変える。ステータスもキャンセル可否も今と同じなら、何もせずに今の商品を返す（履歴も記録しない）。
   * 変更は利用者の操作として変更履歴に記録する（ステータスが変わった場合）。
   * @throws {ProductNotFoundError} 商品が存在しない場合
   */
  changeProductStatus(productId: ProductId, change: StatusChangeRequest): Product;
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
  /** 商品の画像を保存するフォルダ（なければ最初の保存のときに作る。issue #41）。 */
  readonly productImageDirectory: string;
  /** 購入先のページのカード画像を取りに行く。取れなければ null（issue #42）。 */
  readonly fetchCardImage: (pageUrl: string) => Promise<ProductImage | null>;
  /** カード画像の保存などで想定外のエラーが起きたときに知らせる（ログに出す）。省略すると何もしない（issue #42）。 */
  readonly reportCardImageError?: (error: unknown) => void;
};

/** 画像のファイルの名前から、画像の版（拡張子を除いた乱数の部分）を求める。 */
function toImageVersion(fileName: string): string {
  return fileName.replace(/\.[a-z]+$/, '');
}

/** 商品の操作を作る。 */
export function createProductService(dependencies: ProductServiceDependencies): ProductService {
  const { productRepository, clock, generateProductId, categoryDefinition } = dependencies;
  const productImageStorage = createProductImageStorage({ directory: dependencies.productImageDirectory });

  /** 取りに行っているカード画像の、商品ごとの取得の番号（新しく取りに行ったら、前の取得の結果は使わない。issue #42）。 */
  const cardImageFetchNumbers = new Map<ProductId, number>();
  let lastCardImageFetchNumber = 0;
  const runningCardImageFetches = new Set<Promise<void>>();

  /** 表示する画像のファイルの名前（アップロードした画像、なければカード画像）。 */
  const findDisplayedImageFileName = (productId: ProductId): string | null => {
    return productRepository.findUploadedImageFileName(productId) ?? productRepository.findCardImageFileName(productId) ?? null;
  };

  /** カード画像を消し、取りに行っている結果も使わないようにする。 */
  const deleteCardImage = (productId: ProductId): void => {
    cardImageFetchNumbers.delete(productId);
    const fileName = productRepository.findCardImageFileName(productId);
    if (fileName === null || fileName === undefined) return;
    productRepository.setCardImageFileName(productId, null);
    productImageStorage.deleteImage(fileName);
  };

  /** 取ったカード画像を保存する。新しく取りに行った・URL が変わった・商品が消えた場合や、上限・形式に合わない場合は保存しない。 */
  const storeCardImage = (productId: ProductId, pageUrl: string, fetchNumber: number, cardImage: ProductImage | null): void => {
    if (cardImageFetchNumbers.get(productId) !== fetchNumber) return;
    cardImageFetchNumbers.delete(productId);
    if (cardImage === null || cardImage.bytes.byteLength > MAXIMUM_PRODUCT_IMAGE_BYTES) return;
    const format = detectProductImageFormat(cardImage.bytes);
    if (format === null || productRepository.findProductById(productId)?.url !== pageUrl) return;
    const previousFileName = productRepository.findCardImageFileName(productId);
    const fileName = productImageStorage.saveImage(cardImage.bytes, format);
    productRepository.setCardImageFileName(productId, fileName);
    if (previousFileName !== null && previousFileName !== undefined) productImageStorage.deleteImage(previousFileName);
  };

  /** カード画像を裏で取りに行く。取れなかった・失敗した場合も、商品の保存には影響させない。 */
  const startCardImageFetch = (productId: ProductId, pageUrl: string): void => {
    lastCardImageFetchNumber += 1;
    const fetchNumber = lastCardImageFetchNumber;
    cardImageFetchNumbers.set(productId, fetchNumber);
    const running = Promise.resolve()
      .then(() => dependencies.fetchCardImage(pageUrl))
      .catch(() => null)
      .then((cardImage) => storeCardImage(productId, pageUrl, fetchNumber, cardImage))
      .catch((error: unknown) => {
        if (cardImageFetchNumbers.get(productId) === fetchNumber) cardImageFetchNumbers.delete(productId);
        dependencies.reportCardImageError?.(error);
      })
      .finally(() => runningCardImageFetches.delete(running));
    runningCardImageFetches.add(running);
  };

  /**
   * 保存した商品の URL に合わせて、カード画像を取りに行く・消す。
   * @param previousUrl 保存する前の URL（登録では null）
   */
  const refreshCardImage = (productId: ProductId, previousUrl: string | null, currentUrl: string | null): void => {
    if (currentUrl === null || currentUrl !== previousUrl) deleteCardImage(productId);
    if (currentUrl === null) return;
    const hasCardImageOrFetch = cardImageFetchNumbers.has(productId) || productRepository.findCardImageFileName(productId) !== null;
    if (currentUrl === previousUrl && hasCardImageOrFetch) return;
    startCardImageFetch(productId, currentUrl);
  };

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
        cardImagePending: cardImageFetchNumbers.has(product.id),
      }));
    },

    applyAutomaticTransitions,

    createProduct(input) {
      const now = clock.now().toISOString();
      const product: Product = { id: generateProductId(), ...input, ...resolveCategory(input.categoryId), createdAt: now, updatedAt: now };
      productRepository.insertProduct(product);
      refreshCardImage(product.id, null, product.url);
      return product;
    },

    updateProduct(productId, input) {
      const current = findProductOrThrow(productId);
      const currentTime = clock.now();
      if (isProductArchived(current, currentTime) && input.releaseMonth !== current.releaseMonth) {
        throw new ArchivedReleaseMonthChangeError(productId);
      }
      const category = resolveCategory(input.categoryId, current);
      const updated = productRepository.runInTransaction(() => {
        if (input.status !== current.status) productRepository.clearDeliveryConfirmationPending(productId);
        return updateByUser(current, { ...input, ...category }, currentTime);
      });
      refreshCardImage(productId, current.url, updated.url);
      return updated;
    },

    deleteProduct(productId) {
      const imageFileNames = [productRepository.findUploadedImageFileName(productId), productRepository.findCardImageFileName(productId)];
      if (!productRepository.deleteProduct(productId)) throw new ProductNotFoundError(productId);
      cardImageFetchNumbers.delete(productId);
      for (const fileName of imageFileNames) {
        if (fileName !== null && fileName !== undefined) productImageStorage.deleteImage(fileName);
      }
    },

    saveProductImage(productId, bytes) {
      if (bytes.byteLength > MAXIMUM_PRODUCT_IMAGE_BYTES) throw new ProductImageTooLargeError(bytes.byteLength);
      const format = detectProductImageFormat(bytes);
      if (format === null) throw new UnsupportedProductImageError();
      const previousFileName = productRepository.findUploadedImageFileName(productId);
      if (previousFileName === undefined) throw new ProductNotFoundError(productId);
      const fileName = productImageStorage.saveImage(bytes, format);
      if (!productRepository.setUploadedImageFileName(productId, fileName)) {
        // 保存の間に商品が削除された場合は、保存したファイルを残さない
        productImageStorage.deleteImage(fileName);
        throw new ProductNotFoundError(productId);
      }
      if (previousFileName !== null) productImageStorage.deleteImage(previousFileName);
      return findProductOrThrow(productId);
    },

    deleteProductImage(productId) {
      const fileName = productRepository.findUploadedImageFileName(productId);
      if (fileName === undefined) throw new ProductNotFoundError(productId);
      if (fileName === null) return;
      productRepository.setUploadedImageFileName(productId, null);
      productImageStorage.deleteImage(fileName);
    },

    readProductImage(productId) {
      const fileName = findDisplayedImageFileName(productId);
      return fileName === null ? undefined : productImageStorage.readImage(fileName);
    },

    findProductImageVersion(productId) {
      const fileName = findDisplayedImageFileName(productId);
      return fileName === null ? null : toImageVersion(fileName);
    },

    listProductImageVersions() {
      // カード画像を先に入れ、アップロードした画像で上書きする（アップロードした画像を優先する）
      const fileNames = new Map([...productRepository.listCardImageFileNames(), ...productRepository.listUploadedImageFileNames()]);
      return new Map([...fileNames].map(([productId, fileName]) => [productId, toImageVersion(fileName)]));
    },

    findProductImageKind(productId) {
      if ((productRepository.findUploadedImageFileName(productId) ?? null) !== null) return 'uploaded';
      return (productRepository.findCardImageFileName(productId) ?? null) !== null ? 'card' : null;
    },

    listProductImageKinds() {
      const kinds = new Map<ProductId, ProductImageKind>();
      for (const productId of productRepository.listCardImageFileNames().keys()) kinds.set(productId, 'card');
      for (const productId of productRepository.listUploadedImageFileNames().keys()) kinds.set(productId, 'uploaded');
      return kinds;
    },

    async previewCardImage(pageUrl) {
      const cardImage = await Promise.resolve()
        .then(() => dependencies.fetchCardImage(pageUrl))
        .catch(() => null);
      if (cardImage === null || cardImage.bytes.byteLength > MAXIMUM_PRODUCT_IMAGE_BYTES) return null;
      const format = detectProductImageFormat(cardImage.bytes);
      return format === null ? null : { bytes: cardImage.bytes, format };
    },

    async waitForPendingCardImageFetches() {
      while (runningCardImageFetches.size > 0) await Promise.all(runningCardImageFetches);
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

    changeProductStatus(productId, change) {
      const current = findProductOrThrow(productId);
      const cancelable = change.cancelable ?? current.cancelable;
      if (change.status === current.status && cancelable === current.cancelable) return current;
      return updateByUser(current, { status: change.status, cancelable }, clock.now());
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
