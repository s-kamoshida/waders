/**
 * カテゴリーの操作（一覧）。
 *
 * 所属: アプリケーション層
 * 責務: カテゴリーの定義のファイルから、定義の並び順でカテゴリーを返す（issue #10）。
 * 追加・改名・削除は #10 の 2 つ目の PR で加える。
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
  };
}
