/**
 * カテゴリーの定義のファイル（JSON）。
 *
 * 所属: インフラストラクチャ層
 * 責務:
 *  - データのフォルダに定義のファイルがなければ、リポジトリのひな形から作成する（所有者のみ読み書き可。既存のファイルは上書きしない）
 *  - 読み込むたびに Zod で検証する（手で編集されるため）。誤りがあれば CategoryDefinitionError にし、ファイルは書き換えない
 *  - ID のないカテゴリーに ID を付けて書き戻す。書き込みは一時ファイルに書いてから置き換える（途中で壊れないようにする）
 *  - カテゴリーの追加・改名・削除（issue #10）。変更する時点の最新のファイルを読み直して変更し、手で書かれたほかの項目は残す
 * ひな形は初回のコピー元にだけ使い、実行中に読み書きしない（CLAUDE.md「その他」）。
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { categoryIdSchema, categoryNameSchema } from '../../shared/categoryContract.ts';
import {
  CategoryAlreadyDefinedError,
  CategoryDefinitionError,
  CategoryNameDuplicateError,
  CategoryNotFoundError,
  type Category,
  type CategoryId,
} from '../domain/category.ts';

export { CategoryDefinitionError } from '../domain/category.ts';

/** リポジトリに含める定義のファイルのひな形の場所。 */
export const CATEGORY_TEMPLATE_FILE_PATH = resolve(import.meta.dirname, '../../../config/categories.example.json');

/** 定義のファイルの形式（version 1）。各カテゴリーの id は省略でき、省略されていればアプリが付ける。 */
const definitionFileSchema = z.object({
  version: z.literal(1),
  categories: z.array(z.object({ id: categoryIdSchema.optional(), name: categoryNameSchema })),
});

/** 書き戻すときに、手で書かれたほかの項目を残すため、元の JSON のまま扱うカテゴリーの項目。 */
type RawCategoryEntry = Record<string, unknown>;

/** カテゴリーの定義の操作。 */
export type CategoryDefinition = {
  /** 定義のファイルがなければ、ひな形から作成する（0600）。あれば何もしない。 */
  createFromTemplateIfMissing(): void;
  /**
   * 定義のファイルを読み、ファイルの並び順でカテゴリーを返す。ID のないカテゴリーには ID を付けて書き戻す。
   * @throws {CategoryDefinitionError} ファイルがない・JSON として読めない・形式に誤りがある（名前・ID の重複を含む）場合
   */
  readCategories(): Category[];
  /**
   * 最新の定義の末尾にカテゴリーを加え、加えたカテゴリーを返す。
   * @param name カテゴリー名（検証済み。前後の空白は除く）
   * @param categoryId 使う ID（定義にないカテゴリーを定義に戻す場合）。省略するとアプリが付ける
   * @throws {CategoryAlreadyDefinedError} 指定した ID がすでに定義にある場合
   * @throws {CategoryNameDuplicateError} 同じ名前のカテゴリーがある場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  addCategory(name: string, categoryId?: string): Category;
  /**
   * 最新の定義のカテゴリーの名前を変え、改名したカテゴリーを返す。ID・並び順・ほかの項目は変えない。
   * @throws {CategoryNotFoundError} カテゴリーが定義にない場合
   * @throws {CategoryNameDuplicateError} ほかのカテゴリーと同じ名前の場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  renameCategory(categoryId: string, name: string): Category;
  /**
   * 最新の定義からカテゴリーを取り除く。
   * @throws {CategoryNotFoundError} カテゴリーが定義にない場合
   * @throws {CategoryDefinitionError} 定義のファイルに誤りがある場合
   */
  deleteCategory(categoryId: string): void;
};

/** createCategoryDefinitionFile の引数。 */
export type CategoryDefinitionFileOptions = {
  /** 定義のファイルの場所（データのフォルダの categories.json）。 */
  readonly filePath: string;
  /** 定義のファイルがない場合に複製するひな形の場所。 */
  readonly templateFilePath: string;
  /** 新しいカテゴリーの ID を作る（1〜100 文字）。 */
  readonly generateCategoryId: () => string;
};

/** 誤りの理由を、ファイル名を含むメッセージにする。 */
function describeError(filePath: string, reason: string): string {
  return `カテゴリーの定義（${basename(filePath)}）に誤りがあります: ${reason}`;
}

/** Zod の誤りを「categories[1].name: 〜」の形にする。 */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '');
      return location === '' ? issue.message : `${location}: ${issue.message}`;
    })
    .join(' / ');
}

/** 名前・ID の重複を探し、あれば理由を返す。 */
function findDuplicate(categories: readonly { id?: string; name: string }[]): string | null {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const category of categories) {
    if (names.has(category.name)) return `カテゴリー名「${category.name}」が重複しています`;
    names.add(category.name);
    if (category.id === undefined) continue;
    if (ids.has(category.id)) return `ID「${category.id}」が重複しています`;
    ids.add(category.id);
  }
  return null;
}

/**
 * 内容を一時ファイルに書いてから置き換える（所有者のみ読み書き可）。
 * 置き換えは同じフォルダの中で行うため、途中で止まっても元のファイルか新しいファイルのどちらかが残る。
 */
function writeFileAtomically(filePath: string, content: string): void {
  const temporaryFilePath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryFilePath, content, { mode: 0o600, flag: 'wx' });
    renameSync(temporaryFilePath, filePath);
  } catch (error) {
    rmSync(temporaryFilePath, { force: true });
    throw error;
  }
}

/**
 * カテゴリーの定義のファイルの操作を作る。
 * @param options ファイルの場所・ひな形の場所・ID を作る関数
 */
export function createCategoryDefinitionFile(options: CategoryDefinitionFileOptions): CategoryDefinition {
  const { filePath, templateFilePath, generateCategoryId } = options;

  /** ファイルを読み、JSON として解析した値と、検証済みの内容を返す。 */
  const readAndValidate = () => {
    if (!existsSync(filePath)) throw new CategoryDefinitionError(describeError(filePath, 'ファイルが見つかりません'));
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ');
      throw new CategoryDefinitionError(describeError(filePath, `JSON として読めません（${reason}）`), { cause: error });
    }
    const parsed = definitionFileSchema.safeParse(raw);
    if (!parsed.success) throw new CategoryDefinitionError(describeError(filePath, describeIssues(parsed.error)));
    const duplicate = findDuplicate(parsed.data.categories);
    if (duplicate !== null) throw new CategoryDefinitionError(describeError(filePath, duplicate));
    return { raw: raw as { categories: RawCategoryEntry[] }, definition: parsed.data };
  };

  /** 既存の ID と重ならない新しい ID を作る。 */
  const generateUniqueId = (usedIds: Set<string>): CategoryId => {
    let categoryId = generateCategoryId();
    while (usedIds.has(categoryId)) categoryId = generateCategoryId();
    usedIds.add(categoryId);
    return categoryId as CategoryId;
  };

  /**
   * 最新のファイルを読み、ID のないカテゴリーに ID を付ける（書き戻しは呼び出し側で行う）。
   * raw はファイルの JSON（手で書かれたほかの項目を含む）に、付けた ID を反映したもの。
   */
  const loadWithIds = () => {
    const { raw, definition } = readAndValidate();
    const usedIds = new Set(definition.categories.flatMap((category) => (category.id === undefined ? [] : [category.id])));
    let assignedCount = 0;
    const categories: Category[] = definition.categories.map((category, index) => {
      if (category.id !== undefined) return { id: category.id as CategoryId, name: category.name };
      const categoryId = generateUniqueId(usedIds);
      raw.categories[index] = { id: categoryId, ...raw.categories[index] };
      assignedCount += 1;
      return { id: categoryId, name: category.name };
    });
    return { raw, categories, usedIds, assignedCount };
  };

  const writeDefinition = (raw: { categories: RawCategoryEntry[] }): void => {
    writeFileAtomically(filePath, `${JSON.stringify(raw, null, 2)}\n`);
  };

  return {
    createFromTemplateIfMissing() {
      if (existsSync(filePath)) return;
      writeFileSync(filePath, readFileSync(templateFilePath, 'utf8'), { mode: 0o600, flag: 'wx' });
    },

    readCategories() {
      const { raw, categories, assignedCount } = loadWithIds();
      if (assignedCount > 0) writeDefinition(raw);
      return categories;
    },

    addCategory(name, categoryId) {
      const { raw, categories, usedIds } = loadWithIds();
      const trimmedName = name.trim();
      if (categoryId !== undefined && usedIds.has(categoryId)) throw new CategoryAlreadyDefinedError(categoryId);
      if (categories.some((category) => category.name === trimmedName)) throw new CategoryNameDuplicateError(trimmedName);
      const added: Category = { id: categoryId === undefined ? generateUniqueId(usedIds) : (categoryId as CategoryId), name: trimmedName };
      raw.categories.push({ id: added.id, name: added.name });
      writeDefinition(raw);
      return added;
    },

    renameCategory(categoryId, name) {
      const { raw, categories } = loadWithIds();
      const trimmedName = name.trim();
      const index = categories.findIndex((category) => category.id === categoryId);
      if (index === -1) throw new CategoryNotFoundError(categoryId);
      if (categories.some((category) => category.id !== categoryId && category.name === trimmedName)) {
        throw new CategoryNameDuplicateError(trimmedName);
      }
      raw.categories[index] = { ...raw.categories[index], name: trimmedName };
      writeDefinition(raw);
      return { id: categoryId as CategoryId, name: trimmedName };
    },

    deleteCategory(categoryId) {
      const { raw, categories } = loadWithIds();
      const index = categories.findIndex((category) => category.id === categoryId);
      if (index === -1) throw new CategoryNotFoundError(categoryId);
      raw.categories.splice(index, 1);
      writeDefinition(raw);
    },
  };
}
