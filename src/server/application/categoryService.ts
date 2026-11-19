/**
 * カテゴリーの操作（一覧・追加）。
 *
 * 所属: アプリケーション層
 * 責務: カテゴリーの定義のファイルから、定義の並び順でカテゴリーを返し、新しいカテゴリーを末尾に加える（issue #10）。
 * 商品の更新を伴う改名・削除・定義にないカテゴリーの扱いは、商品の操作（productService.ts）が行う
 * （商品の保存と定義のファイルの変更を、1 つのトランザクションの中でそろえるため）。
 */
import type { Category } from '../domain/category.ts';
import type { CategoryDefinition } from '../infrastructure/categoryDefinitionFile.ts';

/** カテゴリーの操作。 */
export type CategoryService = {
  /**
   * 定義の並び順でカテゴリーを返す。
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  listCategories(): Category[];
  /**
   * 最新の定義の末尾にカテゴリーを加え、加えたカテゴリーを返す。
   * @param name カテゴリー名（検証済み）
   * @throws {CategoryNameDuplicateError} 同じ名前のカテゴリーがある場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  addCategory(name: string): Category;
};

/** createCategoryService の依存。 */
export type CategoryServiceDependencies = {
  readonly categoryDefinition: CategoryDefinition;
};

/** カテゴリーの操作を作る。 */
export function createCategoryService(dependencies: CategoryServiceDependencies): CategoryService {
  const { categoryDefinition } = dependencies;
  return {
    listCategories() {
      return categoryDefinition.readCategories();
    },

    addCategory(name) {
      return categoryDefinition.addCategory(name);
    },
  };
}
